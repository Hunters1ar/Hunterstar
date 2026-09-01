import http from 'http';
import WebSocket from 'ws';

export class HunterstarProvider {
    constructor(relayUrl = null) {
        this.relayUrl = relayUrl || process.env.HUNTERSTAR_RELAY_URL || 'wss://hunterstaronline.online/tunnel';
        this.ws = null;
        this.publicUrl = null;
        this.localPort = null;
        this.localWsBridges = new Map();
        this.isStopping = false;
    }

    async start(localPort, subdomain = null) {
        this.localPort = localPort;
        return new Promise((resolve, reject) => {
            let connectUrl = this.relayUrl;
            if (subdomain) {
                connectUrl += `?name=${encodeURIComponent(subdomain)}`;
            }
            
            this.ws = new WebSocket(connectUrl, {
                rejectUnauthorized: false
            });

            this.ws.on('open', () => {
                // Connected, wait for session payload
            });

            let isInitialized = false;

            this.ws.on('message', async (data) => {
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                } catch (e) {
                    return;
                }

                if (msg.type === 'error') {
                    reject(new Error(msg.message || 'Tunnel error'));
                    this.stop();
                    return;
                }

                if (msg.type === 'session') {
                    isInitialized = true;
                    this.publicUrl = msg.url;
                    resolve(this.publicUrl);
                }

                if (msg.type === 'request') {
                    await this.handleHttpRequest(msg);
                }

                if (msg.type === 'wsOpen') {
                    await this.handleWsOpen(msg);
                }

                if (msg.type === 'wsFrame') {
                    this.handleWsFrame(msg);
                }

                if (msg.type === 'wsClose') {
                    this.handleWsClose(msg);
                }
            });

            this.ws.on('error', (error) => {
                if (!this.publicUrl) reject(new Error('Hunterstar Tunnel connection failed'));
            });

            this.ws.on('close', () => {
                if (!isInitialized) {
                    reject(new Error('Tunnel closed before initialization. Name might be taken or SSL is invalid.'));
                    this.stop();
                    return;
                }
                if (this.isStopping) return;
                // Auto-reconnect with 3-second delay if not explicitly stopped
                setTimeout(() => {
                    if (!this.isStopping) {
                        this.start(this.localPort, subdomain).catch(() => {});
                    }
                }, 3000);
            });
        });
    }

    async handleHttpRequest(msg) {
        const headers = { ...(msg.headers || {}) };
        delete headers['accept-encoding'];
        delete headers['host'];

        const options = {
            hostname: '127.0.0.1',
            port: this.localPort,
            path: msg.path,
            method: msg.method,
            headers: headers
        };
        
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const bodyBuffer = Buffer.concat(chunks);
                const responseMsg = {
                    type: 'response',
                    id: msg.id,
                    status: res.statusCode,
                    headers: res.headers,
                    bodyBase64: bodyBuffer.toString('base64')
                };
                if (this.ws && this.ws.readyState === 1) {
                    this.ws.send(JSON.stringify(responseMsg));
                }
            });
        });

        req.on('error', (err) => {
            const responseMsg = {
                type: 'response',
                id: msg.id,
                status: 502,
                headers: { 'Content-Type': 'text/plain' },
                bodyBase64: Buffer.from(`Bad Gateway: ${err.message}`).toString('base64')
            };
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify(responseMsg));
            }
        });

        if (msg.bodyBase64) {
            req.write(Buffer.from(msg.bodyBase64, 'base64'));
        }
        req.end();
    }

    async handleWsOpen(msg) {
        const localWsUrl = `ws://127.0.0.1:${this.localPort}${msg.path}`;
        const localWs = new WebSocket(localWsUrl, { rejectUnauthorized: false });
        
        this.localWsBridges.set(msg.id, localWs);

        localWs.on('open', () => {
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({ type: 'wsReady', id: msg.id }));
            }
        });

        localWs.on('message', async (data, isBinary) => {
            if (this.ws && this.ws.readyState === 1) {
                const base64Data = Buffer.from(data).toString('base64');
                this.ws.send(JSON.stringify({
                    type: 'wsFrame',
                    id: msg.id,
                    data: base64Data,
                    binary: isBinary
                }));
            }
        });

        localWs.on('error', () => {
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({ type: 'wsError', id: msg.id }));
            }
        });

        localWs.on('close', (code, reason) => {
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({ type: 'wsClose', id: msg.id, code, reason: reason ? reason.toString() : 'Closed' }));
            }
            this.localWsBridges.delete(msg.id);
        });
    }

    handleWsFrame(msg) {
        const localWs = this.localWsBridges.get(msg.id);
        if (localWs && localWs.readyState === 1) {
            const buf = Buffer.from(msg.data, 'base64');
            localWs.send(msg.binary ? buf : buf.toString('utf8'));
        }
    }

    handleWsClose(msg) {
        const localWs = this.localWsBridges.get(msg.id);
        if (localWs) {
            localWs.close(msg.code || 1000, msg.reason || 'Closed');
            this.localWsBridges.delete(msg.id);
        }
    }

    async stop() {
        this.isStopping = true;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        for (const [id, localWs] of this.localWsBridges) {
            localWs.close();
        }
        this.localWsBridges.clear();
    }
}
