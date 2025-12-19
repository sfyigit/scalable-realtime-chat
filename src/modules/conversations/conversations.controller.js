const conversationsService = require('./conversations.service');

module.exports.createConversation = async (req, res) => {
    try {
        const { participantIds, type, name } = req.body;
        const userId = req.user.userId;

        const conversation = await conversationsService.createConversation(
            userId,
            participantIds,
            type,
            name
        );

        res.status(201).json({
            success: true,
            data: conversation
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
};

module.exports.getUserConversations = async (req, res) => {
    try {
        const userId = req.user.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const conversations = await conversationsService.getUserConversations(
            userId,
            page,
            limit
        );

        res.status(200).json({
            success: true,
            data: conversations,
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

module.exports.getConversationById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const conversation = await conversationsService.getConversationById(id, userId);

        res.status(200).json({
            success: true,
            data: conversation
        });
    } catch (error) {
        res.status(404).json({
            success: false,
            error: error.message
        });
    }
};