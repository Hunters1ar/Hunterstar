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
  if (process.stdout && !process.stdout.destroyed && process.stdout.writable) {
    try { process.stdout.write(line + '\n'); } catch (_) {}
  }
  try {
    if (!fs.existsSync(PROFILE_BASE_DIR)) fs.mkdirSync(PROFILE_BASE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] CRASH: ${err && err.stack || err}\n`, 'utf8');
  } catch (_) {}
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
  kimi: 'https://www.kimi.ai/',
  deepseek: 'https://chat.deepseek.com',
  grok: 'https://grok.com',
  copilot: 'https://copilot.microsoft.com',
  poe: 'https://poe.com'
});

function isPrivateIpOrHost(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase().trim();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '0.0.0.0' || lower === '::1' || lower === '[::1]') {
    return true;
  }
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.lan') || !lower.includes('.')) {
    return true;
  }
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = lower.match(ipv4Regex);
  if (match) {
    const [_, a, b, c, d] = match.map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  return false;
}

function validateAndSanitizeUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (isPrivateIpOrHost(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function bringChromeToFront(titleHint) {
  const safeHint = (titleHint || '').replace(/"/g, '').trim();
  const psScript = `
    $wshell = New-Object -ComObject Wscript.Shell
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 150
      if ($wshell.AppActivate("Chrome") -or $wshell.AppActivate("Google Chrome") -or ($args[0] -and $wshell.AppActivate($args[0]))) {
        break
      }
    }
  `;
  try {
    const proc = child_process.spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-Command', psScript,
      safeHint
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    proc.unref();
  } catch (_) {
    // Fallback to VBScript if PowerShell fails
    const vbs = [
      'Set wsh = CreateObject("WScript.Shell")',
      'wsh.SendKeys "%"',
      'For i = 1 To 20',
      '  WScript.Sleep 150',
      '  If wsh.AppActivate("Chrome") Or wsh.AppActivate("Google Chrome") Then',
      '    Exit For',
      '  End If',
      'Next'
    ].join('\r\n');
    const tmpVbs = path.join(os.tmpdir(), 'hs-focus.vbs');
    try {
      fs.writeFileSync(tmpVbs, vbs, 'utf8');
      const focusProc = child_process.spawn('cscript', ['//nologo', tmpVbs], {
        detached: true,
        stdio: 'ignore'
      });
      focusProc.unref();
    } catch (__) {}
  }
}

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
        const { account, app, url, name } = body;

        if (!account || !/^acct_[a-f0-9]{12}$/.test(account)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid account format' }));
          return;
        }

        let targetUrl = null;
        let displayName = name ? String(name).trim().slice(0, 50) : (app || 'Chrome');

        if (url) {
          targetUrl = validateAndSanitizeUrl(url);
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid URL or private network address blocked' }));
            return;
          }
        } else if (app && APP_URLS[app]) {
          targetUrl = APP_URLS[app];
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid or missing app/url' }));
          return;
        }

        if (!CHROME_PATH) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Chrome executable not found' }));
          return;
        }

        const profileDir = path.join(PROFILE_BASE_DIR, account);

        try {
          const cmdArgs = [
            '/c',
            'start',
            '/max',
            '""',
            `"${CHROME_PATH}"`,
            `"--user-data-dir=${profileDir}"`,
            '--new-window',
            '--start-maximized',
            '--no-first-run',
            '--no-default-browser-check',
            `"${targetUrl}"`
          ];

          const child = child_process.spawn('cmd.exe', cmdArgs, {
            detached: true,
            stdio: 'ignore',
            windowsVerbatimArguments: true
          });
          child.unref();
          bringChromeToFront(displayName);

          safeLog(`OPEN ${account} → ${displayName} (${targetUrl})`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: `Launched ${displayName} for ${account}` }));
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
    safeLog(`[INFO] Launcher is already running in background on http://${HOST}:${PORT}`);
    process.exit(0);
  }
  safeLog('[ERROR]', err && err.stack || err);
});

server.listen(PORT, HOST, () => {
  const chromeDisplay = truncateString(CHROME_PATH || 'NOT FOUND', 28);
  const profileDisplay = truncateString(PROFILE_BASE_DIR, 28);
  
  safeLog(`
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
