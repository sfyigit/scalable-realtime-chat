const redis = require('redis');
const config = require('../config');
const logger = require('./logger');

// Redis client oluştur
const redisClient = redis.createClient({
    socket: {
        host: config.redis.host,
        port: config.redis.port,
        connectTimeout: 10000, // 10 saniye timeout
    }
});

// Redis hata yönetimi
redisClient.on('error', (err) => {
    logger.error('Redis Client Error:', err);
});

// Redis client'ı export et
module.exports = redisClient;

