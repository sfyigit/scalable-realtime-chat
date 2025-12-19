const cron = require('node-cron');
const { planMessages } = require('./messagePlanning.service');
const { processQueue } = require('./queueManagement.service');
const logger = require('../utils/logger');

/**
 * Message Planning Cron Job
 * Runs every night at 02:00
 */
function startMessagePlanningCron() {
    // Run every night at 02:00 (0 2 * * *)
    cron.schedule('0 2 * * *', async () => {
        logger.info('[Cron] Message Planning Job triggered at', new Date().toISOString());
        try {
            await planMessages();
        } catch (error) {
            logger.error('[Cron] Error in Message Planning Job:', error);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Istanbul" // Turkey time
    });

    console.log('[Cron] Message Planning Job scheduled (02:00 AM daily)');
}

/**
 * Queue Management Cron Job
 * Runs every minute
 */
function startQueueManagementCron() {
    // Run every minute (* * * * *)
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
 * Start all cron jobs
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

