const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logLevel = process.env.LOG_LEVEL || 'info';

// Logs dizinini oluştur
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logger = pino({
    level: logLevel,
    transport: {
        targets: [
            {
                target: 'pino/file',
                level: logLevel,
                options: {
                    destination: path.join(logsDir, 'app.log'),
                    mkdir: true
                }
            }
        ]
    }
});

module.exports = logger;