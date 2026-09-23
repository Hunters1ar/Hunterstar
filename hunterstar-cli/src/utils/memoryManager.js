import fs from 'fs';
import path from 'path';
import { getConfigDir } from './configManager.js';

function getMemoryFilePath() {
    return path.join(getConfigDir(), 'memory.json');
}

const DEFAULT_LESSONS = [
    {
        id: 'avoid-root-recursion',
        trigger: 'timeout_search',
        rule: 'Never run unbounded -Recurse across entire user home (C:\\Users\\...) or drive roots. Target specific subfolders ($env:APPDATA, $env:LOCALAPPDATA, Start Menu) or use -Depth 1.',
        timesTriggered: 1,
        createdAt: Date.now()
    },
    {
        id: 'limit-output-tokens',
        trigger: 'large_output',
        rule: 'Pipe search results to "Select-Object -First 15" to prevent context flooding and token waste.',
        timesTriggered: 1,
        createdAt: Date.now()
    }
];

export function loadMemory() {
    const memPath = getMemoryFilePath();
    if (!fs.existsSync(memPath)) {
        return { lessons: [...DEFAULT_LESSONS], knowledge: [] };
    }
    try {
        const data = JSON.parse(fs.readFileSync(memPath, 'utf8'));
        if (!Array.isArray(data.lessons)) data.lessons = [...DEFAULT_LESSONS];
        if (!Array.isArray(data.knowledge)) data.knowledge = [];
        return data;
    } catch {
        return { lessons: [...DEFAULT_LESSONS], knowledge: [] };
    }
}

export function saveMemory(memory) {
    try {
        fs.writeFileSync(getMemoryFilePath(), JSON.stringify(memory, null, 2), 'utf8');
    } catch (err) {
        console.error('\x1b[31m[Memory Error]\x1b[0m Could not save memory:', err.message);
    }
}

export function recordMistake(command, { timeout = false, stderr = '', errorMsg = '' } = {}) {
    const memory = loadMemory();
    let detectedId = null;
    let ruleText = null;

    const lowerCmd = (command || '').toLowerCase();
    const lowerErr = (stderr + ' ' + errorMsg).toLowerCase();

    if (timeout && (lowerCmd.includes('-recurse') || lowerCmd.includes('find .') || lowerCmd.includes('/s'))) {
        detectedId = 'avoid-root-recursion';
        ruleText = 'Never run unbounded recursive searches across user profile or drive roots; it times out after 30s. Target specific subdirectories (e.g. $env:APPDATA, $env:LOCALAPPDATA, Start Menu) or use -Depth 1.';
    } else if (timeout) {
        detectedId = 'command-timeout';
        ruleText = 'Command timed out after 30s. Break heavy scripts into smaller, targeted single-step commands.';
    } else if (lowerErr.includes('not a valid statement separator') || lowerCmd.includes('&&') && process.platform === 'win32') {
        detectedId = 'powershell-chaining';
        ruleText = "Do not use '&&' to chain commands in Windows PowerShell; use ';' instead.";
    } else if (lowerCmd.includes('convert ') && !lowerCmd.includes('hunterstar convert') && process.platform === 'win32') {
        detectedId = 'windows-convert';
        ruleText = "On Windows, never execute 'convert' directly (it is FAT-to-NTFS tool). Use 'hunterstar convert'.";
    }

    if (!detectedId) {
        return null;
    }

    let existing = memory.lessons.find(l => l.id === detectedId);
    if (existing) {
        existing.timesTriggered = (existing.timesTriggered || 1) + 1;
        existing.lastEncountered = Date.now();
        if (ruleText) existing.rule = ruleText;
    } else {
        existing = {
            id: detectedId,
            rule: ruleText,
            timesTriggered: 1,
            lastEncountered: Date.now()
        };
        memory.lessons.push(existing);
    }

    saveMemory(memory);
    return existing;
}

export function recordUserLesson(text) {
    if (!text || !text.trim()) return null;
    const memory = loadMemory();
    const cleanText = text.trim();
    const item = {
        id: `user-${Date.now()}`,
        rule: cleanText,
        manual: true,
        timesTriggered: 1,
        createdAt: Date.now()
    };
    memory.lessons.unshift(item);
    // Keep max 20 lessons
    if (memory.lessons.length > 20) memory.lessons = memory.lessons.slice(0, 20);
    saveMemory(memory);
    return item;
}

export function clearMemory() {
    saveMemory({ lessons: [...DEFAULT_LESSONS], knowledge: [] });
}

export function getLearnedPromptGuidance(maxItems = 3) {
    const memory = loadMemory();
    const sorted = [...memory.lessons].sort((a, b) => (b.timesTriggered || 1) - (a.timesTriggered || 1));
    const top = sorted.slice(0, maxItems);
    if (!top.length) return '';

    return `\nLEARNED MISTAKES & RULES (Avoid these mistakes):\n` +
        top.map(l => `- ${l.rule}`).join('\n');
}

export function compactCommandOutput(stdout = '', stderr = '', maxLines = 15, maxChars = 600) {
    const raw = (stdout || stderr || '').trim();
    if (!raw) return 'Command succeeded with no output.';

    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    let result;
    if (lines.length > maxLines) {
        const keepFirst = Math.min(8, lines.length);
        const keepLast = 2;
        const omitted = lines.length - keepFirst - keepLast;
        result = [
            ...lines.slice(0, keepFirst),
            `[... ${omitted} output lines omitted to preserve tokens ...]`,
            ...lines.slice(-keepLast)
        ].join('\n');
    } else {
        result = lines.join('\n');
    }

    if (result.length > maxChars) {
        result = result.slice(0, maxChars - 50) + '\n[...truncated to save tokens...]';
    }

    return result;
}
