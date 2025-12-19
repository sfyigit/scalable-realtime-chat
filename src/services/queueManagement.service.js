const AutoMessage = require('../models/autoMessage.model');
const { publishToSendingQueue } = require('../utils/rabbitmq');
const logger = require('../utils/logger');

/**
 * Detects messages that have reached their send time and routes them to RabbitMQ
 * Runs every minute
 */
async function processQueue() {
    try {
        const now = new Date();
        
        // Find messages whose sendDate has passed and haven't been queued yet
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

        // Send each message to RabbitMQ
        for (const autoMessage of messagesToQueue) {
            try {
                const messageData = {
                    autoMessageId: autoMessage._id.toString(),
                    senderId: autoMessage.senderId.toString(),
                    receiverId: autoMessage.receiverId.toString(),
                    content: autoMessage.content
                };

                await publishToSendingQueue(messageData);

                // Mark message as isQueued: true
                await AutoMessage.findByIdAndUpdate(autoMessage._id, {
                    isQueued: true
                });

                console.log(`[Queue Management] Queued message ${autoMessage._id}`);
            } catch (error) {
                logger.error(`[Queue Management] Error queueing message ${autoMessage._id}:`, error);
                // Continue even if there's an error, process other messages
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

