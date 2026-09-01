import https from 'https';
import { getConfigValue } from './utils/configManager.js';

export async function reportErrorToTelegram(error, context = '') {
    const botToken = process.env.ANALYTICS_BOT || getConfigValue('analytics-bot');
    const chatId = process.env.ANALYTICS_CHAT_ID || getConfigValue('analytics-chat-id');

    if (!botToken || !chatId) {
        if (!chatId) console.warn('\x1b[33m[Analytics]\x1b[0m Cannot report error to Telegram: Chat ID is missing. Run `hunterstar config analytics-chat-id <YOUR_CHAT_ID>` to set it.');
        return;
    }

    try {
        const errorMsg = error instanceof Error ? error.stack || error.message : String(error);
        const text = `🚨 *Hunterstar CLI Error*\n\n*Context:* ${context}\n*Error:* \n\`\`\`\n${errorMsg}\n\`\`\``;

        const payload = JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        });

        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${botToken}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve(data);
                });
            });

            req.on('error', (e) => reject(e));
            req.write(payload);
            req.end();
        });
    } catch (e) {
        // Silently fail if we can't report the error to avoid infinite loops
        console.error('Failed to report error to analytics bot:', e.message);
    }
}

export function initGlobalErrorTracking() {
    process.on('uncaughtException', async (error) => {
        console.error('\n\x1b[31m[Fatal Error]\x1b[0m', error.message);
        await reportErrorToTelegram(error, 'Uncaught Exception (CLI Crash)');
        process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
        console.error('\n\x1b[31m[Unhandled Promise Rejection]\x1b[0m', reason);
        await reportErrorToTelegram(reason, 'Unhandled Rejection');
    });
}
