const cron = require('node-cron');
const { planMessages } = require('./messagePlanning.service');
const { processQueue } = require('./queueManagement.service');
const logger = require('../utils/logger');

/**
 * Mesaj Planlama Cron Job
 * Her gece saat 02:00'da çalışır
 */
function startMessagePlanningCron() {
    // Her gece saat 02:00'da çalış (0 2 * * *)
    cron.schedule('0 2 * * *', async () => {
        logger.info('[Cron] Message Planning Job triggered at', new Date().toISOString());
        try {
            await planMessages();
        } catch (error) {
            logger.error('[Cron] Error in Message Planning Job:', error);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Istanbul" // Türkiye saati
    });

    console.log('[Cron] Message Planning Job scheduled (02:00 AM daily)');
}

/**
 * Kuyruk Yönetimi Cron Job
 * Her dakika çalışır
 */
function startQueueManagementCron() {
    // Her dakika çalış (* * * * *)
    cron.schedule('* * * * *', async () => {
        try {
            await processQueue();
        } catch (error) {
            logger.error('[Cron] Error in Queue Management Job:', error);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Istanbul"
    });

    console.log('[Cron] Queue Management Job scheduled (every minute)');
}

/**
 * Tüm cron job'ları başlat
 */
function startAllCronJobs() {
    startMessagePlanningCron();
    startQueueManagementCron();
}

module.exports = {
    startMessagePlanningCron,
    startQueueManagementCron,
    startAllCronJobs
};

