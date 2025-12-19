const jwt = require('jsonwebtoken');
const config = require('../config');

module.exports.generateAccessToken = (payload) => {
    // Using JWT standard claims
    return jwt.sign(
        {
            sub: payload.userId,  // JWT standard: subject (user id)
            userId: payload.userId, // For backward compatibility
            ...(payload.email && { email: payload.email }),
            ...(payload.role && { role: payload.role }),
        },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
}

module.exports.generateRefreshToken = (payload) => {
    // Only userId is sufficient for refresh token
    return jwt.sign(
        {
            sub: payload.userId,
            userId: payload.userId,
        },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshExpiresIn }
    );
}