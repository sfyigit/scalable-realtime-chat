const Message = require('../../models/message.model');
const Conversation = require('../../models/conversation.model');

module.exports.getConversationMessages = async (conversationId, userId, page = 1, limit = 50) => {
    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId
    });

    if (!conversation) {
        throw new Error('Conversation not found or access denied');
    }

    const skip = (page - 1) * limit;

    const messages = await Message.find({ conversationId })
        .populate('senderId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    return messages.reverse();
};

module.exports.markConversationAsRead = async (conversationId, userId) => {
    // Conversation'ın var olduğunu ve kullanıcının katılımcı olduğunu kontrol et
    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId
    });

    if (!conversation) {
        throw new Error('Conversation not found or access denied');
    }

    // Bu conversation'daki, bu kullanıcı tarafından gönderilmemiş ve henüz okunmamış tüm mesajları bul
    const unreadMessages = await Message.find({
        conversationId,
        senderId: { $ne: userId },
        'readBy.userId': { $ne: userId }
    });

    // Her mesajı okundu işaretle
    const now = new Date();
    const userIdStr = userId.toString();
    const updatePromises = unreadMessages.map(message => {
        // Eğer bu kullanıcı zaten readBy listesinde değilse ekle
        const alreadyRead = message.readBy.some(
            readEntry => {
                if (!readEntry.userId) return false;
                const entryUserIdStr = readEntry.userId.toString ? readEntry.userId.toString() : String(readEntry.userId);
                return entryUserIdStr === userIdStr;
            }
        );

        if (!alreadyRead) {
            message.readBy.push({
                userId: userId,
                readAt: now
            });
            return message.save();
        }
        return Promise.resolve();
    });

    await Promise.all(updatePromises);

    return {
        conversationId,
        markedCount: unreadMessages.length
    };
};
