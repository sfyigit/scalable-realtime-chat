const { consumeMessages } = require('../utils/rabbitmq');
const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { getIO } = require('../socket/socket');
const logger = require('../utils/logger');

async function startMessageConsumer() {
    try {
        await consumeMessages(async (messageData) => {
            try {
                const { conversationId, senderId, content, type, timestamp } = messageData;

            // Save message to DB
            const message = await Message.create({
                conversationId,
                senderId,
                content,
                type,
                readBy: [{
                    userId: senderId,
                    readAt: new Date()
                }]
            });

            // Populate sender information
            await message.populate('senderId', 'name email');

            // Update conversation's lastMessage
            await Conversation.findByIdAndUpdate(conversationId, {
                lastMessage: message._id,
                lastMessageAt: message.createdAt
            });

            // Send updated message via Socket.IO (with real ID)
            const io = getIO();
            io.to(`conversation:${conversationId}`).emit('message_saved', {
                message: message.toObject(),
                conversationId
            });

            console.log(`Message saved to DB: ${message._id}`);
        } catch (error) {
                logger.error('Error saving message to DB:', error);
                throw error; // Requeue the message
            }
        });
    } catch (error) {
        logger.error('Error setting up message consumer:', error);
        throw error;
    }
}

module.exports = { startMessageConsumer };