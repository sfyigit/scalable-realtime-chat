const messagesService = require('./messages.service');

module.exports.getConversationMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        const messages = await messagesService.getConversationMessages(
            conversationId,
            userId,
            page,
            limit
        );

        res.status(200).json({
            success: true,
            data: messages,
            page,
            limit
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

module.exports.markConversationAsRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const result = await messagesService.markConversationAsRead(conversationId, userId);

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};