import fs from 'fs';
import path from 'path';
import os from 'os';
import { FAST_API_URL, HEAVY_API_URL, API_KEY } from './aiRouter.js';

export { FAST_API_URL, HEAVY_API_URL, API_KEY };

export function getConfigDir() {
    let configDir;
    if (process.platform === 'win32') {
        configDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'hunterstar');
    } else if (process.platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'hunterstar');
    } else {
        configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'hunterstar');
    }
    
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    return configDir;
}

function getConfigFilePath() {
    return path.join(getConfigDir(), 'config.json');
}

const CONFIG_PATH = getConfigFilePath();

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_DEFAULT_MODEL = 'qwen/qwen3.8-27b:free';

export const AI_PRESETS = {
    own: {
        'api-provider': 'own',
        'api-url': HEAVY_API_URL,
        'fast-api-url': FAST_API_URL,
        'heavy-api-url': HEAVY_API_URL,
        'api-key': API_KEY,
        'model': 'Qwen3-Coder-30B',
        'tier': 'auto',
        'max_tokens': 8192
    },
    cloud: {
        'api-provider': 'cloud',
        'api-url': 'https://api.hunterstar.uz',
        'api-key': '',
        'model': OPENROUTER_DEFAULT_MODEL,
        'tier': 'cloud',
        'max_tokens': 8192
    },
    open: {
        'api-provider': 'openrouter',
        'api-url': OPENROUTER_API_URL,
        'api-key': '',
        'model': OPENROUTER_DEFAULT_MODEL,
        'tier': 'openrouter',
        'max_tokens': 8192
    }
};

const DEFAULT_CONFIG = {
    'api-provider': 'cloud',
    'api-url': 'https://api.hunterstar.uz',
    'model': OPENROUTER_DEFAULT_MODEL,
    'tier': 'auto',
    'fast-api-url': FAST_API_URL,
    'heavy-api-url': HEAVY_API_URL,
    'max_tokens': 8192
};

export function applyPreset(presetName) {
    const key = (presetName || '').toLowerCase().trim();
    if (key === 'own' || key === 'self' || key === 'hunterella' || key === 'my') {
        const config = loadConfig();
        Object.assign(config, AI_PRESETS.own);
        saveConfig(config);
        return { name: 'own', preset: AI_PRESETS.own };
    }
    if (key === 'cloud' || key === 'hunterstar' || key === 'default') {
        const config = loadConfig();
        Object.assign(config, AI_PRESETS.cloud);
        saveConfig(config);
        return { name: 'cloud', preset: AI_PRESETS.cloud };
    }
    if (key === 'open' || key === 'openrouter' || key === 'open-router' || key === 'router') {
        const config = loadConfig();
        const savedOpenKey = config['openrouter-api-key'] || (config['api-provider'] === 'openrouter' ? config['api-key'] : '');
        Object.assign(config, AI_PRESETS.open);
        if (savedOpenKey) {
            config['api-key'] = savedOpenKey;
        }
        saveConfig(config);
        return { name: 'open', preset: AI_PRESETS.open };
    }
    return null;
}

export function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return { ...DEFAULT_CONFIG };
    }
    try {
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(fileContent);
        const merged = { ...DEFAULT_CONFIG, ...parsed };
        if (merged['api-provider'] === 'own' || merged['api-url']?.includes('moonlightsoldiers')) {
            if (!merged['fast-api-url']) merged['fast-api-url'] = FAST_API_URL;
            if (!merged['heavy-api-url']) merged['heavy-api-url'] = HEAVY_API_URL;
            if (!merged['api-key']) merged['api-key'] = API_KEY;
            if (!merged['tier']) merged['tier'] = 'auto';
        }
        return merged;
    } catch (err) {
        console.error('\x1b[31m[Config Error]\x1b[0m Could not read config file, using defaults.', err.message);
        return { ...DEFAULT_CONFIG };
    }
}

export function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
        console.error('\x1b[31m[Config Error]\x1b[0m Could not save config file.', err.message);
    }
}

export function getConfigValue(key) {
    const config = loadConfig();
    return config[key];
}

export function setConfigValue(key, value) {
    const config = loadConfig();
    config[key] = value;
    saveConfig(config);
}
