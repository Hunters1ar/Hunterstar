import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';

const execPromise = util.promisify(exec);

export async function runUpdate() {
    console.log('\x1b[36mdYs? Checking for Hunterstar CLI updates...\x1b[0m');
    
    try {
        // Read current version from package.json
        const packagePath = new URL('../../package.json', import.meta.url);
        const pkgData = await fs.readFile(packagePath, 'utf-8');
        const { name, version: currentVersion } = JSON.parse(pkgData);
        
        console.log(`Current version: \x1b[33m${currentVersion}\x1b[0m`);
        console.log('Fetching latest version from npm...');

        const { stdout: latestVersion } = await execPromise(`npm show ${name} version`);
        const latest = latestVersion.trim();

        const parseVer = (v) => v.split('.').map(Number);
        const [cMaj, cMin, cPat] = parseVer(currentVersion);
        const [lMaj, lMin, lPat] = parseVer(latest);

        const isNewer = lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat);

        if (!isNewer) {
            console.log('\n\x1b[32m\u2713 You are already on the latest version (or newer)!\x1b[0m');
            return;
        }

        console.log(`\nFound new version: \x1b[32m${latest}\x1b[0m`);
        console.log('Updating globally...');

        await execPromise(`npm install -g ${name}@latest`);
        
        console.log('\n\x1b[32m\u2713 Successfully updated Hunterstar CLI to version ' + latest + '!\x1b[0m');
    } catch (error) {
        console.log('\x1b[31m\u2717 Failed to update CLI.\x1b[0m');
        console.error(error.message);
    }
}
