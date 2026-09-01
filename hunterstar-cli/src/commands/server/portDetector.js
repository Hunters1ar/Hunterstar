export class PortDetector {
    constructor() {
        this.detectedPorts = new Map(); // Map process name to port
        this.portResolvers = new Map(); // Map process name to promise resolvers
    }

    waitForPort(name, timeoutMs = 30000) {
        return new Promise((resolve) => {
            if (this.detectedPorts.has(name)) {
                return resolve(this.detectedPorts.get(name));
            }

            this.portResolvers.set(name, resolve);

            setTimeout(() => {
                if (this.portResolvers.has(name)) {
                    this.portResolvers.delete(name);
                    resolve(null);
                }
            }, timeoutMs);
        });
    }

    feedLog(name, logLine) {
        if (logLine.includes('EADDRINUSE') || logLine.toLowerCase().includes('address already in use')) {
            if (this.portResolvers.has(name)) {
                console.log(`\x1b[31m[${name}] Port collision detected (EADDRINUSE). Try stopping other servers.\x1b[0m`);
                const resolve = this.portResolvers.get(name);
                this.portResolvers.delete(name);
                resolve(null);
            }
            return;
        }

        const portMatch = logLine.match(/(?:http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):|running\s+on\s+port\s+|listening\s+on\s+port\s+)(\d{4,5})/i);
        if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            this.detectedPorts.set(name, port);
            
            if (this.portResolvers.has(name)) {
                const resolve = this.portResolvers.get(name);
                this.portResolvers.delete(name);
                resolve(port);
            }
        }
    }
}
