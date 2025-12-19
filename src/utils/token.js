const jwt = require('jsonwebtoken');
const config = require('../config');

module.exports.generateAccessToken = (payload) => {
    // JWT standard claim'leri kullanarak
    return jwt.sign(
        {
            sub: payload.userId,  // JWT standard: subject (user id)
            userId: payload.userId, // Backward compatibility için
            ...(payload.email && { email: payload.email }),
            ...(payload.role && { role: payload.role }),
        },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
}

module.exports.generateRefreshToken = (payload) => {
    // Refresh token için sadece userId yeterli
    return jwt.sign(
        {
            sub: payload.userId,
            userId: payload.userId,
        },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshExpiresIn }
    );
}