import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function runDoctor() {
    console.log('\x1b[36m🩺 Hunterstar System Doctor\x1b[0m\n');
    console.log('Checking dependencies...\n');

    const checks = [
        { name: 'Node.js', cmd: 'node -v' },
        { name: 'npm', cmd: 'npm -v' },
        { name: 'Git', cmd: 'git --version' },
        { name: 'Docker', cmd: 'docker --version' }
    ];

    for (const check of checks) {
        process.stdout.write(`Checking ${check.name}... `);
        try {
            const { stdout } = await execAsync(check.cmd);
            console.log(`\x1b[32m✅ OK\x1b[0m (${stdout.trim()})`);
        } catch (error) {
            console.log(`\x1b[31m❌ Missing\x1b[0m`);
            console.log(`   Command '${check.cmd}' failed.`);
        }
    }
    console.log('\n\x1b[32mDiagnosis complete.\x1b[0m');
}
