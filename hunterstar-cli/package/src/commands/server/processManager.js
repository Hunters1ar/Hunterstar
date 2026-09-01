import { spawn, exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export async function killProcessTree(pid) {
    if (process.platform === 'win32') {
        try {
            await execPromise(`taskkill /pid ${pid} /T /F`);
        } catch (e) {}
    } else {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch (e) {
            try { process.kill(pid, 'SIGKILL'); } catch (err) {}
        }
    }
}

export class ProcessManager {
    constructor(portDetector) {
        this.processes = [];
        this.onProcessExit = null;
        this.portDetector = portDetector;
    }

    startProcess(name, commandStr, cwd, colorPrefix) {
        return new Promise((resolve, reject) => {
            const proc = spawn(commandStr, [], { 
                cwd, 
                shell: true,
                detached: process.platform !== 'win32',
                windowsHide: true
            });
            
            this.processes.push({ name, proc });

            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        if (this.portDetector) this.portDetector.feedLog(name, line);
                        console.log(`${colorPrefix}[${name}]\x1b[0m ${line.trimRight()}`);
                    }
                });
            });

            proc.stderr.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        if (this.portDetector) this.portDetector.feedLog(name, line);
                        console.log(`${colorPrefix}[${name} ERR]\x1b[0m ${line.trimRight()}`);
                    }
                });
            });

            proc.on('error', (err) => {
                reject(err);
            });

            proc.on('exit', (code) => {
                if (this.onProcessExit) {
                    this.onProcessExit(name, code);
                }
            });

            // Resolve immediately when process starts. 
            // The orchestrator will use PortDetector to wait for ports.
            resolve({ proc });
        });
    }

    async stopAll() {
        for (const p of this.processes) {
            await killProcessTree(p.proc.pid);
        }
        this.processes = [];
    }
}
