require('dotenv').config();

const config = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // MongoDB
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/realtime-messaging',

  // Redis
  redis: {
    host: process.env.REDIS_HOST || (process.env.NODE_ENV === 'production' ? 'redis' : 'localhost'),
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  // RabbitMQ
  rabbitmq: {
    url: process.env.RABBITMQ_URL || (process.env.NODE_ENV === 'production' ? 'amqp://rabbitmq' : 'amqp://localhost:5672'),
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
}

module.exports = config;