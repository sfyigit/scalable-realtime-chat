const authService = require('./auth.service');
const userService = require('../users/users.service');
const config = require('../../config');
const { getIO } = require('../../socket/socket');
const redisClient = require('../../utils/redis');
const logger = require('../../utils/logger');

module.exports.register = async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const { accessToken, refreshToken } = await authService.register(name, email, password);
        
        // RefreshToken'ı httpOnly cookie olarak gönder
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 gün
        });
        
        res.status(201).json({ 
            message: 'User registered successfully', 
            accessToken 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

module.exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const { accessToken, refreshToken } = await authService.login(email, password);
        
        // RefreshToken'ı httpOnly cookie olarak gönder
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 gün
        });
        
        res.status(200).json({ 
            message: 'Login successful', 
            accessToken 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

module.exports.logout = async (req, res) => {
    try {
        let userId = null;

        // Kullanıcı ID'sini token'dan al (auth middleware'den geliyor olmalı)
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
                userId = decoded.userId || decoded.sub;
            } catch (err) {
                console.warn('Could not decode refresh token:', err);
            }
        }
        
        // Eğer auth middleware'den userId geliyorsa onu kullan
        if (!userId && req.user?.userId) {
            userId = req.user.userId;
        }
        
        if (userId) {
            // Refresh token'ı sil
            await authService.logout(userId);
            
            // Socket bağlantılarını kes ve Redis'ten temizle
            try {
                const io = getIO();
                const userIdStr = userId.toString();
                const USER_SOCKETS_PREFIX = 'user_sockets:';
                const ONLINE_USERS_KEY = 'online_users';
                const userSocketsKey = `${USER_SOCKETS_PREFIX}${userIdStr}`;
                
                // Kullanıcının tüm socket'lerini Redis'ten al
                const socketIds = await redisClient.sMembers(userSocketsKey);
                
                // Her socket'i disconnect et
                if (io && socketIds.length > 0) {
                    socketIds.forEach(socketId => {
                        const socket = io.sockets.sockets.get(socketId);
                        if (socket) {
                            socket.disconnect(true); // Force disconnect
                        }
                    });
                }
                
                // Redis'ten kullanıcının socket'lerini temizle
                if (socketIds.length > 0) {
                    await redisClient.del(userSocketsKey);
                }
                
                // Online users listesinden çıkar
                await redisClient.sRem(ONLINE_USERS_KEY, userIdStr);
                
                // Tüm kullanıcılara offline durumu bildir
                if (io) {
                    io.emit('user_offline', { userId: userIdStr });
                }
            } catch (error) {
                logger.error('Error disconnecting sockets during logout:', error);
                // Hata olsa bile logout işlemi devam etsin
            }
        }
        
        // Refresh token cookie'sini temizle
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });
        
        res.status(200).json({ 
            message: 'Logout successful' 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports.refreshToken = async (req, res) => {
    try {
        // Refresh token'ı cookie'den veya body'den al
        const refreshToken = req.cookies?.refreshToken;
        
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }
        
        const { accessToken, refreshToken: newRefreshToken } = await authService.refreshToken(refreshToken);
        
        // Yeni refresh token'ı httpOnly cookie olarak gönder
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 gün
        });
        
        res.status(200).json({ 
            message: 'Token refreshed successfully', 
            accessToken 
        });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
}

module.exports.getMe = async (req, res) => {
    try {
        const user = await userService.getCurrentUser(req.user.userId);
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
}