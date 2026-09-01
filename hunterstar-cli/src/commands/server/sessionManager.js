import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export class SessionManager {
    constructor(cwd) {
        this.cwd = cwd;
        const homeDir = os.homedir();
        this.sessionsDir = path.join(homeDir, '.hunterstar', 'server-sessions');
        
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
        
        // Use a hash of the directory path as the persistent session key for this project
        const hash = crypto.createHash('md5').update(this.cwd).digest('hex').substring(0, 6);
        this.sessionId = `hs_${hash}`;
        this.sessionFile = path.join(this.sessionsDir, `${this.sessionId}.json`);
    }

    getSession() {
        if (!fs.existsSync(this.sessionFile)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        } catch (e) {
            return null;
        }
    }

    createSession() {
        const session = {
            id: this.sessionId,
            project: this.cwd,
            startedAt: new Date().toISOString(),
            frontend: null,
            backend: null,
            tunnels: {}
        };
        this.saveSession(session);
        return session;
    }

    saveSession(data) {
        fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2), 'utf8');
    }

    deleteSession() {
        if (fs.existsSync(this.sessionFile)) {
            fs.unlinkSync(this.sessionFile);
        }
    }

    isProcessRunning(pid) {
        if (!pid) return false;
        try {
            // signal 0 tests if the process exists
            process.kill(pid, 0);
            return true;
        } catch (e) {
            return false;
        }
    }
}
