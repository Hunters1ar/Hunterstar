import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function runDoctor() {
    console.log('\x1b[36m🩺 Hunterstar System Doctor\x1b[0m\n');
    
    // 1. System Dependencies
    console.log('\x1b[35m--- System Dependencies ---\x1b[0m');
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

    // 2. Project Health
    console.log('\n\x1b[35m--- Project Health Check ---\x1b[0m');
    const cwd = process.cwd();
    
    // Check package.json
    try {
        await fs.access(path.join(cwd, 'package.json'));
        console.log(`Checking package.json... \x1b[32m✅ Found\x1b[0m`);
        
        // Check if node_modules is installed
        try {
            await fs.access(path.join(cwd, 'node_modules'));
            console.log(`Checking node_modules... \x1b[32m✅ Installed\x1b[0m`);
        } catch {
            console.log(`Checking node_modules... \x1b[31m❌ Missing\x1b[0m (Run 'npm install')`);
        }
    } catch {
        console.log(`Checking package.json... \x1b[33m⚠️ Not a Node.js project (Skipping NPM checks)\x1b[0m`);
    }

    // Check Git Repo
    try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd });
        console.log(`Checking Git repo... \x1b[32m✅ Initialized\x1b[0m`);
    } catch {
        console.log(`Checking Git repo... \x1b[31m❌ Not initialized\x1b[0m (Run 'git init')`);
    }

    // Check Environment Variables
    try {
        await fs.access(path.join(cwd, '.env.example'));
        try {
            await fs.access(path.join(cwd, '.env'));
            console.log(`Checking Environment (.env)... \x1b[32m✅ Configured\x1b[0m`);
        } catch {
            console.log(`Checking Environment (.env)... \x1b[31m❌ Missing\x1b[0m (You have .env.example, please copy it to .env)`);
        }
    } catch {
        // No .env.example, silently ignore
    }

    console.log('\n\x1b[32mDiagnosis complete.\x1b[0m');
}
