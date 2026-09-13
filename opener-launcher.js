const http = require('http');
const crypto = require('crypto');
const child_process = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9876;
const HOST = '127.0.0.1';
const VERSION = '1.0.0';

const PROFILE_BASE_DIR = path.join(os.homedir(), '.opener-profiles');
const TOKEN_FILE = path.join(PROFILE_BASE_DIR, 'token.txt');
const LOG_FILE = path.join(PROFILE_BASE_DIR, 'launcher.log');

function safeLog(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  try { console.log(...args); } catch (_) {}
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch (_) {}
}

process.on('uncaughtException', (err) => {
  safeLog('UNCAUGHT_EXCEPTION', err.stack || err.message);
});

function getOrCreateToken() {
  if (!fs.existsSync(PROFILE_BASE_DIR)) {
    try { fs.mkdirSync(PROFILE_BASE_DIR, { recursive: true }); } catch (_) {}
  }
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (/^[a-f0-9]{32}$/.test(existing)) return existing;
    } catch (_) {}
  }
  const newToken = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(TOKEN_FILE, newToken, 'utf8'); } catch (_) {}
  return newToken;
}

const LAUNCHER_TOKEN = getOrCreateToken();

const APP_URLS = Object.freeze({
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com',
  copilot: 'https://copilot.microsoft.com',
  poe: 'https://poe.com',
  deepseek: 'https://chat.deepseek.com'
});

function getChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  
  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CHROME_PATH = getChromePath();

function truncateString(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

function isOriginAllowed(origin) {
  return /^https?:\/\/opener\.hunterstar\.uz$/.test(origin) ||
         /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Launcher-Token');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: VERSION }));
    return;
  }

  if (req.method === 'POST' && req.url === '/open') {
    const origin = req.headers.origin || '';
    const token = req.headers['x-launcher-token'] || '';
    const isTrusted = isOriginAllowed(origin) || (token && token === LAUNCHER_TOKEN);

    if (!isTrusted) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Access denied' }));
      return;
    }

    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const body = JSON.parse(bodyStr);
        const { account, app } = body;

        if (!account || !/^acct_[a-f0-9]{12}$/.test(account)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid account format' }));
          return;
        }

        if (!app || !APP_URLS[app]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid or missing app' }));
          return;
        }

        if (!CHROME_PATH) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Chrome executable not found' }));
          return;
        }

        const profileDir = path.join(PROFILE_BASE_DIR, account);
        const appUrl = APP_URLS[app];

        function bringToFront(pid) {
          const psCode = `
            $ws = New-Object -ComObject WScript.Shell
            for ($i = 0; $i -lt 12; $i++) {
              Start-Sleep -Milliseconds 250
              if ($ws.AppActivate(${pid})) { break }
              $procs = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
              if ($procs) {
                foreach ($p in $procs) {
                  if ($ws.AppActivate($p.Id)) { break }
                }
                break
              }
            }
          `;
          try {
            const focusProc = child_process.spawn('powershell', ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', psCode], {
              detached: true,
              stdio: 'ignore'
            });
            focusProc.unref();
          } catch (_) {}
        }

        try {
          const child = child_process.spawn(CHROME_PATH, [
            `--user-data-dir=${profileDir}`,
            '--new-window',
            '--no-first-run',
            '--no-default-browser-check',
            appUrl
          ], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
          bringToFront(child.pid);

          const time = new Date().toTimeString().split(' ')[0];
          safeLog(`OPEN ${account} → ${app}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: `Launched ${app} for ${account}` }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Failed to launch Chrome' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[INFO] Launcher is already running in background on http://${HOST}:${PORT}`);
    process.exit(0);
  }
  console.error('[ERROR]', err);
});

server.listen(PORT, HOST, () => {
  const chromeDisplay = truncateString(CHROME_PATH || 'NOT FOUND', 28);
  const profileDisplay = truncateString(PROFILE_BASE_DIR, 28);
  
  console.log(`
+--------------------------------------------------------------+
|             HUNTERSTAR ACCOUNT OPENER                        |
|             Local Launcher v1.0.0                            |
+--------------------------------------------------------------+
|                                                              |
|  [KEY] Token: ${LAUNCHER_TOKEN.padEnd(46)} |
|                                                              |
|  Listening: ${`${HOST}:${PORT}`.padEnd(48)} |
|  Chrome:    ${chromeDisplay.padEnd(48)} |
|  Profiles:  ${profileDisplay.padEnd(48)} |
|                                                              |
+--------------------------------------------------------------+
`);
});
