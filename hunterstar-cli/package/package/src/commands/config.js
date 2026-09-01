import { loadConfig, setConfigValue } from '../utils/configManager.js';

export async function runConfig(args) {
    const subCommand = args[0];

    if (subCommand === 'get') {
        const config = loadConfig();
        console.log('\n\x1b[36mHunterstar Configuration\x1b[0m\n');
        for (const [key, value] of Object.entries(config)) {
            console.log(`  \x1b[33m${key}:\x1b[0m ${value}`);
        }
        console.log('');
    } else if (subCommand === 'set') {
        const key = args[1];
        const value = args[2];
        if (!key || !value) {
            console.log('\x1b[31mUsage:\x1b[0m hunterstar config set <key> <value>');
            return;
        }
        setConfigValue(key, value);
        console.log(`\x1b[32m\u2713 Config updated:\x1b[0m ${key} = ${value}`);
    } else {
        console.log('\x1b[31mUnknown config command.\x1b[0m Usage: hunterstar config <get|set>');
    }
}
