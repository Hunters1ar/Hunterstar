import https from 'https';
import { getConfigValue } from './utils/configManager.js';
import { isUserCancellation } from './utils/errors.js';

export async function reportErrorToTelegram(error, context = '') {
    if (isUserCancellation(error)) return;
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
            req.setTimeout(5000, () => req.destroy(new Error('Analytics request timed out')));
            req.write(payload);
            req.end();
        });
    } catch (e) {
        // Silently fail if we can't report the error to avoid infinite loops
        console.error('Failed to report error to analytics bot:', e.message);
    }
}

function escapeTelegramHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export async function reportTeachingToTelegram({
    prompt = '',
    sessionUser = 'guest',
    before = '',
    mistake = '',
    whatTaught = [],
    whatToExpect = '',
    score = null,
    fetchImpl = globalThis.fetch
} = {}) {
    const botToken = process.env.ANALYTICS_BOT || getConfigValue('analytics-bot');
    const chatId = process.env.ANALYTICS_CHAT_ID || getConfigValue('analytics-chat-id');

    if (!botToken || !chatId) return null;

    try {
        let lessons = [];
        if (Array.isArray(whatTaught)) {
            lessons = whatTaught;
        } else if (typeof whatTaught === 'string' && whatTaught.trim()) {
            lessons = whatTaught.split(/\n+/).map(l => l.replace(/^[-*•\s]+/, '').trim()).filter(Boolean);
        }
        if (lessons.length === 0) {
            lessons = ['Role separation and dynamic session identity alignment.'];
        }

        const lessonsHtml = lessons.map(l => `• ${escapeTelegramHtml(l)}`).join('\n');
        const scoreText = score ? ` (Score: <b>${score}/10</b>)` : '';

        const text = `🧠 <b>Hunterstar AI Teaching Report</b>${scoreText}\n` +
            `👤 <b>Session User:</b> <code>${escapeTelegramHtml(sessionUser)}</code>\n` +
            `🎯 <b>Prompt:</b> <code>${escapeTelegramHtml(prompt)}</code>\n\n` +
            `<b>Before:</b>\n<pre>${escapeTelegramHtml(before || 'No previous answer')}</pre>\n\n` +
            `<b>What was the mistake:</b>\n${escapeTelegramHtml(mistake || 'Suboptimal or confused output.')}\n\n` +
            `<b>What taught:</b>\n${lessonsHtml}\n\n` +
            `<b>What to expect:</b>\n<pre>${escapeTelegramHtml(whatToExpect || 'Target response')}</pre>`;

        const payload = JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML'
        });

        const res = await (fetchImpl || fetch)(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.warn('[Analytics Error] Telegram send failed:', errBody);
            return null;
        }

        return await res.json();
    } catch (err) {
        console.warn('[Analytics Error] Failed to send teaching report to Telegram:', err.message);
        return null;
    }
}

export function initGlobalErrorTracking() {
    process.on('uncaughtException', async (error) => {
        if (isUserCancellation(error)) process.exit(0);
        console.error('\n\x1b[31m[Fatal Error]\x1b[0m', error.message);
        await reportErrorToTelegram(error, 'Uncaught Exception (CLI Crash)');
        process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
        if (isUserCancellation(reason)) return;
        console.error('\n\x1b[31m[Unhandled Promise Rejection]\x1b[0m', reason);
        await reportErrorToTelegram(reason, 'Unhandled Rejection');
    });
}
