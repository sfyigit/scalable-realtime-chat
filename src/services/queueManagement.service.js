const AutoMessage = require('../models/autoMessage.model');
const { publishToSendingQueue } = require('../utils/rabbitmq');
const logger = require('../utils/logger');

/**
 * Gönderim zamanı gelen mesajları tespit edip RabbitMQ'ya yönlendirir
 * Her dakika çalışır
 */
async function processQueue() {
    try {
        const now = new Date();
        
        // sendDate'i geçmiş ve henüz kuyruğa alınmamış mesajları bul
        const messagesToQueue = await AutoMessage.find({
            sendDate: { $lte: now },
            isQueued: false,
            isSent: false
        });

        if (messagesToQueue.length === 0) {
            logger.info('[Queue Management] No messages ready to queue');
            return;
        }

        logger.info(`[Queue Management] Found ${messagesToQueue.length} messages ready to queue`);

        // Her mesajı RabbitMQ'ya gönder
        for (const autoMessage of messagesToQueue) {
            try {
                const messageData = {
                    autoMessageId: autoMessage._id.toString(),
                    senderId: autoMessage.senderId.toString(),
                    receiverId: autoMessage.receiverId.toString(),
                    content: autoMessage.content
                };

                await publishToSendingQueue(messageData);

                // Mesajı isQueued: true olarak işaretle
                await AutoMessage.findByIdAndUpdate(autoMessage._id, {
                    isQueued: true
                });

                console.log(`[Queue Management] Queued message ${autoMessage._id}`);
            } catch (error) {
                logger.error(`[Queue Management] Error queueing message ${autoMessage._id}:`, error);
                // Hata olsa bile devam et, diğer mesajları işle
            }
        }

        console.log(`[Queue Management] Successfully queued ${messagesToQueue.length} messages`);
    } catch (error) {
        logger.error('[Queue Management] Error processing queue:', error);
        throw error;
    }
}

module.exports = {
    processQueue
};

