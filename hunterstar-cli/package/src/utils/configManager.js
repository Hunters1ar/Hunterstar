import fs from 'fs';
import path from 'path';
import os from 'os';

function getConfigFilePath() {
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
    
    return path.join(configDir, 'config.json');
}

const CONFIG_PATH = getConfigFilePath();

const DEFAULT_CONFIG = {
    'api-url': 'https://api.hunterstar.uz',
    'model': 'dots-studio/dots-3-note-preview:free'
};

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
