import { analyzeProject } from './analyzer.js';
import { ProcessManager, killProcessTree } from './processManager.js';
import { PortDetector } from './portDetector.js';
import { LocalTunnelProvider } from './tunnel/LocalTunnelProvider.js';
import { HunterstarProvider } from './tunnel/HunterstarProvider.js';
import { SessionManager } from './sessionManager.js';
import { spawn } from 'child_process';

export async function runServerCommand(args) {
    const isDryRun = args.length === 0;
    const isOff = args.includes('--off');
    const isRestart = args.includes('--restart');
    const isStatus = args.includes('--status');
    const isForeground = args.includes('--foreground');
    const isDaemon = args.includes('--daemon');
    const isPublic = args.includes('--public') || args.includes('--share');
    const isOn = args.includes('--on') || args.includes('--public') || args.includes('--share');
    
    let subdomain = null;
    const shareIndex = args.indexOf('--share');
    if (shareIndex !== -1 && shareIndex + 1 < args.length && !args[shareIndex + 1].startsWith('--')) {
        subdomain = args[shareIndex + 1];
    } else if (args.includes('--daemon') && args.includes('--subdomain')) {
        const subIndex = args.indexOf('--subdomain');
        if (subIndex !== -1 && subIndex + 1 < args.length) subdomain = args[subIndex + 1];
    }

    const cwd = process.cwd();
    const sessionManager = new SessionManager(cwd);
    
    // ---------------------------------------------------------
    // --off
    // ---------------------------------------------------------
    if (isOff || isRestart) {
        const session = sessionManager.getSession();
        if (session) {
            console.log('\n\x1b[31mStopping Hunterstar Server...\x1b[0m');
            if (session.frontend?.pid) {
                await killProcessTree(session.frontend.pid);
                console.log('\u2713 Stopped frontend');
            }
            if (session.backend?.pid) {
                await killProcessTree(session.backend.pid);
                console.log('\u2713 Stopped backend');
            }
            // For Phase 1 tunnels, LocalTunnel process is tracked in the tunnel provider, 
            // but in daemon mode, it's a child of the daemon process. 
            // If we kill the daemon process, tunnels will die.
            if (session.daemonPid) {
                await killProcessTree(session.daemonPid);
            }
            
            sessionManager.deleteSession();
            console.log('\x1b[32mHunterstar Server stopped.\x1b[0m\n');
        } else if (isOff) {
            console.log('\n\x1b[33mNo active server session found.\x1b[0m\n');
        }

        if (isOff) return;
    }

    // ---------------------------------------------------------
    // --on (Foreground / Background orchestration)
    // ---------------------------------------------------------
    if (isOn || isRestart) {
        if (!isForeground && !isDaemon) {
            // Background mode
            console.log('\x1b[32mStarting Hunterstar Server in background...\x1b[0m');
            
            const daemonArgs = [process.argv[1], 'server', '--daemon'];
            if (isPublic) daemonArgs.push('--public');
            if (subdomain) {
                daemonArgs.push('--subdomain');
                daemonArgs.push(subdomain);
            }

            const daemonProc = spawn(process.execPath, daemonArgs, {
                detached: true,
                stdio: 'ignore',
                cwd: cwd,
                windowsHide: true
            });
            daemonProc.unref();

            // Wait for session to populate ports
            process.stdout.write('Waiting for services to bind ports...');
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 500));
                process.stdout.write('.');
                const s = sessionManager.getSession();
                if (s && s.ready) {
                    console.log(' \x1b[32mReady!\x1b[0m\n');
                    printDashboard(s, sessionManager);
                    return;
                }
            }
            console.log('\n\x1b[33mTimed out waiting for ports. Check status with `hunterstar server --status`\x1b[0m');
            return;
        }
    }

    // ---------------------------------------------------------
    // --daemon OR --foreground (The actual worker)
    // ---------------------------------------------------------
    if (isDaemon || isForeground) {
        const analysis = analyzeProject(cwd);
        const session = sessionManager.createSession();
        session.daemonPid = process.pid;
        sessionManager.saveSession(session);
        
        const portDetector = new PortDetector();
        const pm = new ProcessManager(portDetector);
        const tunnels = [];

        const shutdown = async () => {
            if (isForeground) console.log('\n\x1b[31mShutting down Hunterstar Server...\x1b[0m');
            await pm.stopAll();
            for (const t of tunnels) await t.stop();
            sessionManager.deleteSession();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        if (isForeground) console.log('\x1b[32mStarting servers...\x1b[0m\n');
        
        const startupPromises = [];

        if (analysis.backend) {
            if (isForeground) console.log(`\x1b[90m> Starting BACKEND:\x1b[0m ${analysis.backend.command}`);
            startupPromises.push((async () => {
                const { proc } = await pm.startProcess('BACKEND', analysis.backend.command, analysis.backend.cwd, '\x1b[32m');
                session.backend = { pid: proc.pid, port: null };
                sessionManager.saveSession(session);

                const backendPort = await portDetector.waitForPort('BACKEND');
                session.backend.port = backendPort;
                sessionManager.saveSession(session);

                if (backendPort && isPublic) {
                    const tunnel = new HunterstarProvider();
                    tunnels.push(tunnel);
                    try {
                        const backendSubdomain = subdomain ? `api-${subdomain}` : null;
                        const url = await tunnel.start(backendPort, backendSubdomain);
                        session.tunnels.backend = url;
                        sessionManager.saveSession(session);
                    } catch (e) {}
                }
            })());
        }

        if (analysis.frontend) {
            if (isForeground) console.log(`\x1b[90m> Starting FRONTEND:\x1b[0m ${analysis.frontend.command}`);
            startupPromises.push((async () => {
                const { proc } = await pm.startProcess('FRONTEND', analysis.frontend.command, analysis.frontend.cwd, '\x1b[36m');
                session.frontend = { pid: proc.pid, port: null };
                sessionManager.saveSession(session);

                const frontendPort = await portDetector.waitForPort('FRONTEND');
                session.frontend.port = frontendPort;
                sessionManager.saveSession(session);

                if (frontendPort && isPublic) {
                    const tunnel = new HunterstarProvider();
                    tunnels.push(tunnel);
                    try {
                        console.log('Starting frontend tunnel...');
                        const url = await tunnel.start(frontendPort, subdomain);
                        console.log('Frontend tunnel started:', url);
                        session.tunnels.frontend = url;
                        sessionManager.saveSession(session);
                    } catch (e) {
                        console.log('Frontend tunnel failed:', e);
                    }
                }
            })());
        }

        await Promise.all(startupPromises);
        session.ready = true;
        sessionManager.saveSession(session);

        if (isForeground) {
            printDashboard(session, sessionManager, true);
        }
        return; // Daemon stays alive until SIGTERM
    }

    // ---------------------------------------------------------
    // Default (no flags) OR --status
    // ---------------------------------------------------------
    const session = sessionManager.getSession();
    
    if (isStatus) {
        if (!session) {
            console.log('\n\x1b[33mNo active server session found.\x1b[0m\n');
            return;
        }
        printDashboard(session, sessionManager);
        return;
    }

    if (isDryRun) {
        if (session && sessionManager.isProcessRunning(session.daemonPid)) {
            printDashboard(session, sessionManager);
            console.log(`Use:\n  \x1b[36mhunterstar server --status\x1b[0m\n  \x1b[36mhunterstar server --off\x1b[0m\n  \x1b[36mhunterstar server --restart\x1b[0m\n`);
        } else {
            console.log('\x1b[36mHunterstar Server Analyzer\x1b[0m\n');
            const analysis = analyzeProject(cwd);
            
            if (!analysis.frontend && !analysis.backend) {
                console.log(`\x1b[33mNo valid project detected in ${cwd}\x1b[0m\n`);
                return;
            }

            console.log(`Detected:`);
            if (analysis.frontend) console.log(`  \u2713 \x1b[36m${analysis.frontend.type}\x1b[0m (\x1b[90m${analysis.frontend.command}\x1b[0m)`);
            if (analysis.backend) console.log(`  \u2713 \x1b[32m${analysis.backend.type}\x1b[0m (\x1b[90m${analysis.backend.command}\x1b[0m)`);
            if (analysis.databases && analysis.databases.length > 0) {
                console.log(`  \u2713 \x1b[35mDatabases:\x1b[0m ${analysis.databases.join(', ')}`);
            }
            
            console.log(`\nRun \x1b[36mhunterstar server --on\x1b[0m to start.\n`);
        }
    }
}

function printDashboard(session, sessionManager, isForeground = false) {
    console.log('\n\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E');
    console.log('\u2502         \x1b[1mHUNTERSTAR SERVER\x1b[0m              \u2502');
    console.log(`\u2502  Session: \x1b[90m${session.id.padEnd(27)}\x1b[0m \u2502`);
    console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
    console.log('\u2502                                        \u2502');
    
    if (session.frontend) {
        const alive = sessionManager.isProcessRunning(session.frontend.pid);
        const status = alive ? '\x1b[36m\u25CF Running\x1b[0m' : '\x1b[31m\u2717 Crashed\x1b[0m';
        
        console.log('\u2502  \x1b[1mFRONTEND\x1b[0m                              \u2502');
        console.log(`\u2502  ${status.padEnd(46)} \u2502`);
        console.log(`\u2502  Local   http://localhost:${(session.frontend.port || '----').toString().padEnd(15)}\u2502`);
        if (session.tunnels && session.tunnels.frontend) console.log(`\u2502  Public  ${(session.tunnels.frontend || '----').padEnd(28)} \u2502`);
        console.log('\u2502                                        \u2502');
    }
    
    if (session.backend) {
        const alive = sessionManager.isProcessRunning(session.backend.pid);
        const status = alive ? '\x1b[32m\u25CF Running\x1b[0m' : '\x1b[31m\u2717 Crashed\x1b[0m';

        console.log('\u2502  \x1b[1mBACKEND\x1b[0m                               \u2502');
        console.log(`\u2502  ${status.padEnd(46)} \u2502`);
        console.log(`\u2502  Local   http://localhost:${(session.backend.port || '----').toString().padEnd(15)}\u2502`);
        if (session.tunnels && session.tunnels.backend) console.log(`\u2502  Public  ${(session.tunnels.backend || '----').padEnd(28)} \u2502`);
        console.log('\u2502                                        \u2502');
    }

    if (isForeground) {
        console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
        console.log('\u2502  Ctrl+C  Stop all services             \u2502');
    }
    console.log('\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F');
    console.log('');
}
