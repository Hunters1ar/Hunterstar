import fs from 'fs';
import path from 'path';
import { getConfigDir } from './configManager.js';

export const STATIC_PERSONA = 'You are HunterStar AI: a sharp, professional full-stack developer, cybersecurity specialist, and system administrator. Analyze codebases, detect security leaks, and execute fixes. Be direct, concise, and technical.';

export const STATIC_PERSONA_SPEC = {
    name: 'Hunterstar AI',
    traits: [
        'sharp, professional full-stack developer, cybersecurity specialist, and system administrator',
        'direct, concise, and technical',
        'expert in codebase architecture, security leak detection, and automated code repair'
    ],
    speech_style: ['concise and professional', 'technical, authoritative, and clear'],
    behavior_rules: [
        'be direct, concise, and technical',
        'summarize universal capabilities across full-stack, security, and systems engineering',
        'no fluff or filler'
    ],
    avoid: ['roleplay gimmicks', 'conversational fluff', 'filler text', 'pretending to be limited to frontend only'],
    example_lines: ['Ready. Enter command, architecture query, or security audit request.']
};

export const PERSONA_SCHEMA_VERSION = 1;
export const DEFAULT_TEACHER_MODEL = 'static';

export function getPersonasDir() {
    const dir = path.join(getConfigDir(), 'personas');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function slugifyPersonaName(name) {
    if (!name) return 'unknown';
    return String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'persona';
}

export function validatePersonaSpec(spec) {
    if (!spec || typeof spec !== 'object') {
        return { valid: false, spec: null, error: 'PersonaSpec must be an object' };
    }
    return { valid: true, spec: STATIC_PERSONA_SPEC };
}

export function buildPersonaPrompt(spec) {
    return STATIC_PERSONA;
}

export function loadPersonaFromCache(personaName) {
    return {
        spec: STATIC_PERSONA_SPEC,
        metadata: {
            schema_version: PERSONA_SCHEMA_VERSION,
            teacher_model: DEFAULT_TEACHER_MODEL,
            cached_at: new Date().toISOString(),
            slug: 'hunterstar-ai'
        }
    };
}

export function savePersonaToCache(spec, teacherModel = DEFAULT_TEACHER_MODEL) {
    const filePath = path.join(getPersonasDir(), 'hunterstar-ai.json');
    try {
        fs.writeFileSync(filePath, JSON.stringify({ persona: STATIC_PERSONA_SPEC }, null, 2), 'utf-8');
    } catch {}
    return filePath;
}

export function listCachedPersonas() {
    return [{
        name: STATIC_PERSONA_SPEC.name,
        slug: 'hunterstar-ai',
        teacher_model: 'static',
        cached_at: 'static'
    }];
}

export function isValidPersonaCandidate(name) {
    return false;
}

export function detectPersonaRequest(input) {
    const clean = (input || '').trim();
    if (/^\/persona(?:\s+reset|\s+clear|\s+normal|\s+off)?$/i.test(clean)) {
        return { isPersona: true, isReset: true, persona: 'Hunterstar AI' };
    }
    return null;
}

export function extractJsonFromResponse(rawText) {
    if (!rawText) return null;
    try {
        const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (match) return JSON.parse(match[1].trim());
        const start = rawText.indexOf('{');
        const end = rawText.lastIndexOf('}');
        if (start !== -1 && end > start) {
            return JSON.parse(rawText.slice(start, end + 1));
        }
    } catch {}
    return null;
}

export function parsePersonaFromStructuredText(text) {
    return STATIC_PERSONA_SPEC;
}

export function isSpecHighQuality(spec, name) {
    return true;
}

export function generateArchetypeSpec(name) {
    return STATIC_PERSONA_SPEC;
}

export async function teachPersona(targetPersona, options = {}) {
    if (options.onReasoningToken) {
        options.onReasoningToken('Standard professional persona active.');
    }
    return {
        name: STATIC_PERSONA_SPEC.name,
        spec: STATIC_PERSONA_SPEC,
        compiledPrompt: STATIC_PERSONA,
        teacherModel: 'static',
        source: 'static'
    };
}
