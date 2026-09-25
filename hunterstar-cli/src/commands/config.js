import { loadConfig, setConfigValue, applyPreset, AI_PRESETS } from '../utils/configManager.js';

export async function runConfig(args) {
    const subCommand = args[0];

    if (subCommand === 'get') {
        const config = loadConfig();
        console.log('\n\x1b[36mHunterstar Configuration\x1b[0m\n');
        for (const [key, value] of Object.entries(config)) {
            const displayVal = (key === 'api-key' && value) ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
            console.log(`  \x1b[33m${key}:\x1b[0m ${displayVal}`);
        }
        console.log('');
    } else if (subCommand === 'set') {
        const key = args[1];
        const value = args[2];
        if (!key || !value) {
            console.log('\x1b[31mUsage:\x1b[0m hunterstar config set <key> <value>');
            return;
        }
        if (key === 'provider' && (value === 'own' || value === 'cloud' || value === 'open' || value === 'openrouter')) {
            const res = applyPreset(value);
            console.log(`\x1b[32m\u2713 AI Provider set to:\x1b[0m ${res?.name || value}`);
            return;
        }
        setConfigValue(key, value);
        console.log(`\x1b[32m\u2713 Config updated:\x1b[0m ${key} = ${value}`);
    } else if (subCommand === 'preset') {
        const target = args[1];
        if (!target) {
            console.log('\n\x1b[36mAvailable AI Presets:\x1b[0m');
            console.log('  \x1b[33mown\x1b[0m   - Self-hosted AI Dual Routing (Fast 1.5B @ /fast/ + Heavy 35B MoE @ /v1/)');
            console.log('  \x1b[33mcloud\x1b[0m - Official Hunterstar Cloud AI (api.hunterstar.uz)');
            console.log('  \x1b[33mopen\x1b[0m  - OpenRouter AI Direct (openrouter.ai)\n');
            console.log('Usage: hunterstar config preset <own|cloud|open>\n');
            return;
        }
        const res = applyPreset(target);
        if (res) {
            console.log(`\x1b[32m\u2713 Applied AI preset:\x1b[0m ${res.name}`);
            console.log(`  \x1b[90mEndpoint:     ${res.preset['api-url']}\x1b[0m`);
            if (res.preset['fast-api-url']) console.log(`  \x1b[90mFast Endpoint:  ${res.preset['fast-api-url']}\x1b[0m`);
            console.log(`  \x1b[90mDefault Model: ${res.preset['model']}\x1b[0m`);
            console.log(`  \x1b[90mRouting Tier:   ${res.preset['tier'] || 'auto'}\x1b[0m\n`);
        } else {
            console.log(`\x1b[31mUnknown preset:\x1b[0m ${target}. Choose "own", "cloud", or "open".`);
        }
    } else {
        console.log('\x1b[31mUnknown config command.\x1b[0m Usage: hunterstar config <get|set|preset>');
    }
}

