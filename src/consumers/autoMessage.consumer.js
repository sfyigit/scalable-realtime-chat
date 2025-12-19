const { consumeSendingQueue } = require('../utils/rabbitmq');
const AutoMessage = require('../models/autoMessage.model');
const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { getIO } = require('../socket/socket');
const logger = require('../utils/logger');

/**
 * Processes automatic messages from the queue and delivers them to recipients
 */
async function startAutoMessageConsumer() {
    await consumeSendingQueue(async (messageData) => {
        try {
            const { autoMessageId, senderId, receiverId, content } = messageData;

            console.log(`[Auto Message Consumer] Processing message ${autoMessageId}`);

            // Find or create conversation
            let conversation = await Conversation.findOne({
                type: 'direct',
                participants: { $all: [senderId, receiverId], $size: 2 }
            });

            if (!conversation) {
                // Create new conversation
                conversation = await Conversation.create({
                    participants: [senderId, receiverId],
                    type: 'direct'
                });
                console.log(`[Auto Message Consumer] Created new conversation ${conversation._id}`);
            }

            // Create new Message document and save to database
            const message = await Message.create({
                conversationId: conversation._id,
                senderId: senderId,
                content: content,
                type: 'text',
                readBy: [] // Automatic messages are unread initially
            });

            // Populate sender information
            await message.populate('senderId', 'name email');

            // Update conversation's lastMessage
            await Conversation.findByIdAndUpdate(conversation._id, {
                lastMessage: message._id,
                lastMessageAt: message.createdAt
            });

            // Send instant notification to receiver via Socket.IO with message_received event
            const io = getIO();
            
            // Send notification to receiver
            io.to(`user:${receiverId}`).emit('message_received', {
                message: message.toObject(),
                conversationId: conversation._id.toString()
            });

            // Also send to conversation room
            io.to(`conversation:${conversation._id}`).emit('message_saved', {
                message: message.toObject(),
                conversationId: conversation._id.toString()
            });

            // Update AutoMessage record as isSent: true
            await AutoMessage.findByIdAndUpdate(autoMessageId, {
                isSent: true
            });

            console.log(`[Auto Message Consumer] Successfully processed message ${autoMessageId}`);
        } catch (error) {
            logger.error('[Auto Message Consumer] Error processing message:', error);
            throw error; // Requeue the message
        }
    });
}

module.exports = { startAutoMessageConsumer };

