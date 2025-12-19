const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/auth.middleware');
const { getConversationMessages, markConversationAsRead } = require('./messages.controller');

router.use(authMiddleware);

router.get('/conversation/:conversationId', getConversationMessages);
router.patch('/conversation/:conversationId/read', markConversationAsRead);

module.exports = router;