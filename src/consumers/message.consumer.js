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

            // Mesajı DB'ye kaydet
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

            // Populate sender bilgisi
            await message.populate('senderId', 'name email');

            // Conversation'ın lastMessage'ını güncelle
            await Conversation.findByIdAndUpdate(conversationId, {
                lastMessage: message._id,
                lastMessageAt: message.createdAt
            });

            // Socket.IO ile güncellenmiş mesajı gönder (gerçek ID ile)
            const io = getIO();
            io.to(`conversation:${conversationId}`).emit('message_saved', {
                message: message.toObject(),
                conversationId
            });

            console.log(`Message saved to DB: ${message._id}`);
        } catch (error) {
                logger.error('Error saving message to DB:', error);
                throw error; // Mesajı tekrar kuyruğa al
            }
        });
    } catch (error) {
        logger.error('Error setting up message consumer:', error);
        throw error;
    }
}

module.exports = { startMessageConsumer };