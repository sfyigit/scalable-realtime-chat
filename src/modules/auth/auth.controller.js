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
        
        // Send refresh token as httpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
        
        // Send refresh token as httpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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

        // Get user ID from token (should come from auth middleware)
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
        
        // Use userId from auth middleware if available
        if (!userId && req.user?.userId) {
            userId = req.user.userId;
        }
        
        if (userId) {
            // Delete refresh token
            await authService.logout(userId);
            
            // Disconnect socket connections and clean up from Redis
            try {
                const io = getIO();
                const userIdStr = userId.toString();
                const USER_SOCKETS_PREFIX = 'user_sockets:';
                const ONLINE_USERS_KEY = 'online_users';
                const userSocketsKey = `${USER_SOCKETS_PREFIX}${userIdStr}`;
                
                // Get all user's sockets from Redis
                const socketIds = await redisClient.sMembers(userSocketsKey);
                
                // Disconnect each socket
                if (io && socketIds.length > 0) {
                    socketIds.forEach(socketId => {
                        const socket = io.sockets.sockets.get(socketId);
                        if (socket) {
                            socket.disconnect(true); // Force disconnect
                        }
                    });
                }
                
                // Clear user's sockets from Redis
                if (socketIds.length > 0) {
                    await redisClient.del(userSocketsKey);
                }
                
                // Remove from online users list
                await redisClient.sRem(ONLINE_USERS_KEY, userIdStr);
                
                // Notify all users of offline status
                if (io) {
                    io.emit('user_offline', { userId: userIdStr });
                }
            } catch (error) {
                logger.error('Error disconnecting sockets during logout:', error);
                // Continue logout process even if there's an error
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
        // Get refresh token from cookie or body
        const refreshToken = req.cookies?.refreshToken;
        
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }
        
        const { accessToken, refreshToken: newRefreshToken } = await authService.refreshToken(refreshToken);
        
        // Send new refresh token as httpOnly cookie
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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