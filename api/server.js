const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { generateSecret, generateURI, verify: verifyOtpToken } = require('otplib');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function resolveLocalFile(filePath) {
    if (path.isAbsolute(filePath)) return filePath;

    const candidates = [
        path.resolve(__dirname, filePath),
        path.resolve(process.cwd(), filePath)
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

loadEnvFile(path.join(__dirname, '.env'));

function stripWrappingQuotes(value) {
    const trimmed = String(value || '').trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1);
        }
    }

    return trimmed;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://hunterstar.uz,https://www.hunterstar.uz,https://admin.hunterstar.uz')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_SESSION_COOKIE = 'admin_session';
const PRIVATE_SESSION_COOKIE = 'private_session';
const ADMIN_SESSION_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const TWO_FACTOR_CHALLENGE_MAX_AGE = 10 * 60 * 1000; // 10 minutes
const TWO_FACTOR_ISSUER = stripWrappingQuotes(process.env.TWO_FACTOR_ISSUER) || 'Hunterstar Admin';
const PRIVATE_TWO_FACTOR_ISSUER = stripWrappingQuotes(process.env.PRIVATE_TWO_FACTOR_ISSUER) || 'Hunterstar Private';

// YouTube playlist proxy (key kept server-side; never shipped to the browser)
const YOUTUBE_API_KEY = stripWrappingQuotes(process.env.YOUTUBE_API_KEY) || '';
const YOUTUBE_PLAYLIST_ID = stripWrappingQuotes(process.env.YOUTUBE_PLAYLIST_ID) || 'PLrEYU1gx-0UOsV8mDxgkbBc_qqleKsRxW';
const PLAYLIST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Firebase collections (mirrored from firebase-config.js)
const PRIMARY_SUBMISSION_COLLECTION = 'my comments';
const LEGACY_SUBMISSION_COLLECTIONS = ['contact-submissions'];
const SUBMISSION_COLLECTIONS = [...new Set([PRIMARY_SUBMISSION_COLLECTION, ...LEGACY_SUBMISSION_COLLECTIONS])];
const CONTENT_BOXES_COLLECTION = 'content_boxes';
const PLAYLISTS_COLLECTION = 'playlists';
const ARCHIVE_STORAGE_FOLDER = 'archives';
const ADMIN_TWO_FACTOR_COLLECTION = 'admin_two_factor';
const PRIVATE_TWO_FACTOR_COLLECTION = 'private_two_factor';
const PRIVATE_DIARY_COLLECTION = 'private_diary_pages';
const PRIVATE_DIARY_STORAGE_FOLDER = 'private-diary';
const PRIVATE_DIARY_TEXT_MAX_LENGTH = 120000;

// Cloud Function storage relay (used when VPS cannot reach Firebase Storage directly)
const CLOUD_FUNCTION_UPLOAD_URL = stripWrappingQuotes(process.env.CLOUD_FUNCTION_UPLOAD_URL) || '';
const CLOUD_FUNCTION_UPLOAD_SECRET = stripWrappingQuotes(process.env.CLOUD_FUNCTION_UPLOAD_SECRET) || '';

// ---------------------------------------------------------------------------
// Firebase Admin SDK Init
// ---------------------------------------------------------------------------
const serviceAccountPath = resolveLocalFile(process.env.FIREBASE_SERVICE_ACCOUNT || 'service-account.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
        storageBucket: 'portfolio-9b8a5.firebasestorage.app'
    });
    console.log('Firebase Admin SDK initialized');
} catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error.message);
    process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket();
const adminTwoFactorCollection = db.collection(ADMIN_TWO_FACTOR_COLLECTION);
const privateTwoFactorCollection = db.collection(PRIVATE_TWO_FACTOR_COLLECTION);
const privateDiaryCollection = db.collection(PRIVATE_DIARY_COLLECTION);

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const app = express();

// Trust proxy (behind Nginx)
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// PUBLIC YOUTUBE PLAYLIST PROXY
// ---------------------------------------------------------------------------
// Registered BEFORE the global (credentialed, allow-listed) CORS so it can be
// served to any origin as public, read-only data. The API key stays here on
// the server and is never exposed to the browser. Results are cached in-memory
// to keep YouTube quota usage low.
const playlistCache = { at: 0, key: '', data: null };

const youtubeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please try again later.' }
});

async function fetchPlaylistVideos(playlistId) {
    const fetch = (await import('node-fetch')).default;
    const videos = [];
    let pageToken = '';

    // Paginate so playlists with >50 videos all load
    do {
        const url =
            'https://www.googleapis.com/youtube/v3/playlistItems' +
            '?part=snippet,contentDetails' +
            `&playlistId=${encodeURIComponent(playlistId)}` +
            '&maxResults=50' +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '') +
            `&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

        const response = await fetch(url);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const error = new Error(data?.error?.message || `YouTube API error ${response.status}`);
            error.statusCode = response.status;
            throw error;
        }

        for (const item of data.items || []) {
            const thumbs = item?.snippet?.thumbnails;
            if (!thumbs) continue; // skip deleted/private videos
            const thumb =
                (thumbs.maxres && thumbs.maxres.url) ||
                (thumbs.standard && thumbs.standard.url) ||
                (thumbs.high && thumbs.high.url) ||
                (thumbs.medium && thumbs.medium.url) ||
                (thumbs.default && thumbs.default.url) ||
                '';
            if (!thumb) continue; // no usable thumbnail — skip
            videos.push({
                id: item.contentDetails.videoId,
                title: item.snippet.title,
                thumb
            });
        }

        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return videos;
}

app.get('/api/playlist', cors({ origin: '*', methods: ['GET'] }), youtubeLimiter, async (req, res) => {
    try {
        if (!YOUTUBE_API_KEY) {
            return res.status(500).json({ ok: false, error: 'Playlist is not configured on the server.' });
        }

        // Default to the configured playlist; allow an optional, format-checked override
        const requested = typeof req.query.playlistId === 'string' ? req.query.playlistId.trim() : '';
        const playlistId = /^[A-Za-z0-9_-]{10,64}$/.test(requested) ? requested : YOUTUBE_PLAYLIST_ID;

        // ?refresh=1 forces a fresh pull — use it right after adding/removing videos
        const refresh = req.query.refresh === '1' || req.query.nocache === '1';

        // Tell the browser not to hold its own copy; the in-memory cache below is
        // what protects YouTube quota (one upstream call per TTL across all visitors).
        res.set('Cache-Control', 'no-store');

        const now = Date.now();
        if (!refresh && playlistCache.data && playlistCache.key === playlistId && now - playlistCache.at < PLAYLIST_CACHE_TTL) {
            return res.json({ ok: true, cached: true, count: playlistCache.data.length, videos: playlistCache.data });
        }

        const videos = await fetchPlaylistVideos(playlistId);
        playlistCache.at = now;
        playlistCache.key = playlistId;
        playlistCache.data = videos;

        res.json({ ok: true, count: videos.length, videos });
    } catch (error) {
        console.error('Playlist proxy error:', error.message);
        const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
        res.status(status).json({ ok: false, error: error.message || 'Failed to load playlist.' });
    }
});

// ---------------------------------------------------------------------------
// PUBLIC MULTI-PLAYLIST PROXY (one carousel per configured playlist)
// ---------------------------------------------------------------------------
const playlistsCache = { at: 0, data: null };

function parsePlaylistId(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    // Accept a full YouTube URL (…?list=ID) or a bare ID
    const match = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
    const candidate = match ? match[1] : raw;
    return /^[A-Za-z0-9_-]{10,64}$/.test(candidate) ? candidate : '';
}

async function fetchPlaylistTitle(playlistId) {
    const fetch = (await import('node-fetch')).default;
    const url =
        'https://www.googleapis.com/youtube/v3/playlists' +
        '?part=snippet' +
        `&id=${encodeURIComponent(playlistId)}` +
        `&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data?.error?.message || `YouTube API error ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }
    const item = (data.items || [])[0];
    return item && item.snippet ? item.snippet.title : '';
}

async function loadConfiguredPlaylistIds() {
    try {
        const snapshot = await db.collection(PLAYLISTS_COLLECTION).get();
        const entries = snapshot.docs
            .map((doc) => ({ id: doc.id, order: Number(doc.data().order) || 0 }))
            .sort((a, b) => a.order - b.order);
        if (entries.length) return entries.map((entry) => entry.id);
    } catch (error) {
        console.warn('playlists collection read failed:', error.message);
    }
    // Fallback to the single default playlist so the page is never empty
    return YOUTUBE_PLAYLIST_ID ? [YOUTUBE_PLAYLIST_ID] : [];
}

app.get('/api/playlists', cors({ origin: '*', methods: ['GET'] }), youtubeLimiter, async (req, res) => {
    try {
        if (!YOUTUBE_API_KEY) {
            return res.status(500).json({ ok: false, error: 'Playlist is not configured on the server.' });
        }

        const refresh = req.query.refresh === '1' || req.query.nocache === '1';
        res.set('Cache-Control', 'no-store');

        const now = Date.now();
        if (!refresh && playlistsCache.data && now - playlistsCache.at < PLAYLIST_CACHE_TTL) {
            return res.json({ ok: true, cached: true, count: playlistsCache.data.length, playlists: playlistsCache.data });
        }

        const ids = await loadConfiguredPlaylistIds();
        const playlists = [];
        for (const id of ids) {
            let title = '';
            let videos = [];
            let titleErr = null;
            let videosErr = null;

            try { title = await fetchPlaylistTitle(id); } catch (e) { titleErr = e; }
            try { videos = await fetchPlaylistVideos(id); } catch (e) { videosErr = e; }

            if (videosErr && titleErr) {
                // Both failed — skip and warn
                console.warn('playlist fetch fully failed:', id, videosErr.message);
                continue;
            }
            if (videosErr) {
                console.warn('playlist videos fetch failed (will show empty shelf):', id, videosErr.message);
            }
            if (titleErr) {
                console.warn('playlist title fetch failed (using fallback):', id, titleErr.message);
            }
            // Always include the playlist — even if it has 0 visible videos after
            // filtering unavailable/private items; it prevents silent disappearance.
            playlists.push({ id, title: title || 'Playlist', count: videos.length, videos });
        }

        playlistsCache.at = now;
        playlistsCache.data = playlists;
        res.json({ ok: true, count: playlists.length, playlists });
    } catch (error) {
        console.error('Playlists proxy error:', error.message);
        const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
        res.status(status).json({ ok: false, error: error.message || 'Failed to load playlists.' });
    }
});

// CORS
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS not allowed'));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Rate Limiters
// ---------------------------------------------------------------------------
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please try again later.' }
});

// ---------------------------------------------------------------------------
// AI Assistant Endpoint (OpenRouter)
// ---------------------------------------------------------------------------
const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many messages. Please wait a moment.' }
});

// Cache for AI context data (refresh every 5 minutes)
const aiContextCache = { at: 0, data: null };
const AI_CONTEXT_TTL = 5 * 60 * 1000;

async function buildAiContext() {
    const now = Date.now();
    if (aiContextCache.data && now - aiContextCache.at < AI_CONTEXT_TTL) {
        return aiContextCache.data;
    }

    // Fetch published content boxes (server room notes/archives)
    let archivesText = '';
    try {
        const snapshot = await db.collection(CONTENT_BOXES_COLLECTION)
            .where('published', '==', true)
            .get();

        const boxes = snapshot.docs
            .map(mapContentBox)
            .sort((a, b) => a.order - b.order);

        if (boxes.length > 0) {
            archivesText = '\n\n=== LIVE ARCHIVE / SERVER ROOM NOTES ===\n';
            archivesText += 'The following are Khurshid\'s published notes, projects, and resources stored in his Server Room Archive. Help users find them:\n\n';
            for (const box of boxes) {
                archivesText += `📁 [${box.title}]\n`;
                if (box.summary) archivesText += `   Summary: ${box.summary}\n`;
                if (box.notes) archivesText += `   Notes: ${box.notes.slice(0, 400)}${box.notes.length > 400 ? '...' : ''}\n`;
                if (box.links && box.links.length > 0) {
                    archivesText += `   Links:\n`;
                    for (const link of box.links) {
                        archivesText += `     - ${link.label}: ${link.url}\n`;
                    }
                }
                if (box.attachments && box.attachments.length > 0) {
                    archivesText += `   Files: ${box.attachments.map(a => a.name).join(', ')}\n`;
                }
                archivesText += '\n';
            }
            archivesText += `Users can visit the full archive at: https://hunterstar.uz/archives\n`;
        }
    } catch (err) {
        console.warn('AI context: failed to fetch archives:', err.message);
    }

    const context = archivesText;
    aiContextCache.at = now;
    aiContextCache.data = context;
    return context;
}
// --- AI Provider Fallback Mechanism ---
function getAvailableAiKeys() {
    const keys = [];
    if (process.env.OPEN_ROUTER_API_KEY) keys.push({ type: 'openrouter', key: process.env.OPEN_ROUTER_API_KEY });
    for (let i = 1; i <= 10; i++) {
        if (process.env[`OPEN_ROUTER_API_KEY${i}`]) keys.push({ type: 'openrouter', key: process.env[`OPEN_ROUTER_API_KEY${i}`] });
    }
    for (let i = 1; i <= 15; i++) {
        if (process.env[`AI_STUDIO_API_KEY${i}`]) keys.push({ type: 'aistudio', key: process.env[`AI_STUDIO_API_KEY${i}`] });
    }
    if (process.env.AI_STUDIO_API_KEY) keys.push({ type: 'aistudio', key: process.env.AI_STUDIO_API_KEY });
    return keys;
}

async function callAiProviderWithFallback(systemContent, cleanMessages) {
    const keys = getAvailableAiKeys();
    if (keys.length === 0) {
        throw new Error('No AI API keys configured on the server.');
    }

    let lastError = null;
    const fetch = (await import('node-fetch')).default;

    let skipOpenRouter = false;
    for (const { type, key } of keys) {
        if (type === 'openrouter' && skipOpenRouter) continue;
        try {
            if (type === 'openrouter') {
                const model = 'dots-studio/dots-3-note-preview:free';
                const apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'HTTP-Referer': 'https://hunterstar.uz',
                        'X-Title': 'Hunterstar Portfolio',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'system', content: systemContent }, ...cleanMessages]
                    })
                });
                
                const data = await apiResponse.json();
                if (!apiResponse.ok) {
                    throw new Error(data?.error?.message || `OpenRouter API error ${apiResponse.status}`);
                }
                return data; // formatted correctly for frontend
            } else if (type === 'aistudio') {
                const model = 'gemini-3.6-flash';
                const contents = cleanMessages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                }));
                
                const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: systemContent }] },
                        contents
                    })
                });
                
                const data = await apiResponse.json();
                if (!apiResponse.ok) {
                    throw new Error(data?.error?.message || `AI Studio error ${apiResponse.status}`);
                }
                
                const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                return {
                    choices: [
                        { message: { content: textResponse } }
                    ]
                };
            }
        } catch (error) {
            console.warn(`AI Provider (${type}) failed: ${error.message}. Switching to next...`);
            lastError = error;
            if (type === 'openrouter' && error.message.includes('free-models-per-day')) {
                console.warn('OpenRouter free tier limit reached. Skipping remaining OpenRouter keys.');
                skipOpenRouter = true;
            }
            continue;
        }
    }
    
    throw new Error(`All AI providers failed. Last error: ${lastError.message}`);
}

app.post('/api/chat', aiLimiter, async (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ ok: false, error: 'Invalid messages format.' });
        }

        const cleanMessages = messages
            .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-20)
            .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));

        if (cleanMessages.length === 0) {
            return res.status(400).json({ ok: false, error: 'No valid messages provided.' });
        }

        const liveContext = await buildAiContext();
        const systemContent = `You are the official AI assistant on Khurshid Khursandov's (Hunterstar) personal portfolio website at https://hunterstar.uz.

=== WHO IS HUNTERSTAR ===
Full name: Khurshid Khursandov (also written as Xurshid Xursandov / Хуршид Хурсандов)
Alias/Brand: Hunterstar (GitHub: Hunters1ar)
Role: Founder & CEO of Hunterstar | Backend Architect | AI Engineer | Fullstack Developer
Origin: Uzbekistan
Email: kyuter789@gmail.com
Telegram: https://t.me/Hunters1ar
LinkedIn: https://www.linkedin.com/in/khurshidkhursandov
GitHub: https://github.com/Hunters1ar

=== TECHNICAL EXPERTISE ===
Backend: Node.js, Express, NestJS, FastAPI, Python, REST APIs, GraphQL, Microservices
Databases: Firebase (Firestore, Storage, Auth), PostgreSQL, MySQL, MongoDB, Redis, Prisma, SQL, NoSQL
Frontend: React, Next.js, TypeScript, JavaScript, HTML/CSS, Three.js
AI/ML: Machine Learning, TensorFlow, PyTorch, LLMs, NLP, Computer Vision, AI Engineering
DevOps: VPS deployment, PM2, Nginx, SSL/Certbot, SSH, Linux, CI/CD
Security: Secure APIs, 2FA (TOTP/OTPLIB), session management, JWT, rate limiting

=== PORTFOLIO SECTIONS & NAVIGATION ===
- Home / Hero: https://hunterstar.uz — Main landing with 3D scene and typewriter effect
- About / Me: https://hunterstar.uz/me — Personal story, journey, photo gallery
- Archives / Server Room: https://hunterstar.uz/archives — Project notes, resources, downloadable files stored in the 3D server room
- Skills section: Scroll to #expertise on homepage
- Tech Stack: Scroll to #stack on homepage
- Contact form: Scroll to #contact on homepage or email kyuter789@gmail.com
- Terminal: The homepage has an interactive terminal — try commands like: help, whoami, projects, stack, game, contact, archives
- Game: ScriptRunner 3D game embedded on the homepage and at https://hunters1ar.github.io/game/

=== HOW TO HELP USERS ===
- If users ask about Khurshid's skills, experience, or projects — answer with the above info.
- If users want to find something in the archive/server room — look in the LIVE ARCHIVE DATA below and guide them, or tell them to visit https://hunterstar.uz/archives.
- If users want to contact Khurshid — direct them to the contact form at https://hunterstar.uz/#contact or email kyuter789@gmail.com or Telegram @Hunters1ar.
- If users ask about hiring or collaboration — encourage them to reach out via email or Telegram.
- If users are lost on the site — guide them to the right section.
- Keep responses concise and helpful. Use bullet points for lists.
- IMPORTANT: Always detect the language the user writes in and reply in that EXACT same language (Uzbek, Russian, English, etc.). Match their language every time without exception.
${liveContext}`;

        const data = await callAiProviderWithFallback(systemContent, cleanMessages);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('AI chat error:', error.message);
        const status = error.message.includes('No AI API keys') ? 500 : 502;
        res.status(status).json({ ok: false, error: error.message || 'Internal server error during AI chat.' });
    }
});

const cliLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Higher limit for turbo mode scripts
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many messages. Please wait a moment.' }
});

app.post('/api/cli-chat', cliLimiter, async (req, res) => {
    try {
        const { messages, platform } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ ok: false, error: 'Invalid messages format.' });
        }

        const cleanMessages = messages
            .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-20)
            .map(m => ({ role: m.role, content: m.content.slice(0, 10000) }));

        if (cleanMessages.length === 0) {
            return res.status(400).json({ ok: false, error: 'No valid messages provided.' });
        }

        const isWin = platform === 'win32';
        const systemContent = `You are the Hunterstar CLI Assistant, a powerful terminal agent running on the user's local machine.
Operating System: ${isWin ? 'Windows (Powershell)' : 'Linux/Mac (Bash)'}
You can execute local shell commands to fulfill the user's requests.
To execute commands, you MUST output them inside an [EXEC] block like this:
[EXEC]
${isWin ? 'New-Item -ItemType Directory -Name "test_ai"\nSet-Location test_ai\nOut-File -FilePath "hello.txt" -InputObject "hello"' : 'mkdir test_ai\ncd test_ai\necho "hello" > hello.txt'}
[/EXEC]

CRITICAL RULES:
1. Output ONLY ONE [EXEC] block per response.
2. Wait for the user's CLI to run the command and provide you with the output (stdout/stderr/exit code) before continuing.
3. NEVER claim a command succeeded unless the CLI has returned an execution result with exit code 0. Do not fake execution.
4. Be concise. Do not execute destructive commands unless explicitly requested.
${isWin ? '5. You MUST write strictly valid Powershell syntax! Do NOT use Bash syntax like `if [ -f file ]` or `cat > file << EOF`. Use `Get-Content`, `Test-Path`, `Out-File`, etc.' : ''}

You have full access to the user's terminal environment. The current working directory is provided at the start of each user message.`;

        const data = await callAiProviderWithFallback(systemContent, cleanMessages);
        res.json({ ok: true, data });
    } catch (error) {
        console.error('CLI AI chat error:', error.message);
        const status = error.message.includes('No AI API keys') ? 500 : 502;
        res.status(status).json({ ok: false, error: error.message || 'Internal server error during CLI AI chat.' });
    }
});

const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many submissions. Please try again later.' }
});

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
});

const adminAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many login attempts. Please try again later.' }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// ---------------------------------------------------------------------------
// Session Management (simple token-based via secure httpOnly cookie)
// ---------------------------------------------------------------------------
const activeSessions = new Map();
const pendingTwoFactorChallenges = new Map();

function createSession(uid, email, scope = 'admin') {
    const token = crypto.randomBytes(48).toString('hex');
    const now = Date.now();
    activeSessions.set(token, { uid, email, scope, createdAt: now, lastActivityAt: now });
    return token;
}

function clearSessionCookie(res, cookieName) {
    res.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
}

function writeSessionCookie(res, cookieName, token) {
    res.cookie(cookieName, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: ADMIN_SESSION_IDLE_TIMEOUT,
        path: '/'
    });
}

function clearAdminSessionCookie(res) {
    clearSessionCookie(res, ADMIN_SESSION_COOKIE);
}

function writeAdminSessionCookie(res, token) {
    writeSessionCookie(res, ADMIN_SESSION_COOKIE, token);
}

function clearPrivateSessionCookie(res) {
    clearSessionCookie(res, PRIVATE_SESSION_COOKIE);
}

function writePrivateSessionCookie(res, token) {
    writeSessionCookie(res, PRIVATE_SESSION_COOKIE, token);
}

function getSession(token, options = {}) {
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;
    if (options.scope && session.scope !== options.scope) return null;

    const now = Date.now();
    const lastActivityAt = session.lastActivityAt || session.createdAt || now;

    if (now - lastActivityAt > ADMIN_SESSION_IDLE_TIMEOUT) {
        activeSessions.delete(token);
        if (options.res && options.clearCookie) options.clearCookie(options.res);
        return null;
    }

    if (options.touch) {
        session.lastActivityAt = now;
        if (options.res && options.writeCookie) options.writeCookie(options.res, token);
    }

    return session;
}

function destroySession(token) {
    activeSessions.delete(token);
}

function setAdminSessionCookie(res, uid, email) {
    const sessionToken = createSession(uid, email, 'admin');
    writeAdminSessionCookie(res, sessionToken);
}

function setPrivateSessionCookie(res, uid, email) {
    const sessionToken = createSession(uid, email, 'private');
    writePrivateSessionCookie(res, sessionToken);
}

function createTwoFactorChallenge(challenge) {
    const token = crypto.randomBytes(48).toString('hex');
    pendingTwoFactorChallenges.set(token, {
        ...challenge,
        attempts: 0,
        createdAt: Date.now()
    });
    return token;
}

function getTwoFactorChallenge(token) {
    if (!token) return null;

    const challenge = pendingTwoFactorChallenges.get(token);
    if (!challenge) return null;

    if (Date.now() - challenge.createdAt > TWO_FACTOR_CHALLENGE_MAX_AGE) {
        pendingTwoFactorChallenges.delete(token);
        return null;
    }

    return challenge;
}

function destroyTwoFactorChallenge(token) {
    pendingTwoFactorChallenges.delete(token);
}

// Cleanup expired sessions and 2FA challenges every minute.
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions) {
        const lastActivityAt = session.lastActivityAt || session.createdAt || now;
        if (now - lastActivityAt > ADMIN_SESSION_IDLE_TIMEOUT) {
            activeSessions.delete(token);
        }
    }

    for (const [token, challenge] of pendingTwoFactorChallenges) {
        if (now - challenge.createdAt > TWO_FACTOR_CHALLENGE_MAX_AGE) {
            pendingTwoFactorChallenges.delete(token);
        }
    }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
    const token = req.cookies?.[ADMIN_SESSION_COOKIE];
    const session = getSession(token, {
        res,
        scope: 'admin',
        clearCookie: clearAdminSessionCookie,
        writeCookie: writeAdminSessionCookie,
        touch: req.get('x-admin-activity') === '1'
    });

    if (!session) {
        return res.status(401).json({ ok: false, error: 'Authentication required.' });
    }

    req.adminSession = session;
    next();
}

function requirePrivate(req, res, next) {
    const token = req.cookies?.[PRIVATE_SESSION_COOKIE];
    const session = getSession(token, {
        res,
        scope: 'private',
        clearCookie: clearPrivateSessionCookie,
        writeCookie: writePrivateSessionCookie,
        touch: req.get('x-admin-activity') === '1'
    });

    if (!session) {
        return res.status(401).json({ ok: false, error: 'Authentication required.' });
    }

    req.privateSession = session;
    next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeTimestamp(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    return null;
}

function getAttachmentKind(contentType, fileName) {
    const type = String(contentType || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html|css|js)$/.test(name)) return 'text';
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
    if (/\.(exe|msi|msix|bat|cmd|com|scr|ps1|jar|apk|dmg|pkg|deb|rpm)$/.test(name)) return 'program';
    return 'file';
}

function isProgramAttachment(contentType, fileName) {
    const type = String(contentType || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    return [
        'application/x-msdownload', 'application/x-msdos-program',
        'application/vnd.microsoft.portable-executable', 'application/x-msi',
        'application/java-archive', 'application/vnd.android.package-archive',
        'application/x-apple-diskimage'
    ].includes(type) || /\.(exe|msi|msix|bat|cmd|com|scr|ps1|jar|apk|dmg|pkg|deb|rpm)$/i.test(name);
}

// ---------------------------------------------------------------------------
// Upload a file to Firebase Storage via Cloud Function relay
// (bypasses VPS geo-block on googleapis.com)
// ---------------------------------------------------------------------------
async function uploadFileViaCloudFunction(file, { folder, boxId }) {
    const fetch = require('node-fetch');

    const body = JSON.stringify({
        secret: CLOUD_FUNCTION_UPLOAD_SECRET,
        folder,
        boxId,
        fileName: file.originalname,
        contentType: file.mimetype || 'application/octet-stream',
        dataBase64: file.buffer.toString('base64')
    });

    const response = await fetch(`${CLOUD_FUNCTION_UPLOAD_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });

    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Cloud Function upload failed');
    return data; // { id, url, path, name, contentType, size, kind, uploadedAt }
}

function normalizeLinks(rawLinks) {
    if (!Array.isArray(rawLinks)) return [];
    return rawLinks.map(link => {
        const label = typeof link?.label === 'string' ? link.label.trim() : '';
        const url = typeof link?.url === 'string' ? link.url.trim() : '';
        if (!url) return null;
        return { label: label || url, url };
    }).filter(Boolean);
}

function normalizeAttachments(rawAttachments) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments.map(att => {
        if (!att || typeof att !== 'object') return null;
        const name = typeof att.name === 'string' ? att.name.trim() : '';
        const pathVal = typeof att.path === 'string' ? att.path.trim() : '';
        const url = typeof att.url === 'string' ? att.url.trim() : '';
        const contentType = typeof att.contentType === 'string' ? att.contentType.trim() : '';
        if (!name && !pathVal && !url) return null;
        return {
            id: att.id || crypto.randomBytes(16).toString('hex'),
            name: name || 'Archive file',
            path: pathVal,
            url,
            contentType: contentType || 'application/octet-stream',
            size: Number.isFinite(Number(att.size)) ? Number(att.size) : 0,
            kind: att.kind || getAttachmentKind(contentType, name),
            uploadedAt: normalizeTimestamp(att.uploadedAt)
        };
    }).filter(Boolean);
}

function mapSubmission(doc) {
    const data = doc.data() || {};
    const timestamp = normalizeTimestamp(data.timestamp || data.createdAt);
    const message = data.message || data.comment || '';
    return {
        id: doc.id,
        collectionName: doc.ref.parent.id,
        name: data.name || data.author || data.username || data.email || 'Comment entry',
        email: data.email || '',
        subject: data.subject || 'Comment Entry',
        message,
        read: Boolean(data.read),
        timestamp,
    };
}

function mapContentBox(doc) {
    const data = doc.data() || {};
    const attachments = normalizeAttachments(data.attachments);
    return {
        id: doc.id,
        title: data.title || 'Untitled Box',
        summary: data.summary || '',
        notes: data.notes || '',
        links: normalizeLinks(data.links),
        attachments,
        attachmentCount: attachments.length,
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0,
        published: data.published !== false,
        createdAt: normalizeTimestamp(data.createdAt),
        updatedAt: normalizeTimestamp(data.updatedAt)
    };
}

function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getPrivateDiaryDocId(uid, date) {
    const uidHash = crypto.createHash('sha256').update(String(uid || '')).digest('hex').slice(0, 32);
    return `${uidHash}_${date}`;
}

function countWords(value) {
    return String(value || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;
}

function getPrivateDiaryStoragePrefix(uid, date) {
    const uidHash = crypto.createHash('sha256').update(String(uid || '')).digest('hex').slice(0, 32);
    return `${PRIVATE_DIARY_STORAGE_FOLDER}/${uidHash}/${date}`;
}

function normalizePrivateDiaryPhotos(rawPhotos, uid, date) {
    if (!Array.isArray(rawPhotos)) return [];
    const storagePrefix = `${getPrivateDiaryStoragePrefix(uid, date)}/`;

    return rawPhotos.map((photo) => {
        if (!photo || typeof photo !== 'object') return null;
        const pathVal = typeof photo.path === 'string' ? photo.path.trim() : '';
        const url = typeof photo.url === 'string' ? photo.url.trim() : typeof photo.src === 'string' && /^https?:\/\//i.test(photo.src) ? photo.src.trim() : '';
        if (!pathVal || !url || !pathVal.startsWith(storagePrefix)) return null;

        const contentType = typeof photo.contentType === 'string' && photo.contentType.trim()
            ? photo.contentType.trim()
            : 'image/jpeg';
        if (!contentType.toLowerCase().startsWith('image/')) return null;

        return {
            id: typeof photo.id === 'string' && photo.id.trim() ? photo.id.trim().slice(0, 80) : crypto.randomBytes(16).toString('hex'),
            name: typeof photo.name === 'string' && photo.name.trim() ? photo.name.trim().slice(0, 160) : 'Diary photo',
            path: pathVal,
            url,
            contentType,
            size: Number.isFinite(Number(photo.size)) ? Number(photo.size) : 0,
            kind: 'image',
            x: Math.max(0, Math.min(100, Number.isFinite(Number(photo.x)) ? Number(photo.x) : 8)),
            y: Math.max(0, Math.min(100, Number.isFinite(Number(photo.y)) ? Number(photo.y) : 10)),
            width: Math.max(12, Math.min(92, Number.isFinite(Number(photo.width)) ? Number(photo.width) : 38)),
            rotation: Math.max(-15, Math.min(15, Number.isFinite(Number(photo.rotation)) ? Number(photo.rotation) : 0)),
            pinned: photo.pinned === true,
            uploadedAt: normalizeTimestamp(photo.uploadedAt) || new Date().toISOString()
        };
    }).filter(Boolean).slice(0, 120);
}

function normalizePrivateDiaryPayload(body, uid, date) {
    const text = typeof body?.text === 'string' ? body.text : '';
    if (text.length > PRIVATE_DIARY_TEXT_MAX_LENGTH) {
        return {
            error: `Diary page is too large. Keep notes under ${PRIVATE_DIARY_TEXT_MAX_LENGTH} characters.`
        };
    }

    const mood = typeof body?.mood === 'string' && body.mood.trim()
        ? body.mood.trim().slice(0, 32)
        : 'steady';
    const pageType = typeof body?.pageType === 'string' && body.pageType.trim()
        ? body.pageType.trim().slice(0, 32)
        : 'diary';
    const photos = normalizePrivateDiaryPhotos(body?.photos, uid, date);

    return {
        text,
        mood,
        pageType,
        photos,
        photoCount: photos.length,
        wordCount: countWords(text)
    };
}

function mapPrivateDiaryPage(doc) {
    const data = doc.data() || {};
    const photos = normalizePrivateDiaryPhotos(data.photos, data.ownerUid || '', data.date || '');
    return {
        id: doc.id,
        date: data.date || '',
        text: typeof data.text === 'string' ? data.text : '',
        mood: data.mood || 'steady',
        pageType: data.pageType || data.type || 'diary',
        photos,
        photoCount: photos.length,
        wordCount: Number.isFinite(Number(data.wordCount)) ? Number(data.wordCount) : countWords(data.text || ''),
        ownerUid: data.ownerUid || '',
        ownerEmail: data.ownerEmail || '',
        source: data.source || 'private-book',
        createdAt: normalizeTimestamp(data.createdAt),
        updatedAt: normalizeTimestamp(data.updatedAt)
    };
}

async function deleteStoragePath(pathVal) {
    if (!pathVal) return;
    try {
        await bucket.file(pathVal).delete();
    } catch (error) {
        if (error.code !== 404) {
            console.warn('Failed to delete storage file:', pathVal, error.message);
        }
    }
}

async function deletePrivateDiaryPhotos(photos) {
    const safePhotos = Array.isArray(photos) ? photos : [];
    for (const photo of safePhotos) {
        await deleteStoragePath(photo?.path);
    }
}

function sanitizeInput(input) {
    if (!input) return '';
    return input.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').trim();
}

function sanitizeStorageFileName(name) {
    const fallback = 'archive-file';
    const source = typeof name === 'string' && name.trim() ? name.trim() : fallback;
    const safe = source.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
    return safe || fallback;
}

function normalizeTwoFactorCode(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

async function verifyTwoFactorCode(secret, code) {
    const token = normalizeTwoFactorCode(code);
    if (!/^\d{6}$/.test(token)) return false;

    const result = await verifyOtpToken({
        secret,
        token,
        window: 1
    });

    return Boolean(result?.valid);
}

async function getTwoFactor(collection, uid, fallbackIssuer) {
    const snapshot = await collection.doc(uid).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data() || {};
    if (data.enabled !== true || !data.secret) return null;

    return {
        uid,
        email: data.email || '',
        secret: data.secret,
        issuer: data.issuer || fallbackIssuer
    };
}

function getAdminTwoFactor(uid) {
    return getTwoFactor(adminTwoFactorCollection, uid, TWO_FACTOR_ISSUER);
}

function getPrivateTwoFactor(uid) {
    return getTwoFactor(privateTwoFactorCollection, uid, PRIVATE_TWO_FACTOR_ISSUER);
}

async function createTwoFactorSetupPayload(uid, email, options = {}) {
    const issuer = options.issuer || TWO_FACTOR_ISSUER;
    const scope = options.scope || 'admin';
    const accountName = email || uid;
    const secret = generateSecret();
    const otpauthUrl = generateURI({
        issuer,
        label: accountName,
        secret
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
        color: {
            dark: '#101012',
            light: '#ffffff'
        }
    });
    const challengeToken = createTwoFactorChallenge({
        type: 'setup',
        scope,
        uid,
        email: accountName,
        secret
    });

    return {
        twoFactorSetupRequired: true,
        challengeToken,
        qrCodeDataUrl,
        manualKey: secret,
        issuer,
        accountName
    };
}

async function saveTwoFactor(collection, uid, email, secret, issuer) {
    const docRef = collection.doc(uid);
    const snapshot = await docRef.get();
    const payload = {
        uid,
        email: email || '',
        secret,
        enabled: true,
        issuer,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (!snapshot.exists) {
        payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await docRef.set(payload, { merge: true });
}

function saveAdminTwoFactor(uid, email, secret) {
    return saveTwoFactor(adminTwoFactorCollection, uid, email, secret, TWO_FACTOR_ISSUER);
}

function savePrivateTwoFactor(uid, email, secret) {
    return saveTwoFactor(privateTwoFactorCollection, uid, email, secret, PRIVATE_TWO_FACTOR_ISSUER);
}

async function verifyFirebasePassword(email, password) {
    if (!email || !password) {
        const error = new Error('Email and password are required.');
        error.statusCode = 400;
        throw error;
    }

    const fetch = (await import('node-fetch')).default;
    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    if (!firebaseApiKey) {
        const error = new Error('Server configuration error.');
        error.statusCode = 500;
        throw error;
    }

    const authResponse = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        }
    );

    const authData = await authResponse.json();
    if (!authResponse.ok || !authData.localId) {
        const error = new Error('Invalid email or password.');
        error.statusCode = 401;
        throw error;
    }

    return {
        uid: authData.localId,
        email: authData.email || email
    };
}

// ---------------------------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------------------------

// Health check
app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'portfolio-api' });
});

// Contact form submission
app.post('/api/contact', contactLimiter, async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        // Validate
        if (!name || String(name).trim().length < 2) {
            return res.status(400).json({ ok: false, error: 'Name must be at least 2 characters.' });
        }
        if (String(name).length > 100) {
            return res.status(400).json({ ok: false, error: 'Name must be less than 100 characters.' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
        }
        if (!message || String(message).trim().length < 10) {
            return res.status(400).json({ ok: false, error: 'Message must be at least 10 characters.' });
        }
        if (String(message).length > 5000) {
            return res.status(400).json({ ok: false, error: 'Message must be less than 5000 characters.' });
        }

        const submission = {
            name: sanitizeInput(name),
            email: sanitizeInput(email),
            subject: sanitizeInput(subject) || 'Portfolio Contact',
            message: sanitizeInput(message),
            comment: sanitizeInput(message),
            read: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'portfolio-contact-form',
            page: req.headers.referer || 'unknown'
        };

        const docRef = await db.collection(PRIMARY_SUBMISSION_COLLECTION).add(submission);
        console.log('Contact submission saved:', docRef.id);

        res.json({ ok: true, message: "Thank you for your message! I'll get back to you soon." });
    } catch (error) {
        console.error('Contact submission error:', error);
        res.status(500).json({ ok: false, error: 'Something went wrong. Please try again later.' });
    }
});

// List published archives
app.get('/api/archives', publicLimiter, async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
        const snapshot = await db.collection(CONTENT_BOXES_COLLECTION)
            .where('published', '==', true)
            .get();

        const archives = snapshot.docs
            .map(mapContentBox)
            .sort((a, b) => {
                if (a.order !== b.order) return a.order - b.order;
                const aTime = Date.parse(a.updatedAt || '') || 0;
                const bTime = Date.parse(b.updatedAt || '') || 0;
                return bTime - aTime;
            })
            .slice(0, limit);

        res.json({ ok: true, count: archives.length, archives });
    } catch (error) {
        console.error('List archives error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load archives.' });
    }
});

// Get single published archive
app.get('/api/archives/:id', publicLimiter, async (req, res) => {
    try {
        const snapshot = await db.collection(CONTENT_BOXES_COLLECTION).doc(req.params.id).get();
        if (!snapshot.exists) {
            return res.status(404).json({ ok: false, error: 'Archive item not found.' });
        }
        const archive = mapContentBox(snapshot);
        if (!archive.published) {
            return res.status(404).json({ ok: false, error: 'Archive item not found.' });
        }
        res.json({ ok: true, archive });
    } catch (error) {
        console.error('Get archive error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load archive.' });
    }
});

// ---------------------------------------------------------------------------
// ADMIN ROUTES
// ---------------------------------------------------------------------------

// Admin login
app.post('/api/admin/login', adminAuthLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const account = await verifyFirebasePassword(email, password);
        const twoFactor = await getAdminTwoFactor(account.uid);

        if (!twoFactor) {
            const setupPayload = await createTwoFactorSetupPayload(account.uid, account.email, {
                scope: 'admin',
                issuer: TWO_FACTOR_ISSUER
            });
            return res.json({
                ok: true,
                email: account.email,
                uid: account.uid,
                ...setupPayload
            });
        }

        const challengeToken = createTwoFactorChallenge({
            type: 'login',
            scope: 'admin',
            uid: account.uid,
            email: account.email,
            secret: twoFactor.secret
        });

        res.json({
            ok: true,
            email: account.email,
            uid: account.uid,
            twoFactorRequired: true,
            challengeToken
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(error.statusCode || 500).json({ ok: false, error: error.statusCode ? error.message : 'Login failed.' });
    }
});

// Verify 2FA login/setup challenge
app.post('/api/admin/2fa/verify', adminAuthLimiter, async (req, res) => {
    try {
        const { challengeToken, code } = req.body;
        const challenge = getTwoFactorChallenge(challengeToken);

        if (!challenge) {
            return res.status(401).json({ ok: false, error: '2FA challenge expired. Sign in again.' });
        }

        if (challenge.scope !== 'admin') {
            destroyTwoFactorChallenge(challengeToken);
            return res.status(401).json({ ok: false, error: '2FA challenge expired. Sign in again.' });
        }

        challenge.attempts += 1;

        const valid = await verifyTwoFactorCode(challenge.secret, code);
        if (!valid) {
            if (challenge.attempts >= 5) {
                destroyTwoFactorChallenge(challengeToken);
                return res.status(429).json({ ok: false, error: 'Too many 2FA attempts. Sign in again.' });
            }

            return res.status(401).json({ ok: false, error: 'Invalid authenticator code.' });
        }

        if (challenge.type === 'setup') {
            await saveAdminTwoFactor(challenge.uid, challenge.email, challenge.secret);
        }

        destroyTwoFactorChallenge(challengeToken);
        setAdminSessionCookie(res, challenge.uid, challenge.email);

        res.json({
            ok: true,
            email: challenge.email,
            uid: challenge.uid,
            twoFactorEnabled: true
        });
    } catch (error) {
        console.error('Admin 2FA verification error:', error);
        res.status(500).json({ ok: false, error: '2FA verification failed.' });
    }
});

// Admin session check
app.get('/api/admin/session', (req, res) => {
    const token = req.cookies?.[ADMIN_SESSION_COOKIE];
    const session = getSession(token, {
        res,
        scope: 'admin',
        clearCookie: clearAdminSessionCookie,
        writeCookie: writeAdminSessionCookie,
        touch: true
    });

    if (!session) {
        return res.json({ ok: false, authenticated: false });
    }

    res.json({
        ok: true,
        authenticated: true,
        email: session.email,
        uid: session.uid,
        idleTimeoutMs: ADMIN_SESSION_IDLE_TIMEOUT
    });
});

// Refresh admin idle timer after real user activity.
app.post('/api/admin/session/touch', (req, res) => {
    const token = req.cookies?.[ADMIN_SESSION_COOKIE];
    const session = getSession(token, {
        res,
        scope: 'admin',
        clearCookie: clearAdminSessionCookie,
        writeCookie: writeAdminSessionCookie,
        touch: true
    });

    if (!session) {
        return res.status(401).json({ ok: false, error: 'Authentication required.' });
    }

    res.json({
        ok: true,
        authenticated: true,
        email: session.email,
        uid: session.uid,
        idleTimeoutMs: ADMIN_SESSION_IDLE_TIMEOUT
    });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
    const token = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (token) destroySession(token);
    clearAdminSessionCookie(res);
    res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// PRIVATE ROOM ROUTES
// ---------------------------------------------------------------------------

// Private room login uses the same Firebase password check as admin, but with
// its own authenticator secret and session cookie.
app.post('/api/private/login', adminAuthLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const account = await verifyFirebasePassword(email, password);
        const twoFactor = await getPrivateTwoFactor(account.uid);

        if (!twoFactor) {
            const setupPayload = await createTwoFactorSetupPayload(account.uid, account.email, {
                scope: 'private',
                issuer: PRIVATE_TWO_FACTOR_ISSUER
            });
            return res.json({
                ok: true,
                email: account.email,
                uid: account.uid,
                ...setupPayload
            });
        }

        const challengeToken = createTwoFactorChallenge({
            type: 'login',
            scope: 'private',
            uid: account.uid,
            email: account.email,
            secret: twoFactor.secret
        });

        res.json({
            ok: true,
            email: account.email,
            uid: account.uid,
            twoFactorRequired: true,
            challengeToken
        });
    } catch (error) {
        console.error('Private login error:', error);
        res.status(error.statusCode || 500).json({ ok: false, error: error.statusCode ? error.message : 'Login failed.' });
    }
});

app.post('/api/private/2fa/verify', adminAuthLimiter, async (req, res) => {
    try {
        const { challengeToken, code } = req.body;
        const challenge = getTwoFactorChallenge(challengeToken);

        if (!challenge || challenge.scope !== 'private') {
            if (challenge) destroyTwoFactorChallenge(challengeToken);
            return res.status(401).json({ ok: false, error: '2FA challenge expired. Sign in again.' });
        }

        challenge.attempts += 1;

        const valid = await verifyTwoFactorCode(challenge.secret, code);
        if (!valid) {
            if (challenge.attempts >= 5) {
                destroyTwoFactorChallenge(challengeToken);
                return res.status(429).json({ ok: false, error: 'Too many 2FA attempts. Sign in again.' });
            }

            return res.status(401).json({ ok: false, error: 'Invalid authenticator code.' });
        }

        if (challenge.type === 'setup') {
            await savePrivateTwoFactor(challenge.uid, challenge.email, challenge.secret);
        }

        destroyTwoFactorChallenge(challengeToken);
        setPrivateSessionCookie(res, challenge.uid, challenge.email);

        res.json({
            ok: true,
            email: challenge.email,
            uid: challenge.uid,
            twoFactorEnabled: true
        });
    } catch (error) {
        console.error('Private 2FA verification error:', error);
        res.status(500).json({ ok: false, error: '2FA verification failed.' });
    }
});

app.get('/api/private/session', (req, res) => {
    const token = req.cookies?.[PRIVATE_SESSION_COOKIE];
    const session = getSession(token, {
        res,
        scope: 'private',
        clearCookie: clearPrivateSessionCookie,
        writeCookie: writePrivateSessionCookie,
        touch: true
    });

    if (!session) {
        return res.json({ ok: false, authenticated: false });
    }

    res.json({
        ok: true,
        authenticated: true,
        email: session.email,
        uid: session.uid,
        idleTimeoutMs: ADMIN_SESSION_IDLE_TIMEOUT
    });
});

app.post('/api/private/session/touch', (req, res) => {
    const token = req.cookies?.[PRIVATE_SESSION_COOKIE];
    const session = getSession(token, {
        res,
        scope: 'private',
        clearCookie: clearPrivateSessionCookie,
        writeCookie: writePrivateSessionCookie,
        touch: true
    });

    if (!session) {
        return res.status(401).json({ ok: false, error: 'Authentication required.' });
    }

    res.json({
        ok: true,
        authenticated: true,
        email: session.email,
        uid: session.uid,
        idleTimeoutMs: ADMIN_SESSION_IDLE_TIMEOUT
    });
});

app.post('/api/private/logout', (req, res) => {
    const token = req.cookies?.[PRIVATE_SESSION_COOKIE];
    if (token) destroySession(token);
    clearPrivateSessionCookie(res);
    res.json({ ok: true });
});

app.get('/api/private/diary', requirePrivate, adminLimiter, async (req, res) => {
    try {
        const snapshot = await privateDiaryCollection
            .where('ownerUid', '==', req.privateSession.uid)
            .get();
        const pages = snapshot.docs
            .map(mapPrivateDiaryPage)
            .filter((page) => isIsoDate(page.date))
            .sort((a, b) => b.date.localeCompare(a.date));

        res.json({ ok: true, count: pages.length, pages });
    } catch (error) {
        console.error('Private diary list error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load diary pages.' });
    }
});

app.get('/api/private/diary/:date', requirePrivate, adminLimiter, async (req, res) => {
    try {
        const { date } = req.params;
        if (!isIsoDate(date)) {
            return res.status(400).json({ ok: false, error: 'Use a YYYY-MM-DD diary date.' });
        }

        const docRef = privateDiaryCollection.doc(getPrivateDiaryDocId(req.privateSession.uid, date));
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
            return res.status(404).json({ ok: false, error: 'Diary page not found.' });
        }

        res.json({ ok: true, page: mapPrivateDiaryPage(snapshot) });
    } catch (error) {
        console.error('Private diary get error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load diary page.' });
    }
});

app.put('/api/private/diary/:date', requirePrivate, adminLimiter, async (req, res) => {
    try {
        const { date } = req.params;
        if (!isIsoDate(date)) {
            return res.status(400).json({ ok: false, error: 'Use a YYYY-MM-DD diary date.' });
        }

        const normalized = normalizePrivateDiaryPayload(req.body || {}, req.privateSession.uid, date);
        if (normalized.error) {
            return res.status(400).json({ ok: false, error: normalized.error });
        }

        const docRef = privateDiaryCollection.doc(getPrivateDiaryDocId(req.privateSession.uid, date));
        const existing = await docRef.get();
        const existingPage = existing.exists ? mapPrivateDiaryPage(existing) : null;
        const payload = {
            ownerUid: req.privateSession.uid,
            ownerEmail: req.privateSession.email || '',
            date,
            text: normalized.text,
            mood: normalized.mood,
            pageType: normalized.pageType,
            photos: normalized.photos,
            photoCount: normalized.photoCount,
            wordCount: normalized.wordCount,
            source: 'private-book',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!existing.exists) {
            payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await docRef.set(payload, { merge: true });

        if (existingPage && Array.isArray(existingPage.photos)) {
            const keptPaths = new Set(normalized.photos.map((photo) => photo.path).filter(Boolean));
            const removedPhotos = existingPage.photos.filter((photo) => photo.path && !keptPaths.has(photo.path));
            await deletePrivateDiaryPhotos(removedPhotos);
        }

        const snapshot = await docRef.get();
        res.json({ ok: true, page: mapPrivateDiaryPage(snapshot) });
    } catch (error) {
        console.error('Private diary save error:', error);
        res.status(500).json({ ok: false, error: 'Failed to save diary page.' });
    }
});

app.post('/api/private/diary/:date/photos', requirePrivate, adminLimiter, upload.array('files', 10), async (req, res) => {
    try {
        const { date } = req.params;
        if (!isIsoDate(date)) {
            return res.status(400).json({ ok: false, error: 'Use a YYYY-MM-DD diary date.' });
        }

        const files = Array.isArray(req.files)
            ? req.files.filter((file) => String(file.mimetype || '').toLowerCase().startsWith('image/'))
            : [];

        if (!files.length) {
            return res.status(400).json({ ok: false, error: 'Upload at least one image file.' });
        }

        const docRef = privateDiaryCollection.doc(getPrivateDiaryDocId(req.privateSession.uid, date));
        const snapshot = await docRef.get();
        const existingPage = snapshot.exists ? mapPrivateDiaryPage(snapshot) : null;
        const existingPhotos = existingPage?.photos || [];
        const uploadedPhotos = [];

        for (const file of files) {
            const photoId = crypto.randomBytes(16).toString('hex');
            const safeName = sanitizeStorageFileName(file.originalname || 'diary-photo');
            const storagePath = `${getPrivateDiaryStoragePrefix(req.privateSession.uid, date)}/${Date.now()}-${photoId}-${safeName}`;
            const contentType = file.mimetype || 'image/jpeg';
            const downloadToken = crypto.randomBytes(16).toString('hex');
            const fileRef = bucket.file(storagePath);

            await fileRef.save(file.buffer, {
                metadata: {
                    contentType,
                    cacheControl: 'private, max-age=0, no-transform',
                    metadata: {
                        firebaseStorageDownloadTokens: downloadToken,
                        date,
                        photoId,
                        originalName: file.originalname || 'diary-photo',
                        uploadedBy: req.privateSession.uid
                    }
                }
            });

            const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

            uploadedPhotos.push({
                id: photoId,
                name: file.originalname || 'Diary photo',
                path: storagePath,
                url,
                contentType,
                size: file.size,
                kind: 'image',
                x: 8,
                y: 10,
                width: 38,
                rotation: 0,
                pinned: false,
                uploadedAt: new Date().toISOString()
            });
        }

        const photos = [...existingPhotos, ...uploadedPhotos].slice(0, 120);
        const payload = {
            ownerUid: req.privateSession.uid,
            ownerEmail: req.privateSession.email || '',
            date,
            text: existingPage?.text || '',
            mood: existingPage?.mood || 'steady',
            pageType: existingPage?.pageType || 'diary',
            photos,
            photoCount: photos.length,
            wordCount: countWords(existingPage?.text || ''),
            source: 'private-book',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!snapshot.exists) {
            payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await docRef.set(payload, { merge: true });
        res.json({ ok: true, photos: uploadedPhotos, page: mapPrivateDiaryPage(await docRef.get()) });
    } catch (error) {
        console.error('Private diary photo upload error:', error);
        res.status(500).json({ ok: false, error: 'Failed to upload diary photos.' });
    }
});

app.delete('/api/private/diary/:date/photos/:photoId', requirePrivate, adminLimiter, async (req, res) => {
    try {
        const { date, photoId } = req.params;
        if (!isIsoDate(date)) {
            return res.status(400).json({ ok: false, error: 'Use a YYYY-MM-DD diary date.' });
        }

        const docRef = privateDiaryCollection.doc(getPrivateDiaryDocId(req.privateSession.uid, date));
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
            return res.json({ ok: true });
        }

        const page = mapPrivateDiaryPage(snapshot);
        const photo = page.photos.find((item) => item.id === photoId);
        if (photo) {
            await deleteStoragePath(photo.path);
        }

        const photos = page.photos.filter((item) => item.id !== photoId);
        await docRef.set({
            photos,
            photoCount: photos.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.json({ ok: true, page: mapPrivateDiaryPage(await docRef.get()) });
    } catch (error) {
        console.error('Private diary photo delete error:', error);
        res.status(500).json({ ok: false, error: 'Failed to delete diary photo.' });
    }
});

app.delete('/api/private/diary/:date', requirePrivate, adminLimiter, async (req, res) => {
    try {
        const { date } = req.params;
        if (!isIsoDate(date)) {
            return res.status(400).json({ ok: false, error: 'Use a YYYY-MM-DD diary date.' });
        }

        const docRef = privateDiaryCollection.doc(getPrivateDiaryDocId(req.privateSession.uid, date));
        const snapshot = await docRef.get();
        if (snapshot.exists) {
            await deletePrivateDiaryPhotos(mapPrivateDiaryPage(snapshot).photos);
        }
        await docRef.delete();
        res.json({ ok: true });
    } catch (error) {
        console.error('Private diary delete error:', error);
        res.status(500).json({ ok: false, error: 'Failed to delete diary page.' });
    }
});

app.delete('/api/private/diary', requirePrivate, adminLimiter, async (req, res) => {
    try {
        const snapshot = await privateDiaryCollection
            .where('ownerUid', '==', req.privateSession.uid)
            .get();
        let batch = db.batch();
        let pending = 0;
        let deleted = 0;

        for (const doc of snapshot.docs) {
            await deletePrivateDiaryPhotos(mapPrivateDiaryPage(doc).photos);
            batch.delete(doc.ref);
            pending += 1;
            deleted += 1;

            if (pending >= 450) {
                await batch.commit();
                batch = db.batch();
                pending = 0;
            }
        }

        if (pending > 0) {
            await batch.commit();
        }

        res.json({ ok: true, deleted });
    } catch (error) {
        console.error('Private diary clear error:', error);
        res.status(500).json({ ok: false, error: 'Failed to clear diary pages.' });
    }
});

// List all submissions (admin)
app.get('/api/admin/submissions', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const allSubmissions = [];

        for (const collectionName of SUBMISSION_COLLECTIONS) {
            try {
                const snapshot = await db.collection(collectionName).get();
                const docs = snapshot.docs.map(mapSubmission);
                allSubmissions.push(...docs);
            } catch (error) {
                console.warn('Collection unavailable:', collectionName, error.message);
            }
        }

        allSubmissions.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return bTime - aTime;
        });

        res.json({ ok: true, count: allSubmissions.length, submissions: allSubmissions });
    } catch (error) {
        console.error('List submissions error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load submissions.' });
    }
});

// Update submission read state (admin)
app.patch('/api/admin/submissions/:id', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const { read, collectionName } = req.body;
        const collection = SUBMISSION_COLLECTIONS.includes(collectionName)
            ? collectionName
            : PRIMARY_SUBMISSION_COLLECTION;

        await db.collection(collection).doc(req.params.id).set({ read: Boolean(read) }, { merge: true });
        res.json({ ok: true });
    } catch (error) {
        console.error('Update submission error:', error);
        res.status(500).json({ ok: false, error: 'Failed to update submission.' });
    }
});

// Delete submission (admin)
app.delete('/api/admin/submissions/:id', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const collectionName = req.query.collection;
        const collection = SUBMISSION_COLLECTIONS.includes(collectionName)
            ? collectionName
            : PRIMARY_SUBMISSION_COLLECTION;

        await db.collection(collection).doc(req.params.id).delete();
        res.json({ ok: true });
    } catch (error) {
        console.error('Delete submission error:', error);
        res.status(500).json({ ok: false, error: 'Failed to delete submission.' });
    }
});

// List all content boxes (admin)
app.get('/api/admin/content-boxes', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const snapshot = await db.collection(CONTENT_BOXES_COLLECTION).get();
        const boxes = snapshot.docs.map(mapContentBox).sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            const aTime = Date.parse(a.updatedAt || '') || 0;
            const bTime = Date.parse(b.updatedAt || '') || 0;
            return bTime - aTime;
        });

        res.json({ ok: true, count: boxes.length, contentBoxes: boxes });
    } catch (error) {
        console.error('List content boxes error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load content boxes.' });
    }
});

// Save content box (create or update) (admin)
app.post('/api/admin/content-boxes', requireAdmin, adminLimiter, upload.array('files', 20), async (req, res) => {
    try {
        const payload = JSON.parse(req.body.payload || '{}');
        const title = typeof payload.title === 'string' ? payload.title.trim() : '';
        const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
        const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
        const order = Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0;
        const published = Boolean(payload.published);
        const links = normalizeLinks(payload.links);
        const existingAttachments = normalizeAttachments(payload.attachments);
        const removedAttachments = normalizeAttachments(payload.removedAttachments);

        if (!title) {
            return res.status(400).json({ ok: false, error: 'A title is required.' });
        }

        const docRef = payload.id
            ? db.collection(CONTENT_BOXES_COLLECTION).doc(payload.id)
            : db.collection(CONTENT_BOXES_COLLECTION).doc();
        const boxId = docRef.id;

        // Upload new files to Firebase Storage (via Cloud Function relay if VPS is geo-blocked)
        const uploadedAttachments = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                if (CLOUD_FUNCTION_UPLOAD_URL && CLOUD_FUNCTION_UPLOAD_SECRET) {
                    // Route through Cloud Function (bypasses VPS geo-block on googleapis.com)
                    const result = await uploadFileViaCloudFunction(file, {
                        folder: ARCHIVE_STORAGE_FOLDER,
                        boxId
                    });
                    uploadedAttachments.push({
                        id: result.id,
                        name: file.originalname,
                        path: result.path,
                        url: result.url,
                        contentType: result.contentType,
                        size: file.size,
                        kind: result.kind,
                        uploadedAt: result.uploadedAt
                    });
                } else {
                    // Direct upload (only works if VPS is not geo-blocked)
                    const attachmentId = crypto.randomBytes(16).toString('hex');
                    const safeName = sanitizeStorageFileName(file.originalname);
                    const storagePath = `${ARCHIVE_STORAGE_FOLDER}/${boxId}/${Date.now()}-${attachmentId}-${safeName}`;
                    const contentType = file.mimetype || 'application/octet-stream';
                    const downloadToken = crypto.randomBytes(16).toString('hex');
                    const fileRef = bucket.file(storagePath);
                    await fileRef.save(file.buffer, {
                        metadata: {
                            contentType,
                            cacheControl: 'private, max-age=0, no-transform',
                            metadata: {
                                firebaseStorageDownloadTokens: downloadToken,
                                boxId,
                                originalName: file.originalname,
                                uploadedBy: req.adminSession.uid
                            }
                        }
                    });
                    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
                    uploadedAttachments.push({
                        id: attachmentId,
                        name: file.originalname,
                        path: storagePath,
                        url,
                        contentType,
                        size: file.size,
                        kind: getAttachmentKind(contentType, file.originalname),
                        uploadedAt: new Date().toISOString()
                    });
                }
            }
        }


        const boxData = {
            title,
            summary,
            notes,
            links,
            attachments: [...existingAttachments, ...uploadedAttachments].map(att => ({
                id: att.id || crypto.randomBytes(16).toString('hex'),
                name: att.name || 'Archive file',
                path: att.path || '',
                url: att.url || '',
                contentType: att.contentType || 'application/octet-stream',
                size: Number.isFinite(Number(att.size)) ? Number(att.size) : 0,
                kind: att.kind || getAttachmentKind(att.contentType, att.name),
                uploadedAt: att.uploadedAt || null
            })),
            order,
            published,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!payload.id) {
            boxData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await docRef.set(boxData, { merge: Boolean(payload.id) });

        // Delete removed attachment files from Storage
        for (const att of removedAttachments) {
            if (att.path) {
                try {
                    await bucket.file(att.path).delete();
                } catch (err) {
                    if (err.code !== 404) {
                        console.warn('Failed to delete storage file:', att.path, err.message);
                    }
                }
            }
        }

        res.json({ ok: true, id: boxId });
    } catch (error) {
        console.error('Save content box error:', error);
        res.status(500).json({ ok: false, error: 'Failed to save content box: ' + error.message });
    }
});

// Delete content box (admin)
app.delete('/api/admin/content-boxes/:id', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const docRef = db.collection(CONTENT_BOXES_COLLECTION).doc(req.params.id);
        const snapshot = await docRef.get();

        if (snapshot.exists) {
            const attachments = normalizeAttachments(snapshot.data()?.attachments);
            for (const att of attachments) {
                if (att.path) {
                    try {
                        await bucket.file(att.path).delete();
                    } catch (err) {
                        if (err.code !== 404) {
                            console.warn('Failed to delete storage file:', att.path, err.message);
                        }
                    }
                }
            }
        }

        await docRef.delete();
        res.json({ ok: true });
    } catch (error) {
        console.error('Delete content box error:', error);
        res.status(500).json({ ok: false, error: 'Failed to delete content box.' });
    }
});

// ---------------------------------------------------------------------------
// ADMIN: PLAYLIST GALLERY
// ---------------------------------------------------------------------------

// List configured playlists (admin)
app.get('/api/admin/playlists', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const snapshot = await db.collection(PLAYLISTS_COLLECTION).get();
        const playlists = snapshot.docs
            .map((doc) => {
                const data = doc.data() || {};
                return {
                    id: doc.id,
                    title: data.title || '',
                    order: Number(data.order) || 0,
                    addedAt: normalizeTimestamp(data.addedAt)
                };
            })
            .sort((a, b) => a.order - b.order);
        res.json({ ok: true, count: playlists.length, playlists });
    } catch (error) {
        console.error('List playlists error:', error);
        res.status(500).json({ ok: false, error: 'Failed to load playlists.' });
    }
});

// Add a playlist (admin) — validates it exists and captures its title
app.post('/api/admin/playlists', requireAdmin, adminLimiter, async (req, res) => {
    try {
        if (!YOUTUBE_API_KEY) {
            return res.status(500).json({ ok: false, error: 'YouTube key is not configured on the server.' });
        }

        const playlistId = parsePlaylistId(req.body && req.body.playlist);
        if (!playlistId) {
            return res.status(400).json({ ok: false, error: 'Enter a valid YouTube playlist URL or ID.' });
        }

        let title;
        try {
            title = await fetchPlaylistTitle(playlistId);
        } catch (error) {
            return res.status(400).json({ ok: false, error: 'Could not read that playlist. Make sure it is Public or Unlisted.' });
        }
        if (!title) {
            return res.status(400).json({ ok: false, error: 'Playlist not found. Check the ID and that it is Public or Unlisted.' });
        }

        const docRef = db.collection(PLAYLISTS_COLLECTION).doc(playlistId);
        const existing = await docRef.get();
        if (existing.exists) {
            return res.status(409).json({ ok: false, error: 'That playlist is already added.' });
        }

        const all = await db.collection(PLAYLISTS_COLLECTION).get();
        const maxOrder = all.docs.reduce((max, doc) => Math.max(max, Number(doc.data().order) || 0), -1);

        await docRef.set({
            playlistId,
            title,
            order: maxOrder + 1,
            addedBy: req.adminSession.uid,
            addedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        playlistsCache.data = null; // bust public cache so it shows immediately
        res.json({ ok: true, id: playlistId, title });
    } catch (error) {
        console.error('Add playlist error:', error);
        res.status(500).json({ ok: false, error: 'Failed to add playlist.' });
    }
});

// Remove a playlist (admin)
app.delete('/api/admin/playlists/:id', requireAdmin, adminLimiter, async (req, res) => {
    try {
        const id = parsePlaylistId(req.params.id) || String(req.params.id || '');
        if (!id) {
            return res.status(400).json({ ok: false, error: 'Invalid playlist id.' });
        }
        await db.collection(PLAYLISTS_COLLECTION).doc(id).delete();
        playlistsCache.data = null; // bust public cache
        res.json({ ok: true });
    } catch (error) {
        console.error('Delete playlist error:', error);
        res.status(500).json({ ok: false, error: 'Failed to delete playlist.' });
    }
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' });
    }

    res.status(500).json({ ok: false, error: 'Internal server error.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Portfolio API running on port ${PORT}`);
    console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
