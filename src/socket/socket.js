const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const redisClient = require('../utils/redis');
const jwt = require('jsonwebtoken');
const config = require('../config');
const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const { publishMessage } = require('../utils/rabbitmq');
const logger = require('../utils/logger');

let io = null;
const ONLINE_USERS_KEY = 'online_users';
const USER_SOCKETS_PREFIX = 'user_sockets:';

// Redis helper functions
async function addUserSocket(userId, socketId) {
    // Convert userId to string
    const userIdStr = userId.toString();
    const userSocketsKey = `${USER_SOCKETS_PREFIX}${userIdStr}`;
    
    // Add user's sockets to Redis
    await redisClient.sAdd(userSocketsKey, socketId);
    
    // Set TTL for socket (30 minutes - for cleanup on disconnect)
    await redisClient.expire(userSocketsKey, 1800);
    
    // If this is the user's first socket, add to online_users set
    const socketCount = await redisClient.sCard(userSocketsKey);
    if (socketCount === 1) {
        await redisClient.sAdd(ONLINE_USERS_KEY, userIdStr);
        // Notify all users of online status
        if (io) {
            io.emit('user_online', { userId: userIdStr });
        }
    }
}

async function removeUserSocket(userId, socketId) {
    // Convert userId to string
    const userIdStr = userId.toString();
    const userSocketsKey = `${USER_SOCKETS_PREFIX}${userIdStr}`;
    
    // Remove socket from user's socket set
    await redisClient.sRem(userSocketsKey, socketId);
    
    // If this is the user's last socket, remove from online_users set
    const socketCount = await redisClient.sCard(userSocketsKey);
    if (socketCount === 0) {
        await redisClient.sRem(ONLINE_USERS_KEY, userIdStr);
        // Notify all users of offline status
        if (io) {
            io.emit('user_offline', { userId: userIdStr });
        }
    }
}

async function getOnlineUsers() {
    try {
        const userIds = await redisClient.sMembers(ONLINE_USERS_KEY);
        return userIds.map(id => id.toString());
    } catch (error) {
        logger.error('Error getting online users from Redis:', error);
        return [];
    }
}

// Initialize Socket.IO
function initializeSocket(server) {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket', 'polling']
    });

    // Cluster support with Redis adapter
    const pubClient = redisClient.duplicate();
    const subClient = redisClient.duplicate();
    
    Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
            io.adapter(createAdapter(pubClient, subClient));
            console.log('Socket.IO Redis adapter initialized');
        })
        .catch((err) => {
            logger.error('Redis adapter error:', err);
            console.warn('Socket.IO will continue without Redis adapter');
        });

    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
            
            if (!token) {
                return next(new Error('Authentication error: Token required'));
            }

            const decoded = jwt.verify(token, config.jwt.secret);
            socket.userId = decoded.userId || decoded.sub;
            socket.email = decoded.email;
            next();
        } catch (error) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    // Connection handler
    io.on('connection', async (socket) => {
        console.log(`User connected: ${socket.userId} (${socket.id})`);

        // Add user to their own room
        socket.join(`user:${socket.userId}`);

        // Add user to Redis as online
        try {
            await addUserSocket(socket.userId, socket.id);
            
            // Automatically send online user list after user is added to Redis
            // This way the user can always see their own online status
            try {
                const onlineUserIds = await getOnlineUsers();
                socket.emit('online_users_list', { userIds: onlineUserIds });
            } catch (error) {
                logger.error('Error getting online users on connect:', error);
                socket.emit('online_users_list', { userIds: [] });
            }
        } catch (error) {
            logger.error('Error adding user to online list:', error);
            // Send online user list even if there's an error
            try {
                const onlineUserIds = await getOnlineUsers();
                socket.emit('online_users_list', { userIds: onlineUserIds });
            } catch (err) {
                socket.emit('online_users_list', { userIds: [] });
            }
        }

        // Request online user list (for manual request - on refresh)
        socket.on('get_online_users', async () => {
            try {
                const onlineUserIds = await getOnlineUsers();
                socket.emit('online_users_list', { userIds: onlineUserIds });
            } catch (error) {
                logger.error('Error getting online users:', error);
                socket.emit('online_users_list', { userIds: [] });
            }
        });

        // Join conversation
        socket.on('join_conversation', async (conversationId) => {
            try {
                // Check if user has access to this conversation
                const conversation = await Conversation.findOne({
                    _id: conversationId,
                    participants: socket.userId
                });

                if (!conversation) {
                    socket.emit('error', { message: 'Conversation not found or access denied' });
                    return;
                }

                socket.join(`conversation:${conversationId}`);
                console.log(`User ${socket.userId} joined conversation ${conversationId}`);
                
                socket.emit('joined_conversation', { conversationId });
            } catch (error) {
                socket.emit('error', { message: error.message });
            }
        });

        // Leave conversation
        socket.on('leave_conversation', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
            console.log(`User ${socket.userId} left conversation ${conversationId}`);
        });

        // Send message
        socket.on('send_message', async (data) => {
            try {
                const { conversationId, recipientId, content, type = 'text' } = data;

                // Validation
                if ((!conversationId && !recipientId) || !content || content.trim().length === 0) {
                    socket.emit('error', { message: 'Invalid message data' });
                    return;
                }

                let conversation = null;
                let finalConversationId = conversationId;

                // If conversationId doesn't exist, create or find conversation with recipientId
                if (!conversationId && recipientId) {
                    // Check if existing conversation exists
                    conversation = await Conversation.findOne({
                        type: 'direct',
                        participants: { $all: [socket.userId, recipientId], $size: 2 }
                    });

                    // Create conversation if it doesn't exist
                    if (!conversation) {
                        const conversationsService = require('../modules/conversations/conversations.service');
                        conversation = await conversationsService.createConversation(
                            socket.userId,
                            [recipientId],
                            'direct'
                        );
                        // Populate conversation
                        await conversation.populate('participants', 'name email');
                    }
                    finalConversationId = conversation._id.toString();
                } else {
                    // Check if user has access to this conversation
                    conversation = await Conversation.findOne({
                        _id: conversationId,
                        participants: socket.userId
                    });

                    if (!conversation) {
                        socket.emit('error', { message: 'Conversation not found or access denied' });
                        return;
                    }
                    // Populate conversation
                    await conversation.populate('participants', 'name email');
                }

                // Send message to RabbitMQ
                const messageData = {
                    conversationId: finalConversationId,
                    senderId: socket.userId,
                    content: content.trim(),
                    type,
                    timestamp: new Date()
                };

                let savedMessage = null;
                let useRabbitMQ = true;

                // Try to send to RabbitMQ
                try {
                    await publishMessage(messageData);
                } catch (error) {
                    logger.error('Error publishing to RabbitMQ, saving directly to DB:', error);
                    useRabbitMQ = false;
                    
                    // Fallback: Save message directly to DB
                    try {
                        savedMessage = await Message.create({
                            conversationId: finalConversationId,
                            senderId: socket.userId,
                            content: content.trim(),
                            type,
                            readBy: [{
                                userId: socket.userId,
                                readAt: new Date()
                            }]
                        });

                        // Populate sender information
                        await savedMessage.populate('senderId', 'name email');

                        // Update conversation's lastMessage
                        await Conversation.findByIdAndUpdate(finalConversationId, {
                            lastMessage: savedMessage._id,
                            lastMessageAt: savedMessage.createdAt
                        });

                        console.log(`Message saved directly to DB (fallback): ${savedMessage._id}`);
                    } catch (dbError) {
                        logger.error('Error saving message directly to DB:', dbError);
                        socket.emit('error', { message: 'Failed to save message' });
                        return;
                    }
                }

                // Send message immediately to all participants (real-time)
                let messagePayload;
                
                if (savedMessage) {
                    // Message saved to DB (fallback case)
                    messagePayload = {
                        ...savedMessage.toObject(),
                        conversationId: finalConversationId
                    };
                } else {
                    // Sent to RabbitMQ, consumer will save to DB
                    messagePayload = {
                        ...messageData,
                        _id: `temp_${Date.now()}`, // Temporary ID
                        senderId: {
                            _id: socket.userId,
                            name: socket.email, // Real user info will come from consumer
                            email: socket.email
                        },
                        createdAt: messageData.timestamp
                    };
                }

                // Send to all participants in the conversation (conversation room)
                io.to(`conversation:${finalConversationId}`).emit('new_message', messagePayload);

                // If message was saved to DB, also send message_saved event
                if (savedMessage) {
                    io.to(`conversation:${finalConversationId}`).emit('message_saved', {
                        message: savedMessage.toObject(),
                        conversationId: finalConversationId
                    });
                }

                // Also send to each participant's own user room (for notifications)
                // This way they can receive the message even if they haven't joined the conversation
                conversation.participants.forEach(participant => {
                    if (participant._id.toString() !== socket.userId) {
                        // Send notification to receiver
                        io.to(`user:${participant._id}`).emit('new_message_notification', {
                            ...messagePayload,
                            conversation: {
                                _id: conversation._id,
                                participants: conversation.participants
                            }
                        });
                    }
                });

                // Send confirmation to sender
                socket.emit('message_sent', { 
                    tempId: messagePayload._id, 
                    conversationId: finalConversationId,
                    conversation: conversation ? conversation.toObject() : null
                });

            } catch (error) {
                logger.error('Error sending message:', error);
                socket.emit('error', { message: error.message });
            }
        });

        // Typing indicator
        socket.on('typing_start', (data) => {
            const { conversationId } = data;
            socket.to(`conversation:${conversationId}`).emit('user_typing', {
                userId: socket.userId,
                conversationId
            });
        });

        socket.on('typing_stop', (data) => {
            const { conversationId } = data;
            socket.to(`conversation:${conversationId}`).emit('user_stopped_typing', {
                userId: socket.userId,
                conversationId
            });
        });

        // Mark message as read
        socket.on('mark_as_read', async (data) => {
            try {
                const { messageId, conversationId } = data;
                
                // Send as socket event (endpoint can be used for DB operation)
                io.to(`conversation:${conversationId}`).emit('message_read', {
                    messageId,
                    userId: socket.userId
                });
            } catch (error) {
                socket.emit('error', { message: error.message });
            }
        });

        // Disconnect
        socket.on('disconnect', async () => {
            console.log(`User disconnected: ${socket.userId} (${socket.id})`);
            
            // Remove from online user list in Redis
            try {
                await removeUserSocket(socket.userId, socket.id);
            } catch (error) {
                logger.error('Error removing user from online list:', error);
            }
        });
    });

    return io;
}

// Export Socket.IO instance
function getIO() {
    if (!io) {
        throw new Error('Socket.IO not initialized. Call initializeSocket first.');
    }
    return io;
}

module.exports = {
    initializeSocket,
    getIO
};