const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    },
    lastMessageAt: {
        type: Date,
        default: Date.now
    },
    type: {
        type: String,
        enum: ['direct', 'group'],
        default: 'direct'
    },
    name: {
        type: String,
        default: null
    }
}, { timestamps: true });

conversationSchema.index({ participants: 1, type: 1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);