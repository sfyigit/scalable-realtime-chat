const express = require('express');
const router = express.Router();
const { register, login, logout, refreshToken, getMe } = require('./auth.controller');
const { registerSchema, loginSchema } = require('./auth.schema');
const authMiddleware = require('../../middlewares/auth.middleware');
const { authRateLimiter } = require('../../middlewares/rateLimit.middleware');

const validate = require('../../middlewares/validate.middleware');

// Apply strict rate limiting to authentication routes
router.post('/register', authRateLimiter, validate(registerSchema), register);
router.post('/login', authRateLimiter, validate(loginSchema), login);
router.post('/logout', authMiddleware, logout);
router.post('/refresh', authRateLimiter, refreshToken);
router.get('/me', authMiddleware, getMe);

module.exports = router;

