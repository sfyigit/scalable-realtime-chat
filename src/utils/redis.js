const redis = require('redis');
const config = require('../config');
const logger = require('./logger');

// Create Redis client
const redisClient = redis.createClient({
    socket: {
        host: config.redis.host,
        port: config.redis.port,
        connectTimeout: 10000, // 10 second timeout
    }
});

// Redis error handling
redisClient.on('error', (err) => {
    logger.error('Redis Client Error:', err);
});

// Export Redis client
module.exports = redisClient;

