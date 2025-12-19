const mongoose = require('mongoose');
const http = require('http');
const config = require('./config');
const redisClient = require('./utils/redis');
const app = require('./app');
const { initializeSocket } = require('./socket/socket');
const { connect: connectRabbitMQ } = require('./utils/rabbitmq');
const { startMessageConsumer } = require('./consumers/message.consumer');
const { startAutoMessageConsumer } = require('./consumers/autoMessage.consumer');
const { startAllCronJobs } = require('./services/cronJobs.service');
const logger = require('./utils/logger');

const port = config.port || 3000;

// Create HTTP server
const server = http.createServer(app);

// MongoDB Connection
mongoose.connect(config.mongoUrl, {
    serverSelectionTimeoutMS: 5000,
})
.then(() => {
    logger.info('MongoDB connected');
    
    // Redis Connection
    return redisClient.connect().catch((err) => {
        logger.error('Redis connection error:', err);
        console.warn('Server will continue without Redis. Some features may not work.');
        return Promise.resolve();
    });
})
.then(() => {
    logger.info('Redis connected successfully');
    
    // RabbitMQ Connection
    let rabbitmqConnected = false;
    return connectRabbitMQ()
        .then(() => {
            rabbitmqConnected = true;
            logger.info('RabbitMQ connected successfully');
        })
        .catch((err) => {
            logger.error({ err }, 'RabbitMQ connection error');
            logger.warn('Server will continue without RabbitMQ. Message queue will not work.');
            rabbitmqConnected = false;
            return Promise.resolve();
        });
})
.then(() => {    
    // Initialize Socket.IO
    initializeSocket(server);
    
    // Start message consumer
    startMessageConsumer()
        .then(() => {
            logger.info('Message consumer started successfully');
        })
        .catch((err) => {
            logger.error('Error starting message consumer:', err);
            logger.warn('Messages will be saved directly to DB if RabbitMQ is unavailable');
        });
    
    // Start auto message consumer
    startAutoMessageConsumer()
        .then(() => {
            logger.info('Auto message consumer started successfully');
        })
        .catch((err) => {
            logger.error('Error starting auto message consumer:', err);
        });
    
    // Start cron jobs
    startAllCronJobs();
    
    // Start server
    server.listen(port, '0.0.0.0', () => {
        logger.info(`Server is running on port ${port}`);
    });
})
.catch((err) => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
});