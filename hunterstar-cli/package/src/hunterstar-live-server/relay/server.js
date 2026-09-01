const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const equalsIndex = trimmedLine.indexOf('=');

        if (equalsIndex === -1) {
            continue;
        }

        const key = trimmedLine.slice(0, equalsIndex).trim();

        if (!key) {
            continue;
        }

        let value = trimmedLine.slice(equalsIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(__dirname, '.env'));

const host = process.env.RELAY_HOST || '0.0.0.0';
const port = Number(process.env.RELAY_PORT || process.env.PORT || 8000);
const configuredPublicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const relayToken = process.env.RELAY_TOKEN || '';
const idleTimeoutMs = Number(process.env.IDLE_TIMEOUT_MS || 120000);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);
const maxSessions = Number(process.env.MAX_SESSIONS || 100);
const maxSessionsPerIp = Number(process.env.MAX_SESSIONS_PER_IP || 5);
const sessionCreateWindowMs = Number(process.env.SESSION_CREATE_WINDOW_MS || 60 * 1000);
const maxSessionCreatesPerWindow = Number(process.env.MAX_SESSION_CREATES_PER_WINDOW || 20);
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 6 * 60 * 60 * 1000);
const heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 10000);
const heartbeatTimeoutMs = Number(process.env.HEARTBEAT_TIMEOUT_MS || 20000);

const sessions = new Map();
const sessionCreateWindows = new Map();
const tunnelWss = new WebSocketServer({ noServer: true });
const viewerWss = new WebSocketServer({ noServer: true });

function sendJson(socket, payload) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

function getPublicBaseUrl(req) {
    if (configuredPublicBaseUrl) {
        return configuredPublicBaseUrl;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    return `${proto || 'http'}://${req.headers.host}`;
}

function getClientIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const firstForwardedIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(',')[0];

    return (firstForwardedIp || req.socket.remoteAddress || 'unknown').trim();
}

function countSessionsForIp(ip) {
    let count = 0;

    for (const session of sessions.values()) {
        if (session.ownerIp === ip) {
            count += 1;
        }
    }

    return count;
}

function canCreateSessionForIp(ip) {
    const now = Date.now();
    const windowState = sessionCreateWindows.get(ip);

    if (!windowState || now - windowState.startedAt > sessionCreateWindowMs) {
        sessionCreateWindows.set(ip, {
            count: 1,
            startedAt: now,
        });
        return true;
    }

    if (windowState.count >= maxSessionCreatesPerWindow) {
        return false;
    }

    windowState.count += 1;
    return true;
}

function createSessionId() {
    return crypto.randomBytes(18).toString('base64url');
}

function parsePublicPath(urlPathname) {
    const match = /^\/s\/([^/]+)(\/.*)?$/.exec(urlPathname);

    if (!match) {
        return undefined;
    }

    return {
        id: match[1],
        targetPath: match[2] || '/',
        source: 'path',
    };
}

function getSingleHeaderValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function parsePublicPathFromReferer(req, targetPath) {
    const referer = getSingleHeaderValue(req.headers.referer);

    if (!referer) {
        return undefined;
    }

    let refererUrl;

    try {
        refererUrl = new URL(referer, `http://${req.headers.host || 'relay.local'}`);
    } catch {
        return undefined;
    }

    if (req.headers.host && refererUrl.host && refererUrl.host !== req.headers.host) {
        return undefined;
    }

    const publicPath = parsePublicPath(refererUrl.pathname);

    if (!publicPath) {
        return undefined;
    }

    return {
        id: publicPath.id,
        targetPath: targetPath || '/',
        source: 'referer',
    };
}

function getSessionLocationPath(sessionId, targetPath) {
    const normalizedTargetPath = targetPath && targetPath.startsWith('/')
        ? targetPath
        : `/${targetPath || ''}`;

    if (
        normalizedTargetPath === '/'
        || normalizedTargetPath.startsWith('/?')
        || normalizedTargetPath.startsWith('/#')
    ) {
        return `/s/${sessionId}/index.html${normalizedTargetPath.slice(1)}`;
    }

    return `/s/${sessionId}${normalizedTargetPath}`;
}

function isDocumentNavigationRequest(req) {
    const method = req.method || 'GET';

    if (method !== 'GET' && method !== 'HEAD') {
        return false;
    }

    const fetchDest = (getSingleHeaderValue(req.headers['sec-fetch-dest']) || '').toLowerCase();

    if (fetchDest === 'document' || fetchDest === 'iframe') {
        return true;
    }

    const fetchMode = (getSingleHeaderValue(req.headers['sec-fetch-mode']) || '').toLowerCase();

    if (fetchMode === 'navigate') {
        return true;
    }

    const accept = getSingleHeaderValue(req.headers.accept) || '';
    return /\btext\/html\b/i.test(accept);
}

function clearIdleTimer(session) {
    if (session.idleTimer) {
        clearTimeout(session.idleTimer);
        session.idleTimer = undefined;
    }
}

function scheduleIdleClose(session) {
    if (session.viewers.size > 0 || session.pending.size > 0 || session.wsBridges.size > 0) {
        return;
    }

    clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
        closeSession(session, 'idle timeout');
    }, idleTimeoutMs);
}

function closeSession(session, reason) {
    if (!sessions.has(session.id)) {
        return;
    }

    clearIdleTimer(session);
    if (session.ttlTimer) {
        clearTimeout(session.ttlTimer);
        session.ttlTimer = undefined;
    }
    if (session.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
        session.heartbeatInterval = undefined;
    }
    if (session.heartbeatTimeout) {
        clearTimeout(session.heartbeatTimeout);
        session.heartbeatTimeout = undefined;
    }
    sessions.delete(session.id);

    for (const pending of session.pending.values()) {
        clearTimeout(pending.timer);
        if (!pending.res.writableEnded) {
            pending.res.writeHead(502, { 'Content-Type': 'text/plain' });
            pending.res.end(`Tunnel closed: ${reason}`);
        }
    }
    session.pending.clear();

    for (const viewer of session.viewers) {
        viewer.close(1001, reason);
    }
    session.viewers.clear();

    for (const bridgeId of [...session.wsBridges.keys()]) {
        closeWsBridge(session, bridgeId, 1001, reason);
    }

    if (session.owner.readyState === WebSocket.OPEN) {
        session.owner.close(1000, reason);
    }

    console.log(`[relay] closed ${session.id}: ${reason}`);
}

function sanitizeResponseHeaders(headers) {
    const blocked = new Set([
        'connection',
        'content-length',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
    ]);
    const output = {};

    for (const [key, value] of Object.entries(headers || {})) {
        if (!blocked.has(key.toLowerCase()) && value !== undefined) {
            output[key] = value;
        }
    }

    return output;
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let length = 0;

        req.on('data', (chunk) => {
            length += chunk.length;

            if (length > maxBodyBytes) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }

            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function isHtmlResponse(headers) {
    const ct = headers['content-type'] || headers['Content-Type'] || '';
    const ctStr = Array.isArray(ct) ? ct[0] : String(ct);
    return /text\/html/i.test(ctStr);
}

function isCssResponse(headers) {
    const ct = headers['content-type'] || headers['Content-Type'] || '';
    const ctStr = Array.isArray(ct) ? ct[0] : String(ct);
    return /text\/css/i.test(ctStr);
}

function isJavaScriptResponse(headers) {
    const ct = headers['content-type'] || headers['Content-Type'] || '';
    const ctStr = Array.isArray(ct) ? ct[0] : String(ct);
    return /(?:java|ecma)script|text\/jscript/i.test(ctStr);
}

function getTunnelBasePath(sessionId, targetPath) {
    const prefix = `/s/${sessionId}`;
    let normalizedTargetPath = targetPath || '/';

    if (!normalizedTargetPath.startsWith('/')) {
        normalizedTargetPath = `/${normalizedTargetPath}`;
    }

    // Browser resolves relative paths from the last slash
    // /archives -> /
    // /archives/ -> /archives/
    // /dir/file.html -> /dir/
    const directoryPath = normalizedTargetPath.slice(0, normalizedTargetPath.lastIndexOf('/') + 1) || '/';
    return `${prefix}${directoryPath}`;
}

function isExecutableInlineScript(openingTag) {
    const typeMatch = /\btype\s*=\s*(["']?)([^"'\s>]+)\1/i.exec(openingTag);

    if (!typeMatch) {
        return true;
    }

    const type = typeMatch[2].split(';')[0].toLowerCase();
    return [
        'application/ecmascript',
        'application/javascript',
        'module',
        'text/ecmascript',
        'text/javascript',
    ].includes(type);
}

const COMMON_TUNNEL_BACKEND_PORTS = [3000, 3001, 5000, 5001, 8000, 8080, 8888, 4200, 5173];
const TUNNEL_API_PREFIX = '/api';

function rewriteLocalBackendUrlsForTunnel(script, prefix) {
    let rewritten = script;

    for (const port of COMMON_TUNNEL_BACKEND_PORTS) {
        const hostPattern = '(?:localhost|127\\.0\\.0\\.1)';
        const portPattern = `${hostPattern}:${port}`;

        rewritten = rewritten
            .replace(
                new RegExp(`(["'\`])https?:\\/\\/${portPattern}(\\/[^"'\`]*)?\\1`, 'gi'),
                (match, quote, requestPath = '') => {
                    const normalizedPath = requestPath || '/';
                    const apiPath = normalizedPath.startsWith(TUNNEL_API_PREFIX)
                        ? normalizedPath
                        : `${TUNNEL_API_PREFIX}${normalizedPath === '/' ? '' : normalizedPath}`;

                    return `${quote}${prefix}${apiPath}${quote}`;
                }
            )
            .replace(
                new RegExp(`(["'\`])wss?:\\/\\/${portPattern}(\\/[^"'\`]*)?\\1`, 'gi'),
                (match, quote, requestPath = '') => {
                    const normalizedPath = requestPath || '/';
                    const apiPath = normalizedPath.startsWith(TUNNEL_API_PREFIX)
                        ? normalizedPath
                        : `${TUNNEL_API_PREFIX}${normalizedPath === '/' ? '' : normalizedPath}`;

                    return `${quote}${prefix}${apiPath}${quote}`;
                }
            );
    }

    return rewritten;
}

function rewriteWebSocketUrlsForTunnel(script, prefix) {
    const rootPath = `${prefix}/`;

    return script
        .replace(/new\s+WebSocket\s*\(\s*(["'])(wss?:\/\/[^/"']+)\1/gi, (match, quote, url) => {
            try {
                const parsed = new URL(url);
                const rewrittenPath = parsed.pathname === '/' || parsed.pathname === ''
                    ? rootPath
                    : `${prefix}${parsed.pathname}${parsed.search}`;

                return `new WebSocket(${quote}${rewrittenPath}${quote}`;
            } catch {
                return match;
            }
        })
        .replace(/new\s+WebSocket\s*\(\s*(["'])\/(?!\/|s\/)/gi, (match, q) => `new WebSocket(${q}${prefix}/`);
}

function isReloadWebSocketPath(targetPath) {
    return /\.html?$/i.test(targetPath || '');
}

function closeWsBridge(session, bridgeId, code = 1000, reason = 'bridge closed') {
    const bridge = session.wsBridges.get(bridgeId);

    if (!bridge) {
        return;
    }

    session.wsBridges.delete(bridgeId);

    if (bridge.timer) {
        clearTimeout(bridge.timer);
    }

    if (bridge.viewerWs && bridge.viewerWs.readyState === WebSocket.OPEN) {
        bridge.viewerWs.close(code, reason);
    }
}

function bridgeViewerToOwner(session, bridgeId, viewerWs) {
    const bridge = session.wsBridges.get(bridgeId);

    if (!bridge) {
        return;
    }

    bridge.viewerWs = viewerWs;

    viewerWs.on('message', (data, isBinary) => {
        if (session.owner.readyState !== WebSocket.OPEN) {
            return;
        }

        const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
        sendJson(session.owner, {
            type: 'wsFrame',
            id: bridgeId,
            data: payload.toString('base64'),
            binary: Boolean(isBinary),
        });
    });

    viewerWs.on('close', (code, reasonBuffer) => {
        if (session.owner.readyState === WebSocket.OPEN) {
            sendJson(session.owner, {
                type: 'wsClose',
                id: bridgeId,
                code,
                reason: reasonBuffer.toString(),
            });
        }

        session.wsBridges.delete(bridgeId);
        scheduleIdleClose(session);
    });

    viewerWs.on('error', () => {
        closeWsBridge(session, bridgeId, 1011, 'viewer socket error');
        if (session.owner.readyState === WebSocket.OPEN) {
            sendJson(session.owner, {
                type: 'wsClose',
                id: bridgeId,
                code: 1011,
                reason: 'viewer socket error',
            });
        }
    });
}

function startTunneledWebSocket(session, req, socket, head, publicPath) {
    const requestUrl = new URL(req.url || '/', 'http://relay.local');
    const bridgeId = crypto.randomUUID();
    const targetPath = `${publicPath.targetPath}${requestUrl.search}`;

    session.wsBridges.set(bridgeId, {
        req,
        socket,
        head,
        timer: setTimeout(() => {
            if (!session.wsBridges.has(bridgeId)) {
                return;
            }

            session.wsBridges.delete(bridgeId);

            if (!socket.destroyed) {
                socket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
                socket.destroy();
            }
        }, requestTimeoutMs),
    });

    sendJson(session.owner, {
        type: 'wsOpen',
        id: bridgeId,
        path: targetPath,
        headers: req.headers,
    });
}

function completeTunneledWebSocket(session, bridgeId) {
    const bridge = session.wsBridges.get(bridgeId);

    if (!bridge || bridge.viewerWs) {
        return;
    }

    if (bridge.timer) {
        clearTimeout(bridge.timer);
        bridge.timer = undefined;
    }

    viewerWss.handleUpgrade(bridge.req, bridge.socket, bridge.head, (viewerWs) => {
        bridgeViewerToOwner(session, bridgeId, viewerWs);
    });
}

function rewriteScriptForTunnel(script, prefix) {
    const rootPath = `${prefix}/index.html`;

    return rewriteLocalBackendUrlsForTunnel(
        rewriteWebSocketUrlsForTunnel(script, prefix),
        prefix
    )
        .replace(/\b(?:(?:window|document)\.)?location\.pathname\b(?!\s*(?:[+\-*/%&|^]?=|\+\+|--))/g, 'window.__huntersTunnelPathname()')
        .replace(/(\b(?:(?:window|document)\.)?location\.(?:assign|replace)\s*\(\s*)(["'`])\/(?=[?#]|\2)/g, `$1$2${rootPath}`)
        .replace(/(\b(?:(?:window|document)\.)?location\.(?:href|pathname)\s*=\s*)(["'`])\/(?=[?#]|\2)/g, `$1$2${rootPath}`)
        .replace(/(\b(?:(?:window|document)\.)?location(?!\s*\.)\s*=\s*)(["'`])\/(?=[?#]|\2)/g, `$1$2${rootPath}`)
        .replace(/(\b(?:window\.)?open\s*\(\s*)(["'`])\/(?=[?#]|\2)/g, `$1$2${rootPath}`)
        .replace(/(\b(?:(?:window|document)\.)?location\.(?:assign|replace)\s*\(\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`)
        .replace(/(\b(?:(?:window|document)\.)?location\.(?:href|pathname)\s*=\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`)
        .replace(/(\b(?:(?:window|document)\.)?location(?!\s*\.)\s*=\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`)
        .replace(/(\b(?:window\.)?open\s*\(\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`)
        .replace(/(\bimport\s*\(\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`)
        .replace(/(\bimport\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`)
        .replace(/(\b(?:import|export)\s+[^;"'`]*?\s+from\s*)(["'`])\/(?!\/|s\/)/g, `$1$2${prefix}/`);
}

function rewriteInlineScriptsForTunnel(html, prefix) {
    return html.replace(
        /(<script\b(?![^>]*\bsrc\s*=)[^>]*>)([\s\S]*?)(<\/script>)/gi,
        (match, openingTag, scriptBody, closingTag) => {
            if (!isExecutableInlineScript(openingTag)) {
                return match;
            }

            // Scripts the extension injects already address the tunnel correctly.
            // Rewriting location.pathname inside them collapses the share path to
            // "/", which breaks the live-reload WebSocket and the backend shim's
            // tunnel-prefix detection.
            if (/\sdata-hunters-(?:live-reload|backend-shim|tunnel)\b/i.test(openingTag)) {
                return match;
            }

            // Chrome does not allow replacing location.assign/replace at runtime,
            // so fix common inline redirect code before the browser executes it.
            const rewrittenScript = rewriteScriptForTunnel(scriptBody, prefix);

            return openingTag + rewrittenScript + closingTag;
        }
    );
}

function rewriteInlineEventHandlersForTunnel(html, prefix) {
    return html.replace(
        /(\s+on[a-z][\w:-]*\s*=\s*)(["'])([\s\S]*?)(\2)/gi,
        (match, pre, quote, handler, post) => pre + quote + rewriteScriptForTunnel(handler, prefix) + post
    );
}

function rewriteCssForTunnel(bodyBuffer, sessionId) {
    const prefix = `/s/${sessionId}`;
    const css = bodyBuffer
        .toString('utf-8')
        .replace(/(url\s*\(\s*["']?)\/(?!\/|s\/)/gi, `$1${prefix}/`)
        .replace(/(@import\s+(?:url\(\s*)?["'])\/(?!\/|s\/)/gi, `$1${prefix}/`);

    return Buffer.from(css, 'utf-8');
}

function rewriteJavaScriptForTunnel(bodyBuffer, sessionId) {
    const prefix = `/s/${sessionId}`;
    return Buffer.from(rewriteScriptForTunnel(bodyBuffer.toString('utf-8'), prefix), 'utf-8');
}

function rewriteHtmlForTunnel(bodyBuffer, sessionId, targetPath, publicUrl) {
    const prefix = `/s/${sessionId}`;
    const rootPath = `${prefix}/index.html`;
    const basePath = getTunnelBasePath(sessionId, targetPath);
    const baseHref = publicUrl ? new URL(basePath, publicUrl).toString() : basePath;
    let html = bodyBuffer.toString('utf-8');
    const tunnelAttributePattern = '(?:src|href|action|poster|formaction|manifest|xlink:href|data-[\\w:-]+)';
    const unquotedAttributeValuePattern = "[^\\s\"'=<>`]+";

    // Existing app base tags point at the original site route (for example /shop/).
    // The tunnel owns base resolution so page-local relative files stay under /s/<id>/.
    html = html.replace(/<base\b[^>]*>/gi, '');

    // Rewrite absolute paths in HTML attributes:
    // src="/x", href='/x', href=/x, action="/x", data-src="/x", etc.
    // Skip protocol-relative URLs (//cdn.example.com) and already-prefixed paths (/s/).
    html = html.replace(
        /(\b(?:href|action|formaction)\s*=\s*)(["'])\/(?=[?#]|\2)/gi,
        `$1$2${rootPath}`
    );

    html = html.replace(
        /(\b(?:href|action|formaction)\s*=\s*)\/(?=[\s>#?])/gi,
        `$1${rootPath}`
    );

    html = html.replace(
        new RegExp(`(\\b${tunnelAttributePattern}\\s*=\\s*)(["'])\\/(?!\\/|s\\/)`, 'gi'),
        `$1$2${prefix}/`
    );

    html = html.replace(
        new RegExp(`(\\b${tunnelAttributePattern}\\s*=\\s*)\\/(?!\\/|s\\/)(${unquotedAttributeValuePattern})`, 'gi'),
        `$1${prefix}/$2`
    );

    // Rewrite srcset attribute values with absolute paths
    html = html.replace(
        /(\b(?:srcset|imagesrcset)\s*=\s*["'])([^"']*)(["'])/gi,
        (match, pre, value, post) => {
            const rewritten = value.replace(/(^|,\s*)\/(?!\/|s\/)/g, `$1${prefix}/`);
            return pre + rewritten + post;
        }
    );

    // Rewrite url() in inline styles
    html = html.replace(
        /(url\s*\(\s*["']?)\/(?!\/|s\/)/gi,
        `$1${prefix}/`
    );

    html = rewriteInlineScriptsForTunnel(html, prefix);
    html = rewriteInlineEventHandlersForTunnel(html, prefix);

    // Build the routing-fix script that intercepts client-side navigations
    // Detect if a paired backend tunnel (api-{name}) exists for this session
    const frontendName = sessionId;
    const backendSessionId = `api-${frontendName}`;
    const backendPrefix = `/s/${backendSessionId}`;

    const routingFix = [
        '<script data-hunters-tunnel>',
        '(function(){',
        'var P=' + JSON.stringify(prefix) + ';',
        'var BP=' + JSON.stringify(backendPrefix) + ';',
        'var API=' + JSON.stringify(TUNNEL_API_PREFIX) + ';',
        'var PORTS=' + JSON.stringify(COMMON_TUNNEL_BACKEND_PORTS) + ';',
        'function inP(p){return p===P||p.indexOf(P+"/")===0}',
        'function inBP(p){return p===BP||p.indexOf(BP+"/")===0}',
        'function tp(p){return P+(p==="/" ? "/index.html" : p)}',
        'function tpWs(p){return P+(p==="/" ? "/" : p)}',
        'function rootIndex(p){if(/\\/index\\.html?$/i.test(p)){p=p.slice(0,p.lastIndexOf("/")+1)||"/"}return p||"/"}',
        'window.__huntersTunnelPathname=function(){',
        'var p=location.pathname;if(p===P)return "/";',
        'if(p.indexOf(P+"/")===0)p=p.slice(P.length)||"/";return rootIndex(p)};',
        'function isBackendHost(h){return h==="localhost"||h==="127.0.0.1"||h==="[::1]"}',
        'function isBackendPort(p){return PORTS.indexOf(Number(p))>=0}',
        // Route backend calls through the paired backend tunnel prefix (BP)
        'function toBP(path){return BP+(path&&path!=="/"?path:"/");}',
        // URL rewriter helper
        'function rw(u){try{var o=new URL(u,location.href);',
        'var port=Number(o.port||(o.protocol==="https:"||o.protocol==="wss:"?443:80));',
        // localhost:BACKEND_PORT → /s/api-{name}/{path}
        'if(isBackendHost(o.hostname)&&isBackendPort(port)){',
        'return location.origin+toBP(o.pathname)+o.search+o.hash}',
        'if(o.origin===location.origin&&!inP(o.pathname)&&!inBP(o.pathname)){',
        'if((o.protocol==="ws:"||o.protocol==="wss:")&&(o.pathname==="/"||o.pathname==="")){',
        'return (location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+tpWs("/")}',
        'o.pathname=tp(o.pathname);return o.toString()}}catch(e){',
        'if(typeof u==="string"&&u.charAt(0)==="/"&&u.charAt(1)!=="/"&&!u.startsWith(P)){return P+u}}return u}',
        // Override location.replace / location.assign
        'try{var _R=location.replace.bind(location),_A=location.assign.bind(location);',
        'location.replace=function(u){_R(rw(u))};location.assign=function(u){_A(rw(u))}}catch(e){};',
        // Override History API
        'var _PS=history.pushState.bind(history),_RS=history.replaceState.bind(history);',
        'function rwS(f){return function(s,t,u){if(u)u=rw(String(u));return f(s,t,u)}}',
        'history.pushState=rwS(_PS);history.replaceState=rwS(_RS);',
        // Helper: check if a URL looks like a cross-origin API call (not a CDN/asset)
        'function isCrossOriginApi(u){try{var o=new URL(u,location.href);',
        'if(o.origin===location.origin)return false;',
        // Skip known CDNs and static asset hosts
        'var h=o.hostname;',
        'if(/\\.(googleapis|gstatic|cloudflare|jsdelivr|unpkg|cdnjs|bootstrapcdn|fontawesome|google|facebook|twitter|youtube|ytimg|firebase|firebaseio|github)\\./.test(h))return false;',
        'if(/^(cdn|fonts|static|assets|images|img|media)\\./i.test(h))return false;',
        // Skip if it looks like an image/font/css/video
        'var ext=o.pathname.split(".").pop().toLowerCase();',
        'if(["png","jpg","jpeg","gif","webp","svg","ico","woff","woff2","ttf","eot","otf","css","mp4","webm","ogg","mp3","wav"].indexOf(ext)>=0)return false;',
        // If pathname contains /api/ or host starts with api. it is likely an API call
        'if(o.pathname.indexOf("/api")>=0||h.indexOf("api.")===0||h.indexOf("api-")===0)return true;',
        // If it has Accept: application/json or similar content-type, it is likely an API call
        'return true}catch(e){return false}}',
        // Override fetch with CORS retry through backend tunnel
        'var _F=window.fetch;',
        'window.fetch=function(i,o){',
        'if(typeof i==="string"&&i.charAt(0)==="/"&&i.charAt(1)!=="/"&&!i.startsWith(P)&&!i.startsWith(BP))i=P+i;',
        'var origUrl=typeof i==="string"?i:(i&&i.url?i.url:"");',
        'if(isCrossOriginApi(origUrl)){',
        'try{var oo=new URL(origUrl,location.href);',
        'var rp=toBP(oo.pathname)+oo.search;',
        'return _F.call(this,rp,o)}catch(e){}}',
        'return _F.call(this,i,o)};',
        // Rewrite WebSocket URLs that still point at the public site root or local backend.
        'var _WS=window.WebSocket;',
        'window.WebSocket=function(u,p){return new _WS(rw(u),p)};',
        // Override XMLHttpRequest.open with CORS retry through backend tunnel
        'var _XO=XMLHttpRequest.prototype.open;',
        'XMLHttpRequest.prototype.open=function(m,u){',
        'if(typeof u==="string"&&u.charAt(0)==="/"&&u.charAt(1)!=="/"&&!u.startsWith(P)&&!u.startsWith(BP))arguments[1]=P+u;',
        'else if(typeof u==="string"&&isCrossOriginApi(u)){',
        'try{var oo=new URL(u,location.href);arguments[1]=toBP(oo.pathname)+oo.search}catch(e){}}',
        'return _XO.apply(this,arguments)};',
        // Intercept anchor clicks that would leave the tunnel
        'document.addEventListener("click",function(e){',
        'var a=e.target&&e.target.closest&&e.target.closest("a");',
        'if(!a||!a.href)return;try{var o=new URL(a.href);',
        'if(o.origin===location.origin&&!inP(o.pathname)&&!inBP(o.pathname)){',
        'e.preventDefault();location.href=tp(o.pathname)+o.search+o.hash}}catch(x){}},true);',
        '})();',
        '</script>',
    ].join('');

    // Inject <base> tag (for relative URLs) + routing fix script right after <head>
    const baseTag = '<base href="' + baseHref + '">';
    const injection = baseTag + '\n' + routingFix;

    if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, '$&\n' + injection);
    } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, '$&\n<head>' + injection + '</head>');
    } else {
        html = injection + '\n' + html;
    }

    return Buffer.from(html, 'utf-8');
}

function handleOwnerMessage(session, rawMessage) {
    let message;

    try {
        message = JSON.parse(rawMessage.toString());
    } catch {
        return;
    }

    if (message.type === 'reload') {
        for (const viewer of session.viewers) {
            if (viewer.readyState === WebSocket.OPEN) {
                viewer.send('reload');
            }
        }
        return;
    }

    if (message.type === 'wsReady' && typeof message.id === 'string') {
        completeTunneledWebSocket(session, message.id);
        return;
    }

    if (message.type === 'wsError' && typeof message.id === 'string') {
        const bridge = session.wsBridges.get(message.id);

        if (bridge && !bridge.viewerWs && !bridge.socket.destroyed) {
            if (bridge.timer) {
                clearTimeout(bridge.timer);
            }

            session.wsBridges.delete(message.id);
            bridge.socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            bridge.socket.destroy();
        }

        return;
    }

    if (message.type === 'wsFrame' && typeof message.id === 'string' && typeof message.data === 'string') {
        const bridge = session.wsBridges.get(message.id);

        if (bridge?.viewerWs?.readyState === WebSocket.OPEN) {
            const payload = Buffer.from(message.data, 'base64');
            bridge.viewerWs.send(payload, { binary: Boolean(message.binary) });
        }

        return;
    }

    if (message.type === 'wsClose' && typeof message.id === 'string') {
        closeWsBridge(session, message.id, Number(message.code) || 1000, message.reason || 'backend closed');
        return;
    }

    if (message.type !== 'response' || typeof message.id !== 'string') {
        return;
    }

    const pending = session.pending.get(message.id);
    if (!pending) {
        return;
    }

    session.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (pending.res.writableEnded) {
        scheduleIdleClose(session);
        return;
    }

    const status = Number(message.status) || 502;
    const headers = sanitizeResponseHeaders(message.headers);
    let body = Buffer.from(message.bodyBase64 || '', 'base64');

    if (pending.method !== 'HEAD' && isHtmlResponse(headers) && body.length > 0) {
        // Rewrite HTML responses so assets load through the tunnel prefix
        // and client-side routing stays within the tunnel.
        try {
            body = rewriteHtmlForTunnel(body, session.id, pending.targetPath, session.publicUrl);
        } catch (rewriteErr) {
            console.error('[relay] HTML rewrite error:', rewriteErr);
        }
        // Update content-length if present since the body size changed.
        delete headers['content-length'];
    } else if (pending.method !== 'HEAD' && isCssResponse(headers) && body.length > 0) {
        try {
            body = rewriteCssForTunnel(body, session.id);
        } catch (rewriteErr) {
            console.error('[relay] CSS rewrite error:', rewriteErr);
        }
        // Update content-length if present since the body size changed.
        delete headers['content-length'];
    } else if (pending.method !== 'HEAD' && isJavaScriptResponse(headers) && body.length > 0) {
        try {
            body = rewriteJavaScriptForTunnel(body, session.id);
        } catch (rewriteErr) {
            console.error('[relay] JS rewrite error:', rewriteErr);
        }
        // Update content-length if present since the body size changed.
        delete headers['content-length'];
    }

    // Rewrite Location headers on redirects so they stay inside the tunnel.
    const location = headers['location'] || headers['Location'];
    if (location && status >= 300 && status < 400) {
        const prefix = `/s/${session.id}`;
        const loc = String(location);
        if (loc.startsWith('/') && !loc.startsWith('//') && !loc.startsWith(prefix)) {
            headers['location'] = getSessionLocationPath(session.id, loc);
            delete headers['Location'];
        }
    }

    pending.res.writeHead(status, headers);
    pending.res.end(pending.method === 'HEAD' ? undefined : body, () => {
        scheduleIdleClose(session);
    });
}

async function handlePublicRequest(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://relay.local');

    if (requestUrl.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }

    const publicPath = parsePublicPath(requestUrl.pathname)
        || parsePublicPathFromReferer(req, requestUrl.pathname);
    if (!publicPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Hunters relay is running. Use a generated /s/<session>/ URL.');
        return;
    }

    const session = sessions.get(publicPath.id);
    if (!session) {
        res.writeHead(410, { 'Content-Type': 'text/plain' });
        res.end('This Hunters share link is no longer active.');
        return;
    }

    clearIdleTimer(session);

    if (publicPath.source === 'referer' && isDocumentNavigationRequest(req)) {
        res.writeHead(302, {
            'Cache-Control': 'no-store',
            Location: `${getSessionLocationPath(publicPath.id, publicPath.targetPath)}${requestUrl.search}`,
        });
        res.end();
        scheduleIdleClose(session);
        return;
    }

    let body;
    try {
        body = await readRequestBody(req);
    } catch (error) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end(error.message);
        return;
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
        session.pending.delete(id);
        if (!res.writableEnded) {
            res.writeHead(504, { 'Content-Type': 'text/plain' });
            res.end('Local server did not respond in time.');
        }
        scheduleIdleClose(session);
    }, requestTimeoutMs);

    session.pending.set(id, {
        method: req.method || 'GET',
        res,
        targetPath: publicPath.targetPath,
        timer,
    });

    sendJson(session.owner, {
        type: 'request',
        id,
        method: req.method || 'GET',
        path: `${publicPath.targetPath}${requestUrl.search}`,
        headers: req.headers,
        bodyBase64: body.toString('base64'),
    });
}

function createTunnelSession(socket, req) {
    const ownerIp = getClientIp(req);

    if (!canCreateSessionForIp(ownerIp)) {
        sendJson(socket, {
            type: 'error',
            message: 'Too many sessions created from this IP. Try again later.',
        });
        socket.close(1008, 'too many session creates from this IP');
        return;
    }

    if (sessions.size >= maxSessions) {
        sendJson(socket, {
            type: 'error',
            message: 'Relay is at capacity. Try again later.',
        });
        socket.close(1013, 'relay capacity reached');
        return;
    }

    if (countSessionsForIp(ownerIp) >= maxSessionsPerIp) {
        sendJson(socket, {
            type: 'error',
            message: 'Too many active sessions from this IP.',
        });
        socket.close(1008, 'too many sessions from this IP');
        return;
    }

    const requestUrl = new URL(req.url || '/', 'http://relay.local');
    let id = requestUrl.searchParams.get('name');
    if (id) {
        id = id.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
        if (id.length < 3 || id.length > 63) id = null;
        if (id && sessions.has(id)) {
            sendJson(socket, { type: 'error', message: 'Subdomain already taken. Try another.' });
            socket.close(1008, 'name taken');
            return;
        }
    }
    if (!id) {
        id = createSessionId();
    }
    const publicBaseUrl = getPublicBaseUrl(req);
    const session = {
        id,
        ownerIp,
        owner: socket,
        publicUrl: `${publicBaseUrl}/s/${id}/`,
        pending: new Map(),
        viewers: new Set(),
        wsBridges: new Map(),
        idleTimer: undefined,
        ttlTimer: undefined,
        heartbeatInterval: undefined,
        heartbeatTimeout: undefined,
    };

    sessions.set(id, session);
    session.ttlTimer = setTimeout(() => {
        closeSession(session, 'session lifetime expired');
    }, sessionTtlMs);

    // --- Heartbeat: ping the owner every heartbeatIntervalMs.
    // If no pong arrives within heartbeatTimeoutMs, the owner is dead.
    // This ensures share links die within seconds when VS Code / the
    // extension / the user's machine goes away.
    socket.isAlive = true;
    socket.on('pong', () => {
        socket.isAlive = true;
        if (session.heartbeatTimeout) {
            clearTimeout(session.heartbeatTimeout);
            session.heartbeatTimeout = undefined;
        }
    });

    session.heartbeatInterval = setInterval(() => {
        if (!socket.isAlive) {
            // Previous ping was never answered — owner is dead.
            closeSession(session, 'owner heartbeat timeout');
            return;
        }

        socket.isAlive = false;
        if (socket.readyState === WebSocket.OPEN) {
            socket.ping();
        }

        // Safety net: if pong doesn't arrive within heartbeatTimeoutMs,
        // kill the session immediately instead of waiting for next interval.
        session.heartbeatTimeout = setTimeout(() => {
            if (!socket.isAlive) {
                closeSession(session, 'owner heartbeat timeout');
            }
        }, heartbeatTimeoutMs);
    }, heartbeatIntervalMs);

    sendJson(socket, {
        type: 'session',
        id,
        url: session.publicUrl,
        idleTimeoutMs,
        sessionTtlMs,
    });
    console.log(`[relay] opened ${id} from ${ownerIp}: ${session.publicUrl}`);

    socket.on('message', (message) => handleOwnerMessage(session, message));
    socket.on('close', () => closeSession(session, 'owner disconnected'));
    socket.on('error', () => closeSession(session, 'owner socket error'));
}

function attachViewer(session, socket) {
    clearIdleTimer(session);
    session.viewers.add(socket);
    sendJson(session.owner, {
        type: 'viewerCount',
        count: session.viewers.size,
    });

    socket.on('close', () => {
        session.viewers.delete(socket);
        sendJson(session.owner, {
            type: 'viewerCount',
            count: session.viewers.size,
        });
        scheduleIdleClose(session);
    });

    socket.on('error', () => {
        socket.close();
    });
}

function hasValidRelayToken(req) {
    if (!relayToken) {
        return true;
    }

    const authorization = req.headers.authorization || '';
    return authorization === `Bearer ${relayToken}`;
}

const server = http.createServer((req, res) => {
    handlePublicRequest(req, res).catch((error) => {
        console.error('[relay] request failed', error);
        if (!res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Relay error.');
        }
    });
});

const cleanupSessionCreateWindowsTimer = setInterval(() => {
    const now = Date.now();

    for (const [ip, windowState] of sessionCreateWindows.entries()) {
        if (now - windowState.startedAt > sessionCreateWindowMs) {
            sessionCreateWindows.delete(ip);
        }
    }
}, sessionCreateWindowMs);

cleanupSessionCreateWindowsTimer.unref();

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[relay] port ${port} is already in use. Stop the other process or change RELAY_PORT.`);
        process.exit(98);
    }

    console.error(`[relay] failed to start: ${error.message}`);
    process.exit(1);
});

server.on('upgrade', (req, socket, head) => {
    const requestUrl = new URL(req.url || '/', 'http://relay.local');

    if (requestUrl.pathname === '/tunnel') {
        if (!hasValidRelayToken(req)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        tunnelWss.handleUpgrade(req, socket, head, (ws) => {
            createTunnelSession(ws, req);
        });
        return;
    }

    const publicPath = parsePublicPath(requestUrl.pathname);
    const session = publicPath ? sessions.get(publicPath.id) : undefined;
    if (!session) {
        socket.write('HTTP/1.1 410 Gone\r\n\r\n');
        socket.destroy();
        return;
    }

    if (isReloadWebSocketPath(publicPath.targetPath)) {
        viewerWss.handleUpgrade(req, socket, head, (ws) => {
            attachViewer(session, ws);
        });
        return;
    }

    startTunneledWebSocket(session, req, socket, head, publicPath);
});

server.listen(port, host, () => {
    console.log(`[relay] listening on ${host}:${port}`);
    if (configuredPublicBaseUrl) {
        console.log(`[relay] public base URL: ${configuredPublicBaseUrl}`);
    }
    if (!relayToken) {
        console.warn('[relay] RELAY_TOKEN is not set. Public session creation is enabled.');
        console.warn(`[relay] limits: max sessions=${maxSessions}, per IP=${maxSessionsPerIp}, creates per IP=${maxSessionCreatesPerWindow}/${sessionCreateWindowMs}ms, ttl=${sessionTtlMs}ms`);
    }
});
