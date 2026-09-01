import * as vscode from 'vscode';
import * as http from 'http';
import type { Duplex } from 'stream';
import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { RawData, WebSocket, WebSocketServer } from 'ws';

const host = '0.0.0.0';
const preferredPort = 5500;
const lastPortToTry = 5599;
const isRunningContextKey = 'huntersLiveServer.isRunning';
const isSharedContextKey = 'huntersLiveServer.isShared';

let server: http.Server | undefined;
let wss: WebSocketServer | undefined;
let saveListener: vscode.Disposable | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let currentServerUrl: string | undefined;
let currentShareUrl: string | undefined;
let currentRelayFailureMessage: string | undefined;
let currentServerPort: number | undefined;
let currentViewerCount = 0;
let relayTunnel: RelayTunnel | undefined;
let currentProxyMode: 'static' | 'staticProxy' | 'fullStackProxy' = 'static';
let currentBackendPort: number | undefined;
let backendWatchInterval: ReturnType<typeof setInterval> | undefined;
let currentLaunchTarget: LaunchTarget | undefined;
let currentApiPrefix = '/api';
let currentRelayFilePath: string | undefined;
let relayReconnectTimer: ReturnType<typeof setTimeout> | undefined;
let relayReconnectAttempt = 0;
const maxRelayReconnectDelayMs = 30000;

type LaunchTarget = {
    workspaceRoot: string;
    defaultFile: string;
};

type RelayRequestMessage = {
    type: 'request';
    id: string;
    method: string;
    path: string;
    headers?: Record<string, string | string[] | undefined>;
    bodyBase64?: string;
};

type RelaySessionMessage = {
    type: 'session';
    url: string;
};

type RelayViewerCountMessage = {
    type: 'viewerCount';
    count: number;
};

type RelayWsOpenMessage = {
    type: 'wsOpen';
    id: string;
    path: string;
    headers?: Record<string, string | string[] | undefined>;
};

type RelayWsFrameMessage = {
    type: 'wsFrame';
    id: string;
    data: string;
    binary?: boolean;
};

type RelayWsCloseMessage = {
    type: 'wsClose';
    id: string;
    code?: number;
    reason?: string;
};

type RelayMessage = RelayRequestMessage | RelaySessionMessage | RelayViewerCountMessage;

type RelayTunnelOptions = {
    relayUrl: string;
    relayToken: string;
    localPort: number;
    onViewerCount: (count: number) => void;
    onClose: () => void;
};

type RelayStartResult = {
    configured: boolean;
    shareUrl?: string;
    failureMessage?: string;
};

function getNetworkIP(): string {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] ?? []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }

    return '127.0.0.1';
}

function getMimeType(filePath: string): string {
    const mimeTypes: Record<string, string> = {
        '.css': 'text/css',
        '.gif': 'image/gif',
        '.html': 'text/html',
        '.ico': 'image/x-icon',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.mjs': 'text/javascript',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.txt': 'text/plain',
        '.webp': 'image/webp',
    };

    return mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function normalizeRelayUrl(configuredRelayUrl: string): string {
    const parsedUrl = new URL(configuredRelayUrl);

    if (parsedUrl.protocol === 'http:') {
        parsedUrl.protocol = 'ws:';
    } else if (parsedUrl.protocol === 'https:') {
        parsedUrl.protocol = 'wss:';
    }

    if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) {
        throw new Error('Relay URL must start with ws://, wss://, http://, or https://.');
    }

    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
        parsedUrl.pathname = '/tunnel';
    }

    return parsedUrl.toString();
}

function getShareUrlForPath(baseShareUrl: string, selectedFilePath: string): string {
    const normalizedSelectedFilePath = selectedFilePath.startsWith('/')
        ? selectedFilePath.slice(1)
        : selectedFilePath;

    if (!normalizedSelectedFilePath) {
        return baseShareUrl;
    }

    const parsedUrl = new URL(baseShareUrl);
    const basePath = parsedUrl.pathname.endsWith('/')
        ? parsedUrl.pathname
        : `${parsedUrl.pathname}/`;

    parsedUrl.pathname = `${basePath}${normalizedSelectedFilePath}`;
    return parsedUrl.toString();
}

function getConfiguredRelayUrl(): string {
    const configuration = vscode.workspace.getConfiguration('hunters-live-server');
    return configuration.get<string>('relayUrl', '').trim();
}

function isRelayUnauthorizedError(error: Error): boolean {
    return /401|unauthori[sz]ed/i.test(error.message);
}

function formatRelayTunnelError(error: Error): string {
    if (isRelayUnauthorizedError(error)) {
        return 'Hunters VPS share tunnel was rejected with 401 Unauthorized. For the public production relay, remove RELAY_TOKEN from the VPS .env or set RELAY_TOKEN= and restart the relay.';
    }

    return `Could not start Hunters VPS share tunnel: ${error.message}`;
}

function sanitizeRelayRequestPath(requestPath: string): string {
    if (!requestPath.startsWith('/')) {
        return '/';
    }

    return requestPath;
}

function sanitizeRelayRequestHeaders(headers: Record<string, string | string[] | undefined> | undefined, port: number): http.OutgoingHttpHeaders {
    const blockedHeaders = new Set([
        'connection',
        'content-length',
        'host',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
    ]);
    const output: http.OutgoingHttpHeaders = {
        host: `127.0.0.1:${port}`,
    };

    for (const [key, value] of Object.entries(headers ?? {})) {
        if (blockedHeaders.has(key.toLowerCase()) || value === undefined) {
            continue;
        }

        output[key] = value;
    }

    return output;
}

function requestLocalServer(message: RelayRequestMessage, port: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; bodyBase64: string }> {
    return new Promise((resolve) => {
        const requestBody = message.bodyBase64 ? Buffer.from(message.bodyBase64, 'base64') : undefined;
        const request = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: sanitizeRelayRequestPath(message.path),
                method: message.method,
                headers: sanitizeRelayRequestHeaders(message.headers, port),
            },
            (response) => {
                const chunks: Buffer[] = [];

                response.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                response.on('end', () => {
                    resolve({
                        status: response.statusCode ?? 502,
                        headers: response.headers,
                        bodyBase64: Buffer.concat(chunks).toString('base64'),
                    });
                });
            }
        );

        request.on('error', (error) => {
            resolve({
                status: 502,
                headers: { 'content-type': 'text/plain' },
                bodyBase64: Buffer.from(`Local Hunters server error: ${error.message}`).toString('base64'),
            });
        });

        if (requestBody && requestBody.length > 0) {
            request.write(requestBody);
        }

        request.end();
    });
}

function toWsMessageBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) {
        return data;
    }

    if (Array.isArray(data)) {
        return Buffer.concat(data);
    }

    return Buffer.from(data);
}

function parseRelayMessage(rawMessage: RawData): RelayMessage | undefined {
    let message: unknown;

    try {
        message = JSON.parse(rawMessage.toString());
    } catch {
        return undefined;
    }

    if (!message || typeof message !== 'object' || !('type' in message)) {
        return undefined;
    }

    const relayMessage = message as Partial<RelayMessage>;

    if (relayMessage.type === 'session' && typeof relayMessage.url === 'string') {
        return relayMessage as RelaySessionMessage;
    }

    if (
        relayMessage.type === 'request'
        && typeof relayMessage.id === 'string'
        && typeof relayMessage.method === 'string'
        && typeof relayMessage.path === 'string'
    ) {
        return relayMessage as RelayRequestMessage;
    }

    if (relayMessage.type === 'viewerCount' && typeof relayMessage.count === 'number') {
        return relayMessage as RelayViewerCountMessage;
    }

    return undefined;
}

class RelayTunnel {
    private socket: WebSocket | undefined;
    private disposed = false;
    private readonly wsBridges = new Map<string, WebSocket>();

    constructor(private readonly options: RelayTunnelOptions) {}

    connect(): Promise<string> {
        return new Promise((resolve, reject) => {
            const headers = this.options.relayToken
                ? { Authorization: `Bearer ${this.options.relayToken}` }
                : undefined;
            const socket = new WebSocket(this.options.relayUrl, { headers });
            let settled = false;

            this.socket = socket;

            const failStartup = (error: Error) => {
                if (settled) {
                    return;
                }

                settled = true;
                reject(error);
            };

            const startupTimer = setTimeout(() => {
                failStartup(new Error('Relay did not return a share URL in time.'));
                socket.close();
            }, 10000);

            socket.on('message', (rawMessage) => {
                let parsed: unknown;

                try {
                    parsed = JSON.parse(rawMessage.toString());
                } catch {
                    return;
                }

                if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
                    return;
                }

                const messageType = (parsed as { type: string }).type;

                if (messageType === 'wsOpen') {
                    void this.handleWsOpen(parsed as RelayWsOpenMessage);
                    return;
                }

                if (messageType === 'wsFrame') {
                    this.handleWsFrame(parsed as RelayWsFrameMessage);
                    return;
                }

                if (messageType === 'wsClose') {
                    this.handleWsClose(parsed as RelayWsCloseMessage);
                    return;
                }

                const message = parseRelayMessage(rawMessage);

                if (!message) {
                    return;
                }

                if (message.type === 'session') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(startupTimer);
                        resolve(message.url);
                    }
                    return;
                }

                if (message.type === 'viewerCount') {
                    this.options.onViewerCount(message.count);
                    return;
                }

                void this.handleRequest(message);
            });

            socket.on('error', (error) => {
                failStartup(error instanceof Error ? error : new Error(String(error)));
            });

            socket.on('close', () => {
                clearTimeout(startupTimer);

                if (!settled) {
                    failStartup(new Error('Relay connection closed before creating a share URL.'));
                    return;
                }

                if (!this.disposed) {
                    this.options.onClose();
                }
            });

            // The ws library automatically responds to relay heartbeat pings with pongs.
        });
    }

    sendReload(): void {
        this.send({
            type: 'reload',
        });
    }

    dispose(): void {
        this.disposed = true;

        for (const [bridgeId, backendWs] of this.wsBridges.entries()) {
            try {
                backendWs.close();
            } catch {
                // Bridge may already be closed.
            }

            this.wsBridges.delete(bridgeId);
        }

        // Use terminate() for immediate TCP teardown so the relay server
        // detects the disconnection instantly instead of waiting for a
        // graceful WebSocket close handshake that may never complete.
        if (this.socket) {
            try {
                this.socket.terminate();
            } catch {
                // Socket may already be closed.
            }
        }
        this.socket = undefined;
    }

    private async handleRequest(message: RelayRequestMessage): Promise<void> {
        const response = await requestLocalServer(message, this.options.localPort);

        this.send({
            type: 'response',
            id: message.id,
            status: response.status,
            headers: response.headers,
            bodyBase64: response.bodyBase64,
        });
    }

    private async handleWsOpen(message: RelayWsOpenMessage): Promise<void> {
        const requestPath = message.path.startsWith('/') ? message.path : `/${message.path}`;
        const backendWs = new WebSocket(`ws://127.0.0.1:${this.options.localPort}${requestPath}`);

        this.wsBridges.set(message.id, backendWs);

        backendWs.on('open', () => {
            this.send({
                type: 'wsReady',
                id: message.id,
            });
        });

        backendWs.on('message', (data, isBinary) => {
            const payload = toWsMessageBuffer(data);
            this.send({
                type: 'wsFrame',
                id: message.id,
                data: payload.toString('base64'),
                binary: isBinary,
            });
        });

        backendWs.on('close', (code, reason) => {
            this.wsBridges.delete(message.id);
            this.send({
                type: 'wsClose',
                id: message.id,
                code,
                reason: reason.toString(),
            });
        });

        backendWs.on('error', (error) => {
            if (backendWs.readyState === WebSocket.OPEN) {
                return;
            }

            this.wsBridges.delete(message.id);
            this.send({
                type: 'wsError',
                id: message.id,
                message: error.message,
            });
        });
    }

    private handleWsFrame(message: RelayWsFrameMessage): void {
        const backendWs = this.wsBridges.get(message.id);

        if (backendWs?.readyState !== WebSocket.OPEN) {
            return;
        }

        const payload = Buffer.from(message.data, 'base64');
        backendWs.send(payload, { binary: Boolean(message.binary) });
    }

    private handleWsClose(message: RelayWsCloseMessage): void {
        const backendWs = this.wsBridges.get(message.id);

        if (!backendWs) {
            return;
        }

        this.wsBridges.delete(message.id);

        try {
            backendWs.close(message.code ?? 1000, message.reason);
        } catch {
            // Bridge may already be closed.
        }
    }

    private send(payload: unknown): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(payload));
        }
    }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Reverse-proxy helpers: port detection + HTTP forwarding
 * ──────────────────────────────────────────────────────────────────────────── */

const COMMON_BACKEND_PORTS = [3000, 3001, 5000, 5001, 8000, 8080, 8888, 4200, 5173];
const BACKEND_WATCH_INTERVAL_MS = 2500;

function isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.request(
            { hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout: 800 },
            (res) => { res.resume(); resolve(true); }
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

function parsePortFromSource(content: string): number | undefined {
    const patterns = [
        /\.listen\s*\(\s*(\d{2,5})/,
        /process\.env\.PORT\s*\|\|\s*(\d{2,5})/,
        /PORT\s*[=:]\s*['"]?(\d{2,5})/i,
        /port\s*[=:]\s*['"]?(\d{2,5})/,
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
            const port = Number(match[1]);
            if (Number.isInteger(port) && port >= 1 && port <= 65535) {
                return port;
            }
        }
    }

    return undefined;
}

function getProjectBackendPortHints(workspaceRoot: string): number[] {
    const hints: number[] = [];
    const addHint = (port: number | undefined) => {
        if (port && !hints.includes(port)) {
            hints.push(port);
        }
    };

    const serverCandidates = ['server.js', 'server.mjs', 'server.ts', 'app.js', 'index.js', 'main.js'];
    for (const fileName of serverCandidates) {
        const filePath = path.join(workspaceRoot, fileName);
        if (!fs.existsSync(filePath)) {
            continue;
        }

        try {
            addHint(parsePortFromSource(fs.readFileSync(filePath, 'utf8')));
        } catch {
            // Ignore unreadable files during auto-detection.
        }
    }

    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
                scripts?: Record<string, string>;
            };
            for (const script of Object.values(packageJson.scripts ?? {})) {
                const portMatch = script.match(/(?:--port|-p)\s+(\d{2,5})|:(\d{2,5})\b|localhost:(\d{2,5})/);
                if (portMatch) {
                    addHint(Number(portMatch[1] ?? portMatch[2] ?? portMatch[3]));
                }
            }
        } catch {
            // Ignore invalid package.json during auto-detection.
        }
    }

    const configHints: { file: string; port: number }[] = [
        { file: 'next.config.js', port: 3000 },
        { file: 'next.config.mjs', port: 3000 },
        { file: 'next.config.ts', port: 3000 },
        { file: 'nuxt.config.js', port: 3000 },
        { file: 'nuxt.config.ts', port: 3000 },
        { file: 'vite.config.js', port: 5173 },
        { file: 'vite.config.ts', port: 5173 },
        { file: 'angular.json', port: 4200 },
        { file: 'svelte.config.js', port: 5173 },
    ];

    for (const hint of configHints) {
        if (fs.existsSync(path.join(workspaceRoot, hint.file))) {
            addHint(hint.port);
        }
    }

    return hints;
}

async function detectBackendPort(workspaceRoot: string, excludePort?: number): Promise<number | undefined> {
    const priorityPorts = getProjectBackendPortHints(workspaceRoot);
    const portsToScan = [...new Set([...priorityPorts, ...COMMON_BACKEND_PORTS])];

    for (const port of portsToScan) {
        if (port === excludePort) { continue; }
        if (await isPortListening(port)) {
            return port;
        }
    }

    return undefined;
}

function shouldProxyToBackend(requestPath: string): boolean {
    if (!currentBackendPort) {
        return false;
    }

    if (currentProxyMode === 'fullStackProxy') {
        return true;
    }

    if (currentProxyMode === 'staticProxy') {
        return requestPath.startsWith(currentApiPrefix);
    }

    return false;
}

function shouldProxyWebSocketToBackend(requestPath: string): boolean {
    if (shouldProxyToBackend(requestPath)) {
        return true;
    }

    if (
        currentProxyMode === 'staticProxy'
        && requestPath === '/'
        && currentLaunchTarget
        && getProjectBackendPortHints(currentLaunchTarget.workspaceRoot).length > 0
    ) {
        return true;
    }

    return false;
}

function attachBackendProxy(backendPort: number, mode: 'staticProxy' | 'fullStackProxy'): void {
    currentBackendPort = backendPort;
    currentProxyMode = mode;

    if (currentServerPort) {
        updateStatusBar(currentServerPort);
    }
}

async function tryAutoAttachBackend(workspaceRoot: string, liveServerPort: number): Promise<number | undefined> {
    const config = vscode.workspace.getConfiguration('hunters-live-server');
    const configured = config.get<number>('backendPort', 0);

    if (configured > 0) {
        if (configured !== liveServerPort && await isPortListening(configured)) {
            attachBackendProxy(configured, 'staticProxy');
            return configured;
        }

        return undefined;
    }

    const detected = await detectBackendPort(workspaceRoot, liveServerPort);
    if (detected) {
        attachBackendProxy(detected, 'staticProxy');
        return detected;
    }

    return undefined;
}

function stopBackendWatcher(): void {
    if (backendWatchInterval) {
        clearInterval(backendWatchInterval);
        backendWatchInterval = undefined;
    }
}

function startBackendWatcher(workspaceRoot: string, liveServerPort: number): void {
    stopBackendWatcher();

    backendWatchInterval = setInterval(() => {
        if (currentBackendPort || !server) {
            return;
        }

        void (async () => {
            const detected = await tryAutoAttachBackend(workspaceRoot, liveServerPort);
            if (detected) {
                stopBackendWatcher();
                vscode.window.showInformationMessage(
                    `Hunters detected backend on port ${detected}. API requests under ${currentApiPrefix} are now proxied.`
                );
            }
        })();
    }, BACKEND_WATCH_INTERVAL_MS);
}

function routeHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');

    if (currentBackendPort && shouldProxyToBackend(requestUrl.pathname)) {
        proxyRequest(req, res, currentBackendPort);
        return;
    }

    if (!currentLaunchTarget) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Hunters Live Server is not configured.');
        return;
    }

    handleRequest(req, res, currentLaunchTarget);
}

function proxyWebSocketUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, targetPort: number): void {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const blockedHeaders = new Set(['host']);
    const proxySocket = net.connect(targetPort, '127.0.0.1', () => {
        const headerLines = [`${req.method} ${requestUrl.pathname}${requestUrl.search} HTTP/1.1`];

        for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined || blockedHeaders.has(key.toLowerCase())) {
                continue;
            }

            if (Array.isArray(value)) {
                for (const entry of value) {
                    headerLines.push(`${key}: ${entry}`);
                }
            } else {
                headerLines.push(`${key}: ${value}`);
            }
        }

        headerLines.push(`Host: 127.0.0.1:${targetPort}`);
        proxySocket.write(`${headerLines.join('\r\n')}\r\n\r\n`);

        if (head.length > 0) {
            proxySocket.write(head);
        }

        socket.pipe(proxySocket);
        proxySocket.pipe(socket);
    });

    proxySocket.on('error', () => {
        socket.destroy();
    });

    socket.on('error', () => {
        proxySocket.destroy();
    });
}

function createLiveHttpServer(): http.Server {
    const liveServer = http.createServer((req, res) => {
        routeHttpRequest(req, res);
    });

    const reloadWss = new WebSocketServer({ noServer: true });
    wss = reloadWss;

    liveServer.on('upgrade', (req, socket, head) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');

        if (currentBackendPort && shouldProxyWebSocketToBackend(requestUrl.pathname)) {
            proxyWebSocketUpgrade(req, socket, head, currentBackendPort);
            return;
        }

        reloadWss.handleUpgrade(req, socket, head, (client) => {
            reloadWss.emit('connection', client, req);
        });
    });

    return liveServer;
}

async function resolveBackendPort(workspaceRoot: string, excludePort?: number): Promise<number | undefined> {
    const config = vscode.workspace.getConfiguration('hunters-live-server');
    const configured = config.get<number>('backendPort', 0);

    if (configured > 0) {
        return configured;
    }

    const detected = await detectBackendPort(workspaceRoot, excludePort);
    if (detected) {
        return detected;
    }

    const input = await vscode.window.showInputBox({
        prompt: 'Enter backend server port (e.g. 3000, 5000, 8080)',
        placeHolder: '5000',
        validateInput: (value) => {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1 || n > 65535) {
                return 'Enter a valid port number (1–65535)';
            }
            return undefined;
        },
    });

    return input ? Number(input) : undefined;
}

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, targetPort: number): void {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${targetPort}` };

    const proxyReq = http.request(
        {
            hostname: '127.0.0.1',
            port: targetPort,
            path: `${requestUrl.pathname}${requestUrl.search}`,
            method: req.method,
            headers,
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
        }
    );

    proxyReq.on('error', (error) => {
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
        }
        res.end(`Backend proxy error: ${error.message}`);
    });

    req.pipe(proxyReq);
}

function isInsideWorkspace(workspaceRoot: string, filePath: string): boolean {
    const relativePath = path.relative(workspaceRoot, filePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function toUrlPath(workspaceRoot: string, filePath: string): string {
    const relativePath = path.relative(workspaceRoot, filePath);

    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return '/';
    }

    return `/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function getLaunchTarget(uri?: vscode.Uri): LaunchTarget | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activeFilePath = activeUri?.scheme === 'file' ? activeUri.fsPath : undefined;
    const isActiveHtml = activeFilePath ? ['.html', '.htm'].includes(path.extname(activeFilePath).toLowerCase()) : false;
    const selectedUri = uri ?? (isActiveHtml ? activeUri : undefined);

    if (selectedUri?.scheme === 'file') {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(selectedUri);
        const workspaceRoot = workspaceFolder?.uri.fsPath ?? path.dirname(selectedUri.fsPath);

        return {
            workspaceRoot,
            defaultFile: selectedUri.fsPath,
        };
    }

    const firstWorkspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!firstWorkspaceFolder) {
        return undefined;
    }

    const workspaceRoot = firstWorkspaceFolder.uri.fsPath;
    return {
        workspaceRoot,
        defaultFile: path.join(workspaceRoot, 'index.html'),
    };
}

function getRequestFilePath(req: http.IncomingMessage, target: LaunchTarget): string | undefined {
    let requestPath = '/';

    try {
        requestPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
        return undefined;
    }

    const requestedRelativePath = requestPath.replace(/^\/+/, '');
    let filePath = requestedRelativePath
        ? path.resolve(target.workspaceRoot, requestedRelativePath)
        : target.defaultFile;

    if (!isInsideWorkspace(target.workspaceRoot, filePath)) {
        return undefined;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    return filePath;
}

function getBackendPortsForShim(): number[] {
    const ports = [...COMMON_BACKEND_PORTS];

    if (currentBackendPort && !ports.includes(currentBackendPort)) {
        ports.unshift(currentBackendPort);
    }

    if (currentServerPort && !ports.includes(currentServerPort)) {
        ports.push(currentServerPort);
    }

    return ports;
}

function buildHuntersBackendShimScript(): string {
    const apiPrefix = JSON.stringify(currentApiPrefix);
    const backendPorts = JSON.stringify(getBackendPortsForShim());

    return [
        '<script data-hunters-backend-shim>',
        '(function(){',
        `var API=${apiPrefix};`,
        `var PORTS=${backendPorts};`,
        'function tunnelPrefix(){var m=location.pathname.match(/^\\/s\\/[^/]+/);return m?m[0]:"";}',
        'function isBackendHost(h){return h==="localhost"||h==="127.0.0.1"||h==="[::1]";}',
        'function isBackendPort(p){return PORTS.indexOf(Number(p))>=0;}',
        'function toApiPath(path){if(!path||path==="/"){return API;}return path.startsWith(API)?path:API+(path.startsWith("/")?path:"/"+path);}',
        'function tunnelPath(path){var P=tunnelPrefix();return P?P+path:path;}',
        'function rewriteUrl(url){',
        'if(typeof url!=="string"){return url;}',
        'try{',
        'var parsed=new URL(url,location.href);',
        'var port=Number(parsed.port||(parsed.protocol==="https:"||parsed.protocol==="wss:"?443:80));',
        'if(isBackendHost(parsed.hostname)&&isBackendPort(port)){',
        'return tunnelPath(toApiPath(parsed.pathname))+parsed.search+parsed.hash;',
        '}',
        'var prefix=tunnelPrefix();',
        'if(prefix){',
        'if(parsed.origin===location.origin&&!parsed.pathname.startsWith(prefix)){',
        'parsed.pathname=prefix+(parsed.pathname==="/"?"/":parsed.pathname);',
        'return parsed.toString();',
        '}',
        'if((parsed.protocol==="ws:"||parsed.protocol==="wss:")&&(parsed.pathname==="/"||parsed.pathname==="")){',
        'return (location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+prefix+"/";',
        '}',
        '}',
        '}catch(error){',
        'if(url.charAt(0)==="/"&&url.charAt(1)!=="/"){',
        'var tunnel=tunnelPrefix();',
        'if(tunnel&&!url.startsWith(tunnel)){return tunnel+url;}',
        '}',
        '}',
        'return url;',
        '}',
        'var nativeFetch=window.fetch;',
        'window.fetch=function(input,init){',
        'if(typeof input==="string"){input=rewriteUrl(input);}',
        'else if(input&&typeof input==="object"&&"url" in input){input=new Request(rewriteUrl(String(input.url)),input);}',
        'return nativeFetch.call(this,input,init);',
        '};',
        'var nativeOpen=XMLHttpRequest.prototype.open;',
        'XMLHttpRequest.prototype.open=function(method,url){arguments[1]=rewriteUrl(url);return nativeOpen.apply(this,arguments);};',
        'var NativeWebSocket=window.WebSocket;',
        'window.WebSocket=function(url,protocols){return new NativeWebSocket(rewriteUrl(url),protocols);};',
        '})();',
        '</script>',
    ].join('');
}

function injectBackendShim(htmlString: string): string {
    const shim = buildHuntersBackendShimScript();

    if (/<head[^>]*>/i.test(htmlString)) {
        return htmlString.replace(/<head[^>]*>/i, (match) => `${match}\n${shim}`);
    }

    if (/<html[^>]*>/i.test(htmlString)) {
        return htmlString.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${shim}</head>`);
    }

    return `${shim}\n${htmlString}`;
}

function rewriteServedJavaScript(source: string): string {
    let rewritten = source;

    for (const port of getBackendPortsForShim()) {
        const portPattern = `(?:localhost|127\\.0\\.0\\.1):${port}`;

        rewritten = rewritten
            .replace(
                new RegExp(`(["'\`])https?:\\/\\/${portPattern}(\\/[^"'\`]*)?\\1`, 'gi'),
                (_match, quote: string, requestPath = '') => {
                    const normalizedPath = requestPath || '/';
                    const apiPath = normalizedPath.startsWith(currentApiPrefix)
                        ? normalizedPath
                        : `${currentApiPrefix}${normalizedPath === '/' ? '' : normalizedPath}`;

                    return `${quote}${apiPath}${quote}`;
                }
            )
            .replace(
                new RegExp(`(["'\`])wss?:\\/\\/${portPattern}(\\/[^"'\`]*)?\\1`, 'gi'),
                (_match, quote: string, requestPath = '') => {
                    const normalizedPath = requestPath || '/';
                    const apiPath = normalizedPath.startsWith(currentApiPrefix)
                        ? normalizedPath
                        : `${currentApiPrefix}${normalizedPath === '/' ? '' : normalizedPath}`;

                    return `${quote}${apiPath}${quote}`;
                }
            );
    }

    rewritten = rewritten.replace(
        /new\s+WebSocket\s*\(\s*(["'])(wss?:\/\/[^/"']+)\1/gi,
        (match, quote: string, url: string) => {
            try {
                const parsed = new URL(url);

                if (parsed.pathname === '/' || parsed.pathname === '') {
                    return `new WebSocket(${quote}${currentApiPrefix || '/'}${quote}`;
                }
            } catch {
                return match;
            }

            return match;
        }
    );

    return rewritten;
}

function prepareHtmlForServe(htmlString: string): string {
    return injectReloadScript(injectBackendShim(htmlString));
}

function injectReloadScript(htmlString: string): string {
    const injectedScript = `
<script data-hunters-live-reload>
(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const socket = new WebSocket(protocol + window.location.host + window.location.pathname);

    socket.addEventListener('message', (event) => {
        if (event.data === 'reload') {
            window.location.reload();
        }
    });
})();
</script>`;

    if (htmlString.match(/<\/body>/i)) {
        return htmlString.replace(/<\/body>/i, `${injectedScript}</body>`);
    }

    return `${htmlString}${injectedScript}`;
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, target: LaunchTarget): void {
    const filePath = getRequestFilePath(req, target);

    if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`404 Not Found: ${path.relative(target.workspaceRoot, filePath)}`);
            return;
        }

        fs.readFile(filePath, (error, content) => {
            if (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Server Error: ${error.message}`);
                return;
            }

            const contentType = getMimeType(filePath);
            res.writeHead(200, { 'Content-Type': contentType });

            if (contentType === 'text/html') {
                res.end(prepareHtmlForServe(content.toString('utf-8')), 'utf-8');
                return;
            }

            if (contentType === 'text/javascript' || contentType === 'application/javascript') {
                res.end(rewriteServedJavaScript(content.toString('utf-8')), 'utf-8');
                return;
            }

            res.end(content);
        });
    });
}

function listen(serverToStart: http.Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
            serverToStart.off('listening', onListening);
            reject(error);
        };

        const onListening = () => {
            serverToStart.off('error', onError);
            resolve(port);
        };

        serverToStart.once('error', onError);
        serverToStart.once('listening', onListening);
        serverToStart.listen(port, host);
    });
}

async function listenOnAvailablePort(serverToStart: http.Server): Promise<number> {
    for (let port = preferredPort; port <= lastPortToTry; port += 1) {
        try {
            return await listen(serverToStart, port);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
                throw error;
            }
        }
    }

    throw new Error(`No available ports found between ${preferredPort} and ${lastPortToTry}.`);
}

function broadcastReload(): void {
    if (!wss) {
        return;
    }

    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send('reload');
        }
    });
}

async function openCurrentServer(): Promise<void> {
    if (currentShareUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(currentShareUrl));
        return;
    }

    if (currentRelayFailureMessage) {
        const choice = await vscode.window.showWarningMessage(
            currentRelayFailureMessage,
            'Open Local'
        );

        if (choice === 'Open Local') {
            await openLocalServer();
        }

        return;
    }

    const urlToOpen = currentServerUrl;

    if (!urlToOpen) {
        await startServer();
        return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(urlToOpen));
}

async function openLocalServer(): Promise<void> {
    if (!currentServerUrl) {
        await startLocalServer();
        return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(currentServerUrl));
}

async function copyShareUrl(): Promise<void> {
    if (!currentShareUrl) {
        vscode.window.showWarningMessage('Hunters Live Server is not shared through the VPS relay.');
        return;
    }

    await vscode.env.clipboard.writeText(currentShareUrl);
    vscode.window.showInformationMessage('Hunters share URL copied.');
}

function setShareUrl(shareUrl: string | undefined): void {
    currentShareUrl = shareUrl;
    currentViewerCount = 0;
    if (shareUrl) {
        currentRelayFailureMessage = undefined;
    }
    void vscode.commands.executeCommand('setContext', isSharedContextKey, Boolean(shareUrl));

    if (currentServerPort) {
        updateStatusBar(currentServerPort);
    }
}

function updateViewerCount(count: number): void {
    currentViewerCount = count;

    if (currentServerPort) {
        updateStatusBar(currentServerPort);
    }
}

function clearRelayReconnect(): void {
    if (relayReconnectTimer) {
        clearTimeout(relayReconnectTimer);
        relayReconnectTimer = undefined;
    }

    relayReconnectAttempt = 0;
}

function scheduleRelayReconnect(): void {
    if (!server || !currentServerPort || !currentRelayFilePath || !getConfiguredRelayUrl()) {
        return;
    }

    if (relayTunnel || relayReconnectTimer) {
        return;
    }

    const delay = Math.min(maxRelayReconnectDelayMs, 2000 * Math.pow(1.5, relayReconnectAttempt));
    relayReconnectAttempt += 1;

    relayReconnectTimer = setTimeout(() => {
        relayReconnectTimer = undefined;
        void attemptRelayReconnect();
    }, delay);
}

async function attemptRelayReconnect(): Promise<void> {
    if (!server || !currentServerPort || !currentRelayFilePath) {
        return;
    }

    if (relayTunnel) {
        clearRelayReconnect();
        return;
    }

    const relayResult = await startConfiguredRelayTunnel(currentServerPort, currentRelayFilePath);

    if (relayResult.shareUrl) {
        clearRelayReconnect();
        updateStatusBar(currentServerPort);
        vscode.window.showInformationMessage(
            `Hunters share tunnel reconnected at ${relayResult.shareUrl}`,
            'Open Share URL',
            'Copy Share URL'
        ).then((choice) => {
            if (choice === 'Open Share URL') {
                void openCurrentServer();
            } else if (choice === 'Copy Share URL') {
                void copyShareUrl();
            }
        });
        return;
    }

    if (server) {
        scheduleRelayReconnect();
    }
}

async function startConfiguredRelayTunnel(port: number, selectedFilePath: string): Promise<RelayStartResult> {
    const configuration = vscode.workspace.getConfiguration('hunters-live-server');
    const configuredRelayUrl = getConfiguredRelayUrl();

    if (!configuredRelayUrl) {
        currentRelayFailureMessage = undefined;
        return { configured: false };
    }

    let relayUrl: string;
    try {
        relayUrl = normalizeRelayUrl(configuredRelayUrl);
    } catch (error) {
        const failureMessage = `Hunters relay URL is invalid: ${(error as Error).message}`;
        currentRelayFailureMessage = failureMessage;
        vscode.window.showWarningMessage(failureMessage);
        return { configured: true, failureMessage };
    }

    relayTunnel?.dispose();
    currentRelayFailureMessage = undefined;
    setShareUrl(undefined);
    currentRelayFilePath = selectedFilePath;

    const tunnel = new RelayTunnel({
        relayUrl,
        relayToken: configuration.get<string>('relayToken', '').trim(),
        localPort: port,
        onViewerCount: updateViewerCount,
        onClose: () => {
            if (relayTunnel !== tunnel) {
                return;
            }

            relayTunnel = undefined;
            currentRelayFailureMessage = 'Hunters VPS share tunnel disconnected. Reconnecting…';
            setShareUrl(undefined);

            if (currentServerPort) {
                updateStatusBar(currentServerPort);
            }

            if (server) {
                vscode.window.showWarningMessage(
                    'Hunters VPS share tunnel disconnected. Local live server is still running. Reconnecting…',
                    'Open Local'
                ).then((choice) => {
                    if (choice === 'Open Local') {
                        void openLocalServer();
                    }
                });
                scheduleRelayReconnect();
            }
        },
    });

    relayTunnel = tunnel;

    try {
        const shareUrl = getShareUrlForPath(await tunnel.connect(), selectedFilePath);
        setShareUrl(shareUrl);
        clearRelayReconnect();
        return { configured: true, shareUrl };
    } catch (error) {
        if (relayTunnel === tunnel) {
            relayTunnel = undefined;
        }

        setShareUrl(undefined);
        const relayError = error as Error;
        const failureMessage = formatRelayTunnelError(relayError);
        currentRelayFailureMessage = failureMessage;
        vscode.window.showWarningMessage(failureMessage);
        return { configured: true, failureMessage };
    }
}

function updateStatusBar(port: number): void {
    if (!statusBarItem) {
        return;
    }

    const proxyLabel = currentProxyMode === 'fullStackProxy'
        ? ` \u2192 :${currentBackendPort}`
        : currentProxyMode === 'staticProxy'
            ? ` \u2192api:${currentBackendPort}`
            : '';

    if (currentShareUrl) {
        statusBarItem.text = `$(radio-tower) Hunters:${port}${proxyLabel} $(link)`;
        statusBarItem.tooltip = `Local: ${currentServerUrl}\nShare: ${currentShareUrl}\nViewers: ${currentViewerCount}${currentBackendPort ? `\nBackend: localhost:${currentBackendPort}` : ''}`;
    } else if (currentRelayFailureMessage) {
        statusBarItem.text = `$(warning) Hunters:${port}${proxyLabel}`;
        statusBarItem.tooltip = `${currentRelayFailureMessage}\nLocal: ${currentServerUrl}`;
    } else {
        statusBarItem.text = `$(radio-tower) Hunters:${port}${proxyLabel}`;
        statusBarItem.tooltip = `Open current Hunters Live Server page${currentBackendPort ? `\nBackend: localhost:${currentBackendPort}` : ''}`;
    }

    statusBarItem.command = 'hunters-live-server.open';
    statusBarItem.show();
}

function updateIdleStatusBar(): void {
    if (!statusBarItem) {
        return;
    }

    statusBarItem.text = '$(globe) Hunters Live';
    statusBarItem.tooltip = 'Start Hunters Live Server';
    statusBarItem.command = 'hunters-live-server.start';
    statusBarItem.show();
}

function stopServer(showMessage = true): void {
    clearRelayReconnect();
    stopBackendWatcher();
    saveListener?.dispose();
    saveListener = undefined;

    relayTunnel?.dispose();
    relayTunnel = undefined;
    setShareUrl(undefined);

    wss?.close();
    wss = undefined;

    if (server) {
        try {
            server.close();
        } catch {
            // The server may already be closed after a startup failure.
        }
    }
    server = undefined;

    currentServerUrl = undefined;
    currentServerPort = undefined;
    currentRelayFailureMessage = undefined;
    currentProxyMode = 'static';
    currentBackendPort = undefined;
    currentLaunchTarget = undefined;
    currentRelayFilePath = undefined;
    void vscode.commands.executeCommand('setContext', isRunningContextKey, false);
    void vscode.commands.executeCommand('setContext', isSharedContextKey, false);
    updateIdleStatusBar();

    if (showMessage) {
        vscode.window.showInformationMessage('Hunters Live Server stopped.');
    }
}

async function startServer(uri?: vscode.Uri): Promise<void> {
    if (server) {
        const choice = await vscode.window.showInformationMessage(
            'Hunters Live Server is already running.',
            'Open',
            'Stop'
        );

        if (choice === 'Open') {
            await openCurrentServer();
        } else if (choice === 'Stop') {
            stopServer();
        }

        return;
    }

    const target = getLaunchTarget(uri);
    if (!target) {
        vscode.window.showErrorMessage('Open a folder or an HTML file before starting Hunters Live Server.');
        return;
    }

    if (!fs.existsSync(target.defaultFile)) {
        vscode.window.showErrorMessage(`Could not find ${path.basename(target.defaultFile)}. Open or right-click an HTML file first.`);
        return;
    }

    currentLaunchTarget = target;
    currentProxyMode = 'static';
    currentBackendPort = undefined;
    currentApiPrefix = vscode.workspace.getConfiguration('hunters-live-server').get<string>('apiPrefix', '/api');

    server = createLiveHttpServer();
    saveListener = vscode.workspace.onDidSaveTextDocument(() => {
        broadcastReload();
        relayTunnel?.sendReload();
    });

    try {
        const port = await listenOnAvailablePort(server);
        const selectedFilePath = toUrlPath(target.workspaceRoot, target.defaultFile);
        const localUrl = `http://127.0.0.1:${port}${selectedFilePath}`;
        const lanUrl = `http://${getNetworkIP()}:${port}${selectedFilePath}`;

        currentServerUrl = localUrl;
        currentServerPort = port;
        void vscode.commands.executeCommand('setContext', isRunningContextKey, true);

        const attachedBackend = await tryAutoAttachBackend(target.workspaceRoot, port);
        startBackendWatcher(target.workspaceRoot, port);

        const relayResult = await startConfiguredRelayTunnel(port, selectedFilePath);
        updateStatusBar(port);

        if (relayResult.shareUrl || !relayResult.configured) {
            await openCurrentServer();
        }

        const stat = fs.statSync(target.defaultFile);
        if (stat.size === 0) {
            vscode.window.showWarningMessage(`${path.basename(target.defaultFile)} is empty, so the browser page will be blank until you add HTML.`);
        }

        const backendNote = attachedBackend
            ? ` Backend :${attachedBackend} proxied at ${currentApiPrefix}.`
            : ' Watching for a backend server…';

        const actions = relayResult.shareUrl
            ? ['Copy Share URL', 'Open Local', 'Stop']
            : relayResult.configured
                ? ['Open Local', 'Stop']
            : ['Open', 'Stop'];

        vscode.window.showInformationMessage(
            relayResult.shareUrl
                ? `Hunters Live Server shared at ${relayResult.shareUrl}.${backendNote}`
                : relayResult.configured
                    ? `Hunters VPS share tunnel did not start. Local server is running at ${lanUrl}.${backendNote}`
                : `Hunters Live Server running at ${lanUrl}.${backendNote}`,
            ...actions
        ).then((choice) => {
            if (choice === 'Copy Share URL') {
                copyShareUrl();
            } else if (choice === 'Open') {
                openCurrentServer();
            } else if (choice === 'Open Local') {
                openLocalServer();
            } else if (choice === 'Stop') {
                stopServer();
            }
        });
    } catch (error) {
        stopServer(false);
        vscode.window.showErrorMessage(`Hunters Live Server failed to start: ${(error as Error).message}`);
    }
}

/**
 * Start local-only live server (no VPS relay connection).
 * This avoids draining the VPS and keeps everything on the local machine.
 */
async function startLocalServer(uri?: vscode.Uri): Promise<void> {
    if (server) {
        const choice = await vscode.window.showInformationMessage(
            'Hunters Live Server is already running.',
            'Open Local',
            'Stop'
        );

        if (choice === 'Open Local') {
            await openLocalServer();
        } else if (choice === 'Stop') {
            stopServer();
        }

        return;
    }

    const target = getLaunchTarget(uri);
    if (!target) {
        vscode.window.showErrorMessage('Open a folder or an HTML file before starting Hunters Live Server.');
        return;
    }

    if (!fs.existsSync(target.defaultFile)) {
        vscode.window.showErrorMessage(`Could not find ${path.basename(target.defaultFile)}. Open or right-click an HTML file first.`);
        return;
    }

    currentLaunchTarget = target;
    currentProxyMode = 'static';
    currentBackendPort = undefined;
    currentApiPrefix = vscode.workspace.getConfiguration('hunters-live-server').get<string>('apiPrefix', '/api');

    server = createLiveHttpServer();
    saveListener = vscode.workspace.onDidSaveTextDocument(() => {
        broadcastReload();
    });

    try {
        const port = await listenOnAvailablePort(server);
        const selectedFilePath = toUrlPath(target.workspaceRoot, target.defaultFile);
        const localUrl = `http://127.0.0.1:${port}${selectedFilePath}`;
        const lanUrl = `http://${getNetworkIP()}:${port}${selectedFilePath}`;

        currentServerUrl = localUrl;
        currentServerPort = port;
        void vscode.commands.executeCommand('setContext', isRunningContextKey, true);

        const attachedBackend = await tryAutoAttachBackend(target.workspaceRoot, port);
        startBackendWatcher(target.workspaceRoot, port);
        updateStatusBar(port);

        await vscode.env.openExternal(vscode.Uri.parse(localUrl));

        const stat = fs.statSync(target.defaultFile);
        if (stat.size === 0) {
            vscode.window.showWarningMessage(`${path.basename(target.defaultFile)} is empty, so the browser page will be blank until you add HTML.`);
        }

        const backendNote = attachedBackend
            ? ` Backend :${attachedBackend} proxied at ${currentApiPrefix}.`
            : ' Watching for a backend server…';

        vscode.window.showInformationMessage(
            `Hunters Local Live Server running at ${lanUrl}.${backendNote}`,
            'Open',
            'Stop'
        ).then((choice) => {
            if (choice === 'Open') {
                openLocalServer();
            } else if (choice === 'Stop') {
                stopServer();
            }
        });
    } catch (error) {
        stopServer(false);
        vscode.window.showErrorMessage(`Hunters Live Server failed to start: ${(error as Error).message}`);
    }
}

/**
 * Start live server and connect to VPS relay for global sharing.
 */
async function startGlobalServer(uri?: vscode.Uri): Promise<void> {
    if (server) {
        const choice = await vscode.window.showInformationMessage(
            'Hunters Live Server is already running.',
            'Open',
            'Stop'
        );

        if (choice === 'Open') {
            await openCurrentServer();
        } else if (choice === 'Stop') {
            stopServer();
        }

        return;
    }

    const target = getLaunchTarget(uri);
    if (!target) {
        vscode.window.showErrorMessage('Open a folder or an HTML file before starting Hunters Live Server.');
        return;
    }

    if (!fs.existsSync(target.defaultFile)) {
        vscode.window.showErrorMessage(`Could not find ${path.basename(target.defaultFile)}. Open or right-click an HTML file first.`);
        return;
    }

    currentLaunchTarget = target;
    currentProxyMode = 'static';
    currentBackendPort = undefined;
    currentApiPrefix = vscode.workspace.getConfiguration('hunters-live-server').get<string>('apiPrefix', '/api');

    server = createLiveHttpServer();
    saveListener = vscode.workspace.onDidSaveTextDocument(() => {
        broadcastReload();
        relayTunnel?.sendReload();
    });

    try {
        const port = await listenOnAvailablePort(server);
        const selectedFilePath = toUrlPath(target.workspaceRoot, target.defaultFile);
        const localUrl = `http://127.0.0.1:${port}${selectedFilePath}`;
        const lanUrl = `http://${getNetworkIP()}:${port}${selectedFilePath}`;

        currentServerUrl = localUrl;
        currentServerPort = port;
        void vscode.commands.executeCommand('setContext', isRunningContextKey, true);

        const attachedBackend = await tryAutoAttachBackend(target.workspaceRoot, port);
        startBackendWatcher(target.workspaceRoot, port);

        const relayResult = await startConfiguredRelayTunnel(port, selectedFilePath);
        updateStatusBar(port);

        if (relayResult.shareUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(relayResult.shareUrl));
        } else {
            await vscode.env.openExternal(vscode.Uri.parse(localUrl));
        }

        const stat = fs.statSync(target.defaultFile);
        if (stat.size === 0) {
            vscode.window.showWarningMessage(`${path.basename(target.defaultFile)} is empty, so the browser page will be blank until you add HTML.`);
        }

        const backendNote = attachedBackend
            ? ` Backend :${attachedBackend} proxied at ${currentApiPrefix}.`
            : ' Watching for a backend server…';

        const actions = relayResult.shareUrl
            ? ['Copy Share URL', 'Open Local', 'Stop']
            : ['Open Local', 'Stop'];

        vscode.window.showInformationMessage(
            relayResult.shareUrl
                ? `Hunters Global Live Server shared at ${relayResult.shareUrl}.${backendNote}`
                : `Hunters VPS share tunnel did not start. Local server is running at ${lanUrl}.${backendNote}`,
            ...actions
        ).then((choice) => {
            if (choice === 'Copy Share URL') {
                copyShareUrl();
            } else if (choice === 'Open Local') {
                openLocalServer();
            } else if (choice === 'Stop') {
                stopServer();
            }
        });
    } catch (error) {
        stopServer(false);
        vscode.window.showErrorMessage(`Hunters Live Server failed to start: ${(error as Error).message}`);
    }
}

/**
 * Start static file server with reverse-proxy for API routes.
 * Requests matching the configured apiPrefix (default /api) are forwarded
 * to the backend port; everything else is served from the workspace.
 */
async function startStaticProxyServer(uri?: vscode.Uri): Promise<void> {
    if (server) {
        const choice = await vscode.window.showInformationMessage(
            'Hunters Live Server is already running.',
            'Open',
            'Stop'
        );

        if (choice === 'Open') { await openCurrentServer(); }
        else if (choice === 'Stop') { stopServer(); }
        return;
    }

    const target = getLaunchTarget(uri);
    if (!target) {
        vscode.window.showErrorMessage('Open a folder or an HTML file before starting Hunters Live Server.');
        return;
    }

    if (!fs.existsSync(target.defaultFile)) {
        vscode.window.showErrorMessage(`Could not find ${path.basename(target.defaultFile)}. Open or right-click an HTML file first.`);
        return;
    }

    const backendPort = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scanning for backend server\u2026' },
        () => resolveBackendPort(target.workspaceRoot)
    );

    if (!backendPort) {
        vscode.window.showWarningMessage('No backend port selected. Start cancelled.');
        return;
    }

    const config = vscode.workspace.getConfiguration('hunters-live-server');
    const apiPrefix = config.get<string>('apiPrefix', '/api');

    currentLaunchTarget = target;
    currentApiPrefix = apiPrefix;
    attachBackendProxy(backendPort, 'staticProxy');

    server = createLiveHttpServer();
    saveListener = vscode.workspace.onDidSaveTextDocument(() => {
        broadcastReload();
        relayTunnel?.sendReload();
    });

    try {
        const port = await listenOnAvailablePort(server);
        const selectedFilePath = toUrlPath(target.workspaceRoot, target.defaultFile);
        const localUrl = `http://127.0.0.1:${port}${selectedFilePath}`;
        const lanUrl = `http://${getNetworkIP()}:${port}${selectedFilePath}`;

        currentServerUrl = localUrl;
        currentServerPort = port;
        void vscode.commands.executeCommand('setContext', isRunningContextKey, true);
        const relayResult = await startConfiguredRelayTunnel(port, selectedFilePath);
        updateStatusBar(port);

        if (relayResult.shareUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(relayResult.shareUrl));
        } else {
            await vscode.env.openExternal(vscode.Uri.parse(localUrl));
        }

        const actions = relayResult.shareUrl
            ? ['Copy Share URL', 'Open Local', 'Stop']
            : ['Open Local', 'Stop'];

        vscode.window.showInformationMessage(
            `Hunters Static + Proxy: ${apiPrefix} \u2192 localhost:${backendPort}` +
            (relayResult.shareUrl ? ` | Shared at ${relayResult.shareUrl}` : ` | ${lanUrl}`),
            ...actions
        ).then((choice) => {
            if (choice === 'Copy Share URL') { void copyShareUrl(); }
            else if (choice === 'Open Local') { void openLocalServer(); }
            else if (choice === 'Stop') { stopServer(); }
        });
    } catch (error) {
        stopServer(false);
        vscode.window.showErrorMessage(`Hunters Live Server failed to start: ${(error as Error).message}`);
    }
}

/**
 * Start full-stack proxy server.
 * ALL requests are forwarded to the local framework dev server (e.g. Next.js
 * on port 3000). The extension server acts purely as a reverse-proxy so the
 * relay tunnel can expose the entire app through one public URL.
 */
async function startFullStackProxyServer(): Promise<void> {
    if (server) {
        const choice = await vscode.window.showInformationMessage(
            'Hunters Live Server is already running.',
            'Open',
            'Stop'
        );

        if (choice === 'Open') { await openCurrentServer(); }
        else if (choice === 'Stop') { stopServer(); }
        return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Open a folder before starting Hunters Full-Stack Proxy.');
        return;
    }

    const backendPort = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scanning for framework dev server\u2026' },
        () => resolveBackendPort(workspaceRoot)
    );

    if (!backendPort) {
        vscode.window.showWarningMessage('No backend port selected. Start cancelled.');
        return;
    }

    currentLaunchTarget = {
        workspaceRoot,
        defaultFile: path.join(workspaceRoot, 'index.html'),
    };
    attachBackendProxy(backendPort, 'fullStackProxy');

    server = createLiveHttpServer();

    try {
        const port = await listenOnAvailablePort(server);
        const localUrl = `http://127.0.0.1:${port}/`;
        const lanUrl = `http://${getNetworkIP()}:${port}/`;

        currentServerUrl = localUrl;
        currentServerPort = port;
        void vscode.commands.executeCommand('setContext', isRunningContextKey, true);
        const relayResult = await startConfiguredRelayTunnel(port, '/');
        updateStatusBar(port);

        if (relayResult.shareUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(relayResult.shareUrl));
        } else {
            await vscode.env.openExternal(vscode.Uri.parse(localUrl));
        }

        const actions = relayResult.shareUrl
            ? ['Copy Share URL', 'Open Local', 'Stop']
            : ['Open Local', 'Stop'];

        vscode.window.showInformationMessage(
            `Hunters Full-Stack Proxy \u2192 localhost:${backendPort}` +
            (relayResult.shareUrl ? ` | Shared at ${relayResult.shareUrl}` : ` | ${lanUrl}`),
            ...actions
        ).then((choice) => {
            if (choice === 'Copy Share URL') { void copyShareUrl(); }
            else if (choice === 'Open Local') { void openLocalServer(); }
            else if (choice === 'Stop') { stopServer(); }
        });
    } catch (error) {
        stopServer(false);
        vscode.window.showErrorMessage(`Hunters Live Server failed to start: ${(error as Error).message}`);
    }
}

export function activate(context: vscode.ExtensionContext): void {
    console.log('Extension "hunters-live-server" is now active!');

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    void vscode.commands.executeCommand('setContext', isRunningContextKey, false);
    void vscode.commands.executeCommand('setContext', isSharedContextKey, false);
    updateIdleStatusBar();

    context.subscriptions.push(
        vscode.commands.registerCommand('hunters-live-server.start', startServer),
        vscode.commands.registerCommand('hunters-live-server.startLocal', startLocalServer),
        vscode.commands.registerCommand('hunters-live-server.startGlobal', startGlobalServer),
        vscode.commands.registerCommand('hunters-live-server.startStaticProxy', startStaticProxyServer),
        vscode.commands.registerCommand('hunters-live-server.startFullStackProxy', startFullStackProxyServer),
        vscode.commands.registerCommand('hunters-live-server.stop', () => stopServer()),
        vscode.commands.registerCommand('hunters-live-server.open', openCurrentServer),
        vscode.commands.registerCommand('hunters-live-server.openLocal', openLocalServer),
        vscode.commands.registerCommand('hunters-live-server.copyShareUrl', copyShareUrl),
        statusBarItem
    );
}

export function deactivate(): void {
    stopServer(false);
    console.log('Hunters Live Server shut down.');
}
