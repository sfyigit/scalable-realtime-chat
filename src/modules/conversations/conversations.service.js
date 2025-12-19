const Conversation = require('../../models/conversation.model');
const Message = require('../../models/message.model');
const User = require('../../models/user.model');

module.exports.createConversation = async (userId, participantIds, type = 'direct', name = null) => {
    if (type === 'direct' && participantIds.length !== 1) {
        throw new Error('Direct conversation must have exactly one other participant');
    }

    const allParticipants = [userId, ...participantIds];
    const users = await User.find({ _id: { $in: allParticipants } });
    if (users.length !== allParticipants.length) {
        throw new Error('One or more participants not found');
    }

    // Direct conversation için mevcut conversation var mı kontrol et
    if (type === 'direct') {
        const existing = await Conversation.findOne({
            type: 'direct',
            participants: { $all: allParticipants, $size: 2 }
        });
        if (existing) {
            return existing.populate('participants', 'name email');
        }
    }

    const conversation = await Conversation.create({
        participants: allParticipants,
        type,
        name
    });

    return conversation.populate('participants', 'name email');
};

module.exports.getUserConversations = async (userId, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    
    const conversations = await Conversation.find({
        participants: userId
    })
    .populate('participants', 'name email')
    .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'name email' }
    })
    .sort({ lastMessageAt: -1 })
    .skip(skip)
    .limit(limit);

    // Her conversation için okunmamış mesaj sayısını ekle
    const conversationsWithUnread = await Promise.all(
        conversations.map(async (conv) => {
            const unreadCount = await Message.countDocuments({
                conversationId: conv._id,
                senderId: { $ne: userId },
                'readBy.userId': { $ne: userId }
            });
            
            const convObj = conv.toObject();
            convObj.unreadCount = unreadCount;
            return convObj;
        })
    );

    return conversationsWithUnread;
};

module.exports.getConversationById = async (conversationId, userId) => {
    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId
    })
    .populate('participants', 'name email')
    .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'name email' }
    });

    if (!conversation) {
        throw new Error('Conversation not found or access denied');
    }

    return conversation;
};

