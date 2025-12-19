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
    // userId'yi string'e çevir
    const userIdStr = userId.toString();
    const userSocketsKey = `${USER_SOCKETS_PREFIX}${userIdStr}`;
    
    // Kullanıcının socket'lerini Redis'e ekle
    await redisClient.sAdd(userSocketsKey, socketId);
    
    // Socket için TTL ayarla (30 dakika - disconnect durumunda temizlik için)
    await redisClient.expire(userSocketsKey, 1800);
    
    // Eğer bu kullanıcının ilk socket'i ise online_users set'ine ekle
    const socketCount = await redisClient.sCard(userSocketsKey);
    if (socketCount === 1) {
        await redisClient.sAdd(ONLINE_USERS_KEY, userIdStr);
        // Tüm kullanıcılara online durumu bildir
        if (io) {
            io.emit('user_online', { userId: userIdStr });
        }
    }
}

async function removeUserSocket(userId, socketId) {
    // userId'yi string'e çevir
    const userIdStr = userId.toString();
    const userSocketsKey = `${USER_SOCKETS_PREFIX}${userIdStr}`;
    
    // Socket'i kullanıcının socket set'inden çıkar
    await redisClient.sRem(userSocketsKey, socketId);
    
    // Eğer bu kullanıcının son socket'i ise online_users set'inden çıkar
    const socketCount = await redisClient.sCard(userSocketsKey);
    if (socketCount === 0) {
        await redisClient.sRem(ONLINE_USERS_KEY, userIdStr);
        // Tüm kullanıcılara offline durumu bildir
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

// Socket.IO başlat
function initializeSocket(server) {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket', 'polling']
    });

    // Redis adapter ile cluster desteği
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

        // Kullanıcıyı kendi room'una ekle
        socket.join(`user:${socket.userId}`);

        // Redis'e online kullanıcı olarak ekle
        try {
            await addUserSocket(socket.userId, socket.id);
            
            // Kullanıcı Redis'e eklendikten sonra online kullanıcı listesini otomatik gönder
            // Bu sayede kullanıcı her zaman kendi online durumunu görebilir
            try {
                const onlineUserIds = await getOnlineUsers();
                socket.emit('online_users_list', { userIds: onlineUserIds });
            } catch (error) {
                logger.error('Error getting online users on connect:', error);
                socket.emit('online_users_list', { userIds: [] });
            }
        } catch (error) {
            logger.error('Error adding user to online list:', error);
            // Hata olsa bile online kullanıcı listesini gönder
            try {
                const onlineUserIds = await getOnlineUsers();
                socket.emit('online_users_list', { userIds: onlineUserIds });
            } catch (err) {
                socket.emit('online_users_list', { userIds: [] });
            }
        }

        // Online kullanıcı listesini iste (manuel istek için - refresh durumunda)
        socket.on('get_online_users', async () => {
            try {
                const onlineUserIds = await getOnlineUsers();
                socket.emit('online_users_list', { userIds: onlineUserIds });
            } catch (error) {
                logger.error('Error getting online users:', error);
                socket.emit('online_users_list', { userIds: [] });
            }
        });

        // Konuşmaya katıl
        socket.on('join_conversation', async (conversationId) => {
            try {
                // Kullanıcının bu konuşmaya erişimi var mı kontrol et
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

        // Konuşmadan ayrıl
        socket.on('leave_conversation', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
            console.log(`User ${socket.userId} left conversation ${conversationId}`);
        });

        // Mesaj gönder
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

                // Eğer conversationId yoksa, recipientId ile conversation oluştur veya bul
                if (!conversationId && recipientId) {
                    // Mevcut conversation var mı kontrol et
                    conversation = await Conversation.findOne({
                        type: 'direct',
                        participants: { $all: [socket.userId, recipientId], $size: 2 }
                    });

                    // Eğer conversation yoksa oluştur
                    if (!conversation) {
                        const conversationsService = require('../modules/conversations/conversations.service');
                        conversation = await conversationsService.createConversation(
                            socket.userId,
                            [recipientId],
                            'direct'
                        );
                        // Conversation'ı populate et
                        await conversation.populate('participants', 'name email');
                    }
                    finalConversationId = conversation._id.toString();
                } else {
                    // Kullanıcının bu konuşmaya erişimi var mı kontrol et
                    conversation = await Conversation.findOne({
                        _id: conversationId,
                        participants: socket.userId
                    });

                    if (!conversation) {
                        socket.emit('error', { message: 'Conversation not found or access denied' });
                        return;
                    }
                    // Conversation'ı populate et
                    await conversation.populate('participants', 'name email');
                }

                // Mesajı RabbitMQ'ya gönder
                const messageData = {
                    conversationId: finalConversationId,
                    senderId: socket.userId,
                    content: content.trim(),
                    type,
                    timestamp: new Date()
                };

                let savedMessage = null;
                let useRabbitMQ = true;

                // RabbitMQ'ya göndermeyi dene
                try {
                    await publishMessage(messageData);
                } catch (error) {
                    logger.error('Error publishing to RabbitMQ, saving directly to DB:', error);
                    useRabbitMQ = false;
                    
                    // Fallback: Mesajı doğrudan DB'ye kaydet
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

                        // Populate sender bilgisi
                        await savedMessage.populate('senderId', 'name email');

                        // Conversation'ın lastMessage'ını güncelle
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

                // Mesajı hemen tüm katılımcılara gönder (real-time)
                let messagePayload;
                
                if (savedMessage) {
                    // DB'ye kaydedilmiş mesaj (fallback durumu)
                    messagePayload = {
                        ...savedMessage.toObject(),
                        conversationId: finalConversationId
                    };
                } else {
                    // RabbitMQ'ya gönderilmiş, consumer DB'ye kaydedecek
                    messagePayload = {
                        ...messageData,
                        _id: `temp_${Date.now()}`, // Geçici ID
                        senderId: {
                            _id: socket.userId,
                            name: socket.email, // Gerçek kullanıcı bilgisi consumer'dan gelecek
                            email: socket.email
                        },
                        createdAt: messageData.timestamp
                    };
                }

                // Konuşmadaki tüm katılımcılara gönder (conversation room'una)
                io.to(`conversation:${finalConversationId}`).emit('new_message', messagePayload);

                // Eğer mesaj DB'ye kaydedildiyse, message_saved event'i de gönder
                if (savedMessage) {
                    io.to(`conversation:${finalConversationId}`).emit('message_saved', {
                        message: savedMessage.toObject(),
                        conversationId: finalConversationId
                    });
                }

                // Ayrıca her katılımcıya kendi user room'una da gönder (bildirim için)
                // Böylece conversation'a katılmamış olsalar bile mesajı alabilirler
                conversation.participants.forEach(participant => {
                    if (participant._id.toString() !== socket.userId) {
                        // Alıcıya bildirim gönder
                        io.to(`user:${participant._id}`).emit('new_message_notification', {
                            ...messagePayload,
                            conversation: {
                                _id: conversation._id,
                                participants: conversation.participants
                            }
                        });
                    }
                });

                // Gönderen kullanıcıya onay gönder
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

        // Mesaj okundu işaretle
        socket.on('mark_as_read', async (data) => {
            try {
                const { messageId, conversationId } = data;
                
                // Socket event olarak gönder (DB işlemi için endpoint kullanılabilir)
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
            
            // Redis'ten online kullanıcı listesinden çıkar
            try {
                await removeUserSocket(socket.userId, socket.id);
            } catch (error) {
                logger.error('Error removing user from online list:', error);
            }
        });
    });

    return io;
}

// Socket.IO instance'ını dışa aktar
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