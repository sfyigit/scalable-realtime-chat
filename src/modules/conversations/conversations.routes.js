const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/auth.middleware');
const {
    createConversation,
    getUserConversations,
    getConversationById
} = require('./conversations.controller');

router.use(authMiddleware);

router.post('/', createConversation);
router.get('/', getUserConversations);
router.get('/:id', getConversationById);

module.exports = router;