import { TunnelProvider } from './TunnelProvider.js';
import { spawn } from 'child_process';

export class LocalTunnelProvider extends TunnelProvider {
    constructor() {
        super();
        this.process = null;
    }

    async start(port) {
        return new Promise((resolve, reject) => {
            // Using npx localtunnel
            this.process = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['localtunnel', '--port', port.toString()]);
            
            let url = null;

            this.process.stdout.on('data', (data) => {
                const output = data.toString();
                const match = output.match(/your url is: (https?:\/\/[^\s]+)/i);
                if (match) {
                    url = match[1];
                    resolve(url);
                }
            });

            this.process.stderr.on('data', (data) => {
                // If it fails before resolving
                if (!url) {
                    reject(new Error(data.toString()));
                }
            });

            this.process.on('error', (err) => {
                if (!url) reject(err);
            });
            
            // Timeout just in case
            setTimeout(() => {
                if (!url) reject(new Error('Tunnel creation timed out'));
            }, 15000);
        });
    }

    async stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}
