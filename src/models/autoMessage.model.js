const mongoose = require('mongoose');

const autoMessageSchema = new mongoose.Schema({
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    sendDate: {
        type: Date,
        required: true,
        index: true
    },
    isQueued: {
        type: Boolean,
        default: false,
        index: true
    },
    isSent: {
        type: Boolean,
        default: false,
        index: true
    }
}, { timestamps: true });

// Indexes: for sendDate and isQueued combination
autoMessageSchema.index({ sendDate: 1, isQueued: 1 });
autoMessageSchema.index({ isSent: 1 });

module.exports = mongoose.model('AutoMessage', autoMessageSchema);

