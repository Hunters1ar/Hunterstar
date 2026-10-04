const crypto = require('crypto');

function env(name, fallback) {
    return process.env[name] || fallback;
}

module.exports = {
    apps: [{
        name: 'portfolio-api',
        script: 'server.js',
        cwd: '/opt/portfolio-api',
        env: {
            NODE_ENV: 'production',
            PORT: env('PORT', '3001'),
            ALLOWED_ORIGINS: env('ALLOWED_ORIGINS', 'https://hunterstar.uz,https://www.hunterstar.uz,https://admin.hunterstar.uz'),
            SESSION_SECRET: env('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),
            TWO_FACTOR_ISSUER: env('TWO_FACTOR_ISSUER', 'Hunterstar Admin'),
            PRIVATE_TWO_FACTOR_ISSUER: env('PRIVATE_TWO_FACTOR_ISSUER', 'Hunterstar Private'),
            // Playlist ID is public (it's in the YouTube URL); the secret
            // YOUTUBE_API_KEY is intentionally NOT here — set it in /opt/portfolio-api/.env
            YOUTUBE_PLAYLIST_ID: env('YOUTUBE_PLAYLIST_ID', 'PLrEYU1gx-0UOsV8mDxgkbBc_qqleKsRxW')
        },
        instances: 1,
        autorestart: true,
        max_memory_restart: '200M',
        log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }]
};
