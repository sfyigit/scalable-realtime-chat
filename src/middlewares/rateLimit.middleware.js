const redisClient = require('../utils/redis');
const logger = require('../utils/logger');

// Rate limit key prefix
const RATE_LIMIT_PREFIX = 'rate_limit:';

/**
 * Rate limiting middleware factory
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.max - Maximum number of requests per window (default: 100)
 * @param {string} options.message - Error message when limit is exceeded
 * @param {Function} options.keyGenerator - Function to generate unique key for each request
 * @param {boolean} options.skipSuccessfulRequests - Skip counting successful requests
 * @param {boolean} options.skipFailedRequests - Skip counting failed requests
 * @returns {Function} Express middleware function
 */
function createRateLimiter(options = {}) {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes
        max = 100, // 100 requests per window
        message = 'Too many requests, please try again later.',
        keyGenerator = (req) => {
            // Default: use IP address or user ID if authenticated
            return req.ip || req.connection?.remoteAddress || 'unknown';
        },
        skipSuccessfulRequests = false,
        skipFailedRequests = false
    } = options;

    return async (req, res, next) => {
        try {
            // Check if Redis is connected
            if (!redisClient.isReady) {
                // If Redis is not ready, allow the request (fail open)
                console.warn('Redis not ready, skipping rate limit');
                return next();
            }

            // Generate unique key for this request
            const key = keyGenerator(req);
            const rateLimitKey = `${RATE_LIMIT_PREFIX}${key}`;

            // Get current request count from Redis
            const currentCount = await redisClient.get(rateLimitKey);
            const count = currentCount ? parseInt(currentCount, 10) : 0;

            // Check if limit is exceeded
            if (count >= max) {
                // Get TTL to calculate reset time
                const ttl = await redisClient.ttl(rateLimitKey);
                
                // Set rate limit headers
                res.setHeader('X-RateLimit-Limit', max);
                res.setHeader('X-RateLimit-Remaining', 0);
                res.setHeader('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());
                
                return res.status(429).json({
                    success: false,
                    error: message,
                    retryAfter: ttl
                });
            }

            // Increment counter
            if (count === 0) {
                // First request in this window, set with expiration
                await redisClient.setEx(rateLimitKey, Math.ceil(windowMs / 1000), '1');
            } else {
                // Increment existing counter
                await redisClient.incr(rateLimitKey);
            }

            // Get updated count and TTL
            const newCount = count + 1;
            const ttl = await redisClient.ttl(rateLimitKey);

            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, max - newCount));
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + ttl * 1000).toISOString());

            // Store count in request for potential use
            req.rateLimit = {
                limit: max,
                remaining: Math.max(0, max - newCount),
                reset: new Date(Date.now() + ttl * 1000)
            };

            // Handle skip options
            if (skipSuccessfulRequests || skipFailedRequests) {
                const originalSend = res.send;
                res.send = function (body) {
                    const statusCode = res.statusCode;
                    const shouldSkip = (skipSuccessfulRequests && statusCode < 400) ||
                                     (skipFailedRequests && statusCode >= 400);
                    
                    if (shouldSkip && newCount > 0) {
                        // Decrement counter if we should skip this request
                        redisClient.decr(rateLimitKey).catch(() => {});
                    }
                    
                    return originalSend.call(this, body);
                };
            }

            next();
        } catch (error) {
            // If Redis fails, allow the request (fail open)
            logger.error('Rate limit error:', error);
            next();
        }
    };
}

/**
 * Default rate limiter for general API routes
 * 100 requests per 15 minutes per IP
 */
const defaultRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});

/**
 * Strict rate limiter for authentication routes
 * 5 requests per 15 minutes per IP
 */
const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: 'Too many authentication attempts, please try again later.'
});

/**
 * User-specific rate limiter
 * 200 requests per 15 minutes per user
 */
const userRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    message: 'Too many requests, please try again later.',
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise use IP
        return req.user?.userId?.toString() || req.ip || req.connection?.remoteAddress || 'unknown';
    }
});

module.exports = {
    createRateLimiter,
    defaultRateLimiter,
    authRateLimiter,
    userRateLimiter
};

