import { spawn } from 'child_process';
import path from 'path';

export async function runDeploy() {
    console.log('\x1b[36m🚀 Starting Deployment Process...\x1b[0m');
    
    // Absolute path resolution relative to where the CLI is installed
    // If it's globally installed, it might need to trigger deployment in the CWD
    // For now, it looks for the deploy-vps.ps1 in the current working directory or specific path
    const scriptPath = path.resolve(process.cwd(), 'api/deploy-vps.ps1');
    
    console.log(`\x1b[33mTriggering deploy script at: ${scriptPath}\x1b[0m`);
    
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
        // Run PowerShell script
        const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            stdio: 'inherit'
        });

        ps.on('close', (code) => {
            if (code === 0) {
                console.log('\n\x1b[32m✅ Deployment finished successfully!\x1b[0m');
            } else {
                console.log(`\n\x1b[31m❌ Deployment failed with exit code ${code}\x1b[0m`);
            }
        });
    } else {
        console.log(`\x1b[31m❌ Deployment script is set for Windows PowerShell.\x1b[0m`);
    }
}
