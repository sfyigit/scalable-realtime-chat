const amqp = require('amqplib');
const config = require('../config');
const logger = require('./logger');

let connection = null;
let channel = null;
const QUEUE_NAME = 'messages';
const MESSAGE_SENDING_QUEUE = 'message_sending_queue';

// RabbitMQ bağlantısı
async function connect() {
    try {
        connection = await amqp.connect(config.rabbitmq.url);
        channel = await connection.createChannel();
        
        // Queue'ları oluştur (durable: true - mesajlar kalıcı olacak)
        await channel.assertQueue(QUEUE_NAME, {
            durable: true
        });
        
        await channel.assertQueue(MESSAGE_SENDING_QUEUE, {
            durable: true
        });
        
        logger.info('RabbitMQ connected successfully');
        return { connection, channel };
    } catch (error) {
        logger.error('RabbitMQ connection error:', error);
        throw error;
    }
}

// Mesaj gönder (Producer)
async function publishMessage(messageData) {
    if (!channel) {
        await connect();
    }
    
    try {
        const message = JSON.stringify(messageData);
        const sent = channel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
            persistent: true // Mesajlar disk'e yazılsın
        });
        
        if (!sent) {
            throw new Error('Message could not be sent to queue');
        }
        
        logger.info('Message published to queue:', messageData);
        return true;
    } catch (error) {
        logger.error('Error publishing message:', error);
        throw error;
    }
}

// Mesaj gönder (message_sending_queue için)
async function publishToSendingQueue(messageData) {
    if (!channel) {
        await connect();
    }
    
    try {
        const message = JSON.stringify(messageData);
        const sent = channel.sendToQueue(MESSAGE_SENDING_QUEUE, Buffer.from(message), {
            persistent: true // Mesajlar disk'e yazılsın
        });
        
        if (!sent) {
            throw new Error('Message could not be sent to sending queue');
        }
        
        logger.info('Message published to sending queue:', messageData);
        return true;
    } catch (error) {
        logger.error('Error publishing message to sending queue:', error);
        throw error;
    }
}

// Mesaj dinle (Consumer)
async function consumeMessages(callback) {
    if (!channel) {
        await connect();
    }
    
    try {
        // Her mesajı sadece bir kez işle (ack gerektirir)
        await channel.prefetch(1);
        
        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                try {
                    const messageData = JSON.parse(msg.content.toString());
                    await callback(messageData);
                    channel.ack(msg); // Mesaj başarıyla işlendi
                } catch (error) {
                    logger.error('Error processing message:', error);
                    channel.nack(msg, false, true); // Mesajı tekrar kuyruğa al
                }
            }
        });
        
        logger.info('RabbitMQ consumer started');
    } catch (error) {
        logger.error('Error setting up consumer:', error);
        throw error;
    }
}

// Mesaj gönderim kuyruğunu dinle (message_sending_queue için)
async function consumeSendingQueue(callback) {
    if (!channel) {
        await connect();
    }
    
    try {
        // Her mesajı sadece bir kez işle (ack gerektirir)
        await channel.prefetch(1);
        
        channel.consume(MESSAGE_SENDING_QUEUE, async (msg) => {
            if (msg !== null) {
                try {
                    const messageData = JSON.parse(msg.content.toString());
                    await callback(messageData);
                    channel.ack(msg); // Mesaj başarıyla işlendi
                } catch (error) {
                    logger.error('Error processing message from sending queue:', error);
                    channel.nack(msg, false, true); // Mesajı tekrar kuyruğa al
                }
            }
        });
        
        logger.info('RabbitMQ sending queue consumer started');
    } catch (error) {
        logger.error('Error setting up sending queue consumer:', error);
        throw error;
    }
}

// Bağlantıyı kapat
async function close() {
    if (channel) {
        await channel.close();
    }
    if (connection) {
        await connection.close();
    }
}

module.exports = {
    connect,
    publishMessage,
    publishToSendingQueue,
    consumeMessages,
    consumeSendingQueue,
    close
};