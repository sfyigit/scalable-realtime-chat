const { consumeSendingQueue } = require('../utils/rabbitmq');
const AutoMessage = require('../models/autoMessage.model');
const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { getIO } = require('../socket/socket');
const logger = require('../utils/logger');

/**
 * Kuyruktaki otomatik mesajları işleyerek alıcılara ulaştırır
 */
async function startAutoMessageConsumer() {
    await consumeSendingQueue(async (messageData) => {
        try {
            const { autoMessageId, senderId, receiverId, content } = messageData;

            console.log(`[Auto Message Consumer] Processing message ${autoMessageId}`);

            // Conversation'ı bul veya oluştur
            let conversation = await Conversation.findOne({
                type: 'direct',
                participants: { $all: [senderId, receiverId], $size: 2 }
            });

            if (!conversation) {
                // Yeni conversation oluştur
                conversation = await Conversation.create({
                    participants: [senderId, receiverId],
                    type: 'direct'
                });
                console.log(`[Auto Message Consumer] Created new conversation ${conversation._id}`);
            }

            // Yeni Message dökümanı oluştur ve veritabanına kaydet
            const message = await Message.create({
                conversationId: conversation._id,
                senderId: senderId,
                content: content,
                type: 'text',
                readBy: [] // Otomatik mesajlar başlangıçta okunmamış
            });

            // Populate sender bilgisi
            await message.populate('senderId', 'name email');

            // Conversation'ın lastMessage'ını güncelle
            await Conversation.findByIdAndUpdate(conversation._id, {
                lastMessage: message._id,
                lastMessageAt: message.createdAt
            });

            // Socket.IO üzerinden alıcıya message_received eventi ile anlık bildirim gönder
            const io = getIO();
            
            // Alıcıya bildirim gönder
            io.to(`user:${receiverId}`).emit('message_received', {
                message: message.toObject(),
                conversationId: conversation._id.toString()
            });

            // Conversation room'una da gönder
            io.to(`conversation:${conversation._id}`).emit('message_saved', {
                message: message.toObject(),
                conversationId: conversation._id.toString()
            });

            // AutoMessage kaydını isSent: true olarak güncelle
            await AutoMessage.findByIdAndUpdate(autoMessageId, {
                isSent: true
            });

            console.log(`[Auto Message Consumer] Successfully processed message ${autoMessageId}`);
        } catch (error) {
            logger.error('[Auto Message Consumer] Error processing message:', error);
            throw error; // Mesajı tekrar kuyruğa al
        }
    });
}

module.exports = { startAutoMessageConsumer };

