const express = require('express');
const router = express.Router();
const { getUserList, getUserById, updateUser } = require('./users.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

// Tüm route'lar authentication gerektirir
router.use(authMiddleware);

router.get('/list', getUserList);
router.patch('/me', updateUser);
router.get('/:id', getUserById);

module.exports = router;