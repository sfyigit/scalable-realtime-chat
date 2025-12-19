const User = require('../../models/user.model');
const { hashPassword, verifyPassword } = require('../../utils/password');
const { generateAccessToken, generateRefreshToken } = require('../../utils/token');
const redisClient = require('../../utils/redis');
const config = require('../../config');
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');

module.exports.register = async (name, email, password) => {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        throw new Error('User already registered');
    }
    const hashedPassword = await hashPassword(password);
    const user = await User.create({ name, email, password: hashedPassword });
    
    let accessToken = generateAccessToken({ userId: user._id, email: user.email });
    let refreshToken = generateRefreshToken({ userId: user._id });
    
    // Refresh token'ı Redis'e kaydet
    try {
        const refreshTokenKey = `refreshToken:${user._id}`;
        await redisClient.set(refreshTokenKey, refreshToken, { EX: 7 * 24 * 60 * 60 });
    } catch (error) {
        logger.error('Redis operation error:', error);
        // Redis hatası olsa bile kullanıcı kaydı başarılı, sadece refresh token saklanamadı
    }
    
    return { accessToken, refreshToken };
}

module.exports.login = async (email, password) => {
    const user = await User.findOne({ email });
    if (!user) {
        throw new Error('Invalid email or password');
    }
    const passwordVerified = await verifyPassword(password, user.password);
    if (!passwordVerified) {
        throw new Error('Invalid email or password');
    }
    let accessToken = generateAccessToken({ userId: user._id, email: user.email });
    let refreshToken = generateRefreshToken({ userId: user._id });

    // Refresh token'ı Redis'e kaydet
    try {
        const refreshTokenKey = `refreshToken:${user._id}`;
        await redisClient.set(refreshTokenKey, refreshToken, { EX: 7 * 24 * 60 * 60 });
    } catch (error) {
        logger.error('Redis operation error:', error);
        // Redis hatası olsa bile login başarılı, sadece refresh token saklanamadı
    }
    
    return { accessToken, refreshToken };
}

module.exports.logout = async (userId) => {
    try {
        // Refresh token'ı Redis'ten silelim
        console.log('Logout - userId in service:', userId);
        const refreshTokenKey = `refreshToken:${userId}`;
        await redisClient.del(refreshTokenKey);
    } catch (error) {
        logger.error('Redis operation error during logout:', error);
        // Hata olsa bile logout işlemi devam etsin
    }
};

module.exports.refreshToken = async (refreshToken) => {
    try {
        // Refresh token'ı verify edelim
        const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
        const userId = decoded.userId || decoded.sub; // sub (standard) veya userId (backward compatibility)
        
        // Redis'te saklanan refresh token ile karşılaştır
        const refreshTokenKey = `refreshToken:${userId}`;
        const storedRefreshToken = await redisClient.get(refreshTokenKey);
        
        if (!storedRefreshToken || storedRefreshToken !== refreshToken) {
            throw new Error('Invalid refresh token');
        }
        
        // Kullanıcının hala var olduğunu kontrol et
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }
        
        // Yeni token'lar oluştur
        const newAccessToken = generateAccessToken({ userId: user._id, email: user.email });
        const newRefreshToken = generateRefreshToken({ userId: user._id });
        
        // Yeni refresh token'ı Redis'e kaydet
        await redisClient.set(refreshTokenKey, newRefreshToken, { EX: 7 * 24 * 60 * 60 });
        
        return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            throw new Error('Invalid or expired refresh token');
        }
        throw error;
    }
}

