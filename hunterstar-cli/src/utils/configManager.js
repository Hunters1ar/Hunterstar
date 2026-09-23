import fs from 'fs';
import path from 'path';
import os from 'os';

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

export const AI_PRESETS = {
    own: {
        'api-provider': 'own',
        'api-url': 'https://api.moonlightsoldiers.xyz/v1/chat/completions',
        'api-key': 'hunterella@152634879man',
        'model': 'Qwen3-Coder-30B',
        'max_tokens': 8192
    },
    cloud: {
        'api-provider': 'cloud',
        'api-url': 'https://api.hunterstar.uz',
        'api-key': '',
        'model': 'dots-studio/dots-3-note-preview:free',
        'max_tokens': 8192
    }
};

const DEFAULT_CONFIG = {
    'api-provider': 'cloud',
    'api-url': 'https://api.hunterstar.uz',
    'model': 'dots-studio/dots-3-note-preview:free',
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
    return null;
}

export function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return { ...DEFAULT_CONFIG };
    }
    try {
        const fileContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(fileContent);
        return { ...DEFAULT_CONFIG, ...parsed };
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
