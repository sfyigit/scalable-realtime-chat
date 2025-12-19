const User = require('../models/user.model');
const AutoMessage = require('../models/autoMessage.model');
const logger = require('../utils/logger');

/**
 * Aktif kullanıcıları eşleştirerek otomatik mesajlar planlar
 * Her gece saat 02:00'da çalışır
 */
async function planMessages() {
    try {
        logger.info('[Message Planning] Starting message planning at', new Date().toISOString());
        // Tüm aktif kullanıcıları çek
        const activeUsers = await User.find({ isActive: true }).select('_id name');
        
        if (activeUsers.length < 2) {
            logger.info('[Message Planning] Not enough active users to create pairs. Minimum 2 users required.');
            return;
        }

        // Kullanıcı listesini rastgele karıştır (Fisher-Yates shuffle)
        const shuffledUsers = [...activeUsers];
        for (let i = shuffledUsers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledUsers[i], shuffledUsers[j]] = [shuffledUsers[j], shuffledUsers[i]];
        }

        // İkişerli gruplara ayırarak çiftler oluştur
        const pairs = [];
        for (let i = 0; i < shuffledUsers.length - 1; i += 2) {
            pairs.push({
                sender: shuffledUsers[i],
                receiver: shuffledUsers[i + 1]
            });
        }

        // Eğer tek sayıda kullanıcı varsa, son kullanıcıyı ilk çiftin alıcısı yap
        if (shuffledUsers.length % 2 === 1) {
            pairs[0].receiver = shuffledUsers[shuffledUsers.length - 1];
        }

        // Her çift için mesaj içeriği hazırla ve sendDate belirle
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const autoMessages = [];

        for (const pair of pairs) {
            // sendDate'i yarın için rastgele bir saat olarak belirle
            const sendDate = new Date(tomorrow);
            
            // Rastgele bir saat seç (0-23 arası)
            const randomHour = Math.floor(Math.random() * 24);
            sendDate.setHours(randomHour, Math.floor(Math.random() * 60), 0, 0);
            
            // sendDate'e göre mesaj içeriğini belirle
            const sendHour = sendDate.getHours();
            let greeting;
            
            if (sendHour < 11) {
                // 11:00'dan önce
                greeting = `Günaydın ${pair.receiver.name}`;
            } else if (sendHour >= 11 && sendHour < 16) {
                // 11:00 - 16:00 arası
                greeting = `İyi günler ${pair.receiver.name}`;
            } else {
                // 16:00 - 05:00 arası (16:00'dan sonra veya 05:00'dan önce)
                greeting = `İyi akşamlar ${pair.receiver.name}`;
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

        // Tüm mesajları veritabanına kaydet
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

