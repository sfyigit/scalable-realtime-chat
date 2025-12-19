const amqp = require('amqplib');
const config = require('../config');
const logger = require('./logger');

let connection = null;
let channel = null;
const QUEUE_NAME = 'messages';
const MESSAGE_SENDING_QUEUE = 'message_sending_queue';

// RabbitMQ connection
async function connect() {
    try {
        connection = await amqp.connect(config.rabbitmq.url);
        channel = await connection.createChannel();
        
        // Create queues (durable: true - messages will be persistent)
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

// Send message (Producer)
async function publishMessage(messageData) {
    if (!channel) {
        await connect();
    }
    
    try {
        const message = JSON.stringify(messageData);
        const sent = channel.sendToQueue(QUEUE_NAME, Buffer.from(message), {
            persistent: true // Messages will be written to disk
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

// Send message (for message_sending_queue)
async function publishToSendingQueue(messageData) {
    if (!channel) {
        await connect();
    }
    
    try {
        const message = JSON.stringify(messageData);
        const sent = channel.sendToQueue(MESSAGE_SENDING_QUEUE, Buffer.from(message), {
            persistent: true // Messages will be written to disk
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

// Listen for messages (Consumer)
async function consumeMessages(callback) {
    if (!channel) {
        await connect();
    }
    
    try {
        // Process each message only once (requires ack)
        await channel.prefetch(1);
        
        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                try {
                    const messageData = JSON.parse(msg.content.toString());
                    await callback(messageData);
                    channel.ack(msg); // Message processed successfully
                } catch (error) {
                    logger.error('Error processing message:', error);
                    channel.nack(msg, false, true); // Requeue the message
                }
            }
        });
        
        logger.info('RabbitMQ consumer started');
    } catch (error) {
        logger.error('Error setting up consumer:', error);
        throw error;
    }
}

// Listen to message sending queue (for message_sending_queue)
async function consumeSendingQueue(callback) {
    if (!channel) {
        await connect();
    }
    
    try {
        // Process each message only once (requires ack)
        await channel.prefetch(1);
        
        channel.consume(MESSAGE_SENDING_QUEUE, async (msg) => {
            if (msg !== null) {
                try {
                    const messageData = JSON.parse(msg.content.toString());
                    await callback(messageData);
                    channel.ack(msg); // Message processed successfully
                } catch (error) {
                    logger.error('Error processing message from sending queue:', error);
                    channel.nack(msg, false, true); // Requeue the message
                }
            }
        });
        
        logger.info('RabbitMQ sending queue consumer started');
    } catch (error) {
        logger.error('Error setting up sending queue consumer:', error);
        throw error;
    }
}

// Close connection
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