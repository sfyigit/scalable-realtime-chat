const User = require('../models/user.model');
const AutoMessage = require('../models/autoMessage.model');
const logger = require('../utils/logger');

/**
 * Plans automatic messages by pairing active users
 * Runs every night at 02:00
 */
async function planMessages() {
    try {
        logger.info('[Message Planning] Starting message planning at', new Date().toISOString());
        // Fetch all active users
        const activeUsers = await User.find({ isActive: true }).select('_id name');
        
        if (activeUsers.length < 2) {
            logger.info('[Message Planning] Not enough active users to create pairs. Minimum 2 users required.');
            return;
        }

        // Randomly shuffle the user list (Fisher-Yates shuffle)
        const shuffledUsers = [...activeUsers];
        for (let i = shuffledUsers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledUsers[i], shuffledUsers[j]] = [shuffledUsers[j], shuffledUsers[i]];
        }

        // Create pairs by grouping into pairs of two
        const pairs = [];
        for (let i = 0; i < shuffledUsers.length - 1; i += 2) {
            pairs.push({
                sender: shuffledUsers[i],
                receiver: shuffledUsers[i + 1]
            });
        }

        // If there's an odd number of users, make the last user the receiver of the first pair
        if (shuffledUsers.length % 2 === 1) {
            pairs[0].receiver = shuffledUsers[shuffledUsers.length - 1];
        }

        // Prepare message content and set sendDate for each pair
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const autoMessages = [];

        for (const pair of pairs) {
            // Set sendDate to a random hour tomorrow
            const sendDate = new Date(tomorrow);
            
            // Select a random hour (0-23)
            const randomHour = Math.floor(Math.random() * 24);
            sendDate.setHours(randomHour, Math.floor(Math.random() * 60), 0, 0);
            
            // Determine message content based on sendDate
            const sendHour = sendDate.getHours();
            let greeting;
            
            if (sendHour < 11) {
                // Before 11:00
                greeting = `Good morning ${pair.receiver.name}`;
            } else if (sendHour >= 11 && sendHour < 16) {
                // Between 11:00 - 16:00
                greeting = `Good day ${pair.receiver.name}`;
            } else {
                // Between 16:00 - 05:00 (after 16:00 or before 05:00)
                greeting = `Good evening ${pair.receiver.name}`;
            }

            autoMessages.push({
                senderId: pair.sender._id,
                receiverId: pair.receiver._id,
                content: greeting,
                sendDate: sendDate,
                isQueued: false,
                isSent: false
            });
        }

        // Save all messages to database
        const savedMessages = await AutoMessage.insertMany(autoMessages);
        
        logger.info(`[Message Planning] Successfully planned ${savedMessages.length} messages`);
        return savedMessages;
    } catch (error) {
        logger.error('[Message Planning] Error planning messages:', error);
        throw error;
    }
}

module.exports = {
    planMessages
};

