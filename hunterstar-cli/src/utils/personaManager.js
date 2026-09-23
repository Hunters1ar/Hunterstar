import fs from 'fs';
import path from 'path';
import { getConfigDir } from './configManager.js';
import { HEAVY_API_URL, API_KEY } from './aiRouter.js';
import { requestAi } from './aiTransport.js';

export const PERSONA_SCHEMA_VERSION = 1;
export const DEFAULT_TEACHER_MODEL = 'Qwen3.6-35B-A3B';

/**
 * Returns the directory used for caching learned persona specifications.
 * Defaults to `<configDir>/personas`.
 */
export function getPersonasDir() {
    const dir = path.join(getConfigDir(), 'personas');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Converts a persona name into a safe file slug (e.g., "Tsundere Girl" -> "tsundere-girl").
 */
export function slugifyPersonaName(name) {
    if (!name) return 'unknown';
    return String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'persona';
}

/**
 * Strips prompt-injection patterns, control tokens, and shell commands.
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/ignore\s+all\s+previous\s+instructions/gi, '')
        .replace(/system\s+prompt/gi, '')
        .replace(/\[\/?EXEC\]/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
}

/**
 * Validates and sanitizes a PersonaSpec object returned by the teacher or loaded from cache.
 *
 * @param {any} spec
 * @returns {{ valid: boolean, spec: object | null, error?: string }}
 */
export function validatePersonaSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        return { valid: false, spec: null, error: 'PersonaSpec must be a non-null JSON object' };
    }

    const name = sanitizeString(spec.name || '');
    if (!name || name.length > 50) {
        return { valid: false, spec: null, error: 'Persona name must be a non-empty string under 50 characters' };
    }

    const sanitizeList = (arr, maxItems = 6) => {
        if (!Array.isArray(arr)) return [];
        return arr
            .map(item => sanitizeString(String(item || '')))
            .filter(item => item.length > 0 && item.length <= 200)
            .slice(0, maxItems);
    };

    const traits = sanitizeList(spec.traits);
    const speech_style = sanitizeList(spec.speech_style);
    const behavior_rules = sanitizeList(spec.behavior_rules);
    const avoid = sanitizeList(spec.avoid);
    const example_lines = sanitizeList(spec.example_lines);

    if (traits.length === 0 && behavior_rules.length === 0) {
        return { valid: false, spec: null, error: 'PersonaSpec must contain at least some traits or behavior rules' };
    }

    const sanitizedSpec = {
        name,
        traits,
        speech_style,
        behavior_rules,
        avoid,
        example_lines
    };

    return { valid: true, spec: sanitizedSpec };
}

/**
 * Compiles a structured PersonaSpec into a clean, compact system prompt block for Fast AI (1.5B).
 *
 * @param {object} spec - Validated PersonaSpec
 * @returns {string}
 */
export function buildPersonaPrompt(spec) {
    if (!spec) return '';

    const sections = [`ACTIVE CHARACTER PERSONA\n\nName: ${spec.name}`];

    if (spec.traits && spec.traits.length > 0) {
        sections.push(`Traits & Attitude:\n${spec.traits.map(x => `- ${x}`).join('\n')}`);
    }

    if (spec.speech_style && spec.speech_style.length > 0) {
        sections.push(`Speech Style & Tone:\n${spec.speech_style.map(x => `- ${x}`).join('\n')}`);
    }

    if (spec.behavior_rules && spec.behavior_rules.length > 0) {
        sections.push(`Acting Rules:\n${spec.behavior_rules.map(x => `- ${x}`).join('\n')}`);
    }

    if (spec.avoid && spec.avoid.length > 0) {
        sections.push(`Avoid:\n${spec.avoid.map(x => `- ${x}`).join('\n')}`);
    }

    if (spec.example_lines && spec.example_lines.length > 0) {
        sections.push(`Example Lines (emulate this exact tone in all responses):\n${spec.example_lines.map(x => `- "${x}"`).join('\n')}`);
    }

    sections.push('CRITICAL: You are actively roleplaying this character. Speak, react, and emote strictly in-character in every response. Never explain the character trope, never say you are an AI, and stay useful while maintaining this persona.');

    return sections.join('\n\n');
}

/**
 * Loads a cached persona specification from disk.
 *
 * @param {string} personaName
 * @returns {{ spec: object, metadata: object } | null}
 */
export function loadPersonaFromCache(personaName) {
    const slug = slugifyPersonaName(personaName);
    const filePath = path.join(getPersonasDir(), `${slug}.json`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const specToValidate = parsed.persona || parsed;
        const validation = validatePersonaSpec(specToValidate);

        if (!validation.valid) {
            return null;
        }

        return {
            spec: validation.spec,
            metadata: {
                schema_version: parsed.schema_version || PERSONA_SCHEMA_VERSION,
                teacher_model: parsed.teacher_model || DEFAULT_TEACHER_MODEL,
                cached_at: parsed.cached_at || null,
                slug
            }
        };
    } catch {
        return null;
    }
}

/**
 * Saves a validated PersonaSpec to disk cache.
 *
 * @param {object} spec
 * @param {string} [teacherModel]
 * @returns {string} The cached file path
 */
export function savePersonaToCache(spec, teacherModel = DEFAULT_TEACHER_MODEL) {
    const validation = validatePersonaSpec(spec);
    if (!validation.valid) {
        throw new Error(`Cannot cache invalid PersonaSpec: ${validation.error}`);
    }

    const slug = slugifyPersonaName(validation.spec.name);
    const filePath = path.join(getPersonasDir(), `${slug}.json`);

    const record = {
        schema_version: PERSONA_SCHEMA_VERSION,
        teacher_model: teacherModel,
        cached_at: new Date().toISOString(),
        persona: validation.spec
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return filePath;
}

/**
 * Lists all cached personas on disk.
 *
 * @returns {Array<{ name: string, slug: string, teacher_model: string, cached_at: string }>}
 */
export function listCachedPersonas() {
    const dir = getPersonasDir();
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const list = [];

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
            const parsed = JSON.parse(raw);
            const spec = parsed.persona || parsed;
            if (spec?.name) {
                list.push({
                    name: spec.name,
                    slug: path.basename(file, '.json'),
                    teacher_model: parsed.teacher_model || DEFAULT_TEACHER_MODEL,
                    cached_at: parsed.cached_at || 'unknown'
                });
            }
        } catch {}
    }

    return list;
}

/**
 * Detects if a user input is an explicit or natural-language persona request.
 * Guards against false positives like questions, definitions, creative writing, or system tier switches.
 *
 * @param {string} input - User input string
 * @returns {{ isPersona: boolean, isReset: boolean, persona?: string } | null}
 */
export function detectPersonaRequest(input) {
    const clean = (input || '').trim().replace(/[?!.,;:]+$/, '').trim();
    if (!clean) return null;

    // 1. Explicit slash commands
    if (/^\/persona(?:\s+reset|\s+clear|\s+normal|\s+off)$/i.test(clean)) {
        return { isPersona: true, isReset: true };
    }

    const slashMatch = clean.match(/^\/persona\s+([a-zA-Z0-9_\-\s]{2,40})$/i);
    if (slashMatch) {
        const p = slashMatch[1].trim();
        if (['list', 'status', 'show'].includes(p.toLowerCase())) {
            return null; // Handled separately as inspection commands
        }
        return { isPersona: true, isReset: false, persona: p };
    }

    // 2. Explicit resets
    if (/^(?:reset\s+(?:personality|persona|character)|switch\s+to\s+normal(?:\s+personality)?|be\s+normal|default\s+persona)$/i.test(clean)) {
        return { isPersona: true, isReset: true };
    }

    // 3. Negative Guards (Avoid false positives)
    // Pure informational questions / definitions: "What does a tsundere personality mean?", "Why is tsundere popular?"
    if (/^(?:what\s+is|what\s+does|what\s+are|why\s+|how\s+does|how\s+do|who\s+is|who\s+are|explain\b|define\b|meaning\s+of\b|tell\s+me\s+about\b)/i.test(clean)) {
        return null;
    }
    // Creative requests: "Write a story where someone acts like a pirate"
    if (/^(?:write|create|draft|generate|make|compose)\s+(?:a\s+|an\s+)?(?:story|script|poem|novel|essay|scene|dialogue|post)\b/i.test(clean)) {
        return null;
    }
    // System / Tier / Tool changes: "switch to heavy", "switch to powershell", "switch to bash"
    if (/^switch\s+(?:in)?to\s+(?:heavy|fast|cloud|own|powershell|cmd|bash|git|docker)\b/i.test(clean)) {
        return null;
    }

    // 4. Natural language persona switch patterns

    // Pattern A: "switch into tsundere personality", "change to pirate persona", "change your personality to detective"
    const switchPattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:switch|change|turn)(?:\s+(?:your\s+)?(?:personality|persona|character|mode))?(?:\s+(?:in)?to)?\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const switchMatch = clean.match(switchPattern);
    if (switchMatch) {
        const candidate = switchMatch[1].trim();
        if (candidate && !['it', 'this', 'that', 'them', 'fast', 'heavy', 'normal', 'your personality', 'personality'].includes(candidate.toLowerCase())) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern B: "i want you to be silly prositute", "want you to be a pirate", "i need you to be..."
    const wantPattern = /^(?:i\s+(?:want|need|wish)\s+you\s+to\s+be|want\s+you\s+to\s+be)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const wantMatch = clean.match(wantPattern);
    if (wantMatch) {
        const candidate = wantMatch[1].trim();
        if (candidate && !['it', 'this', 'that', 'normal'].includes(candidate.toLowerCase())) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern C: "you are now a pirate", "act as sherlock holmes", "act like a tsundere", "roleplay as...", "pretend to be...", "talk like a pirate", "speak like a catgirl"
    const actPattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:you\s+are\s+now|act\s+as|act\s+like|roleplay\s+as|pretend\s+to\s+be|talk\s+like|speak\s+like)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const actMatch = clean.match(actPattern);
    if (actMatch) {
        const candidate = actMatch[1].trim();
        if (candidate && !['it', 'this', 'that', 'normal'].includes(candidate.toLowerCase())) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern D: "be a pirate", "be tsundere", "become a detective", "can you be a catgirl"
    const bePattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:be|become)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const beMatch = clean.match(bePattern);
    if (beMatch) {
        const candidate = beMatch[1].trim();
        if (candidate && !['it', 'this', 'that', 'normal', 'nice', 'careful', 'honest', 'quick', 'fast', 'sure', 'serious', 'ready'].includes(candidate.toLowerCase())) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    return null;
}

export const TEACHER_SYSTEM_PROMPT = `You are HunterStar's Master Personality Architect.
Your task is to teach a much smaller student language model (Qwen2.5-1.5B) how to convincingly portray the requested character archetype or persona.

Analyze the requested persona and produce a compact acting specification.
Focus on:
- Core personality traits and emotional contradictions
- Conversational rhythm and speech style
- Behavioral boundaries and reactions (e.g. how to soften, deflect, or handle affection)
- Common bad portrayals to avoid (teach behavioral patterns, NOT repetitive phrase spam or constant shoutings)
- Realistic example lines

CRITICAL INSTRUCTIONS FOR THE TEACHER:
1. The student model is small, so instructions must be concrete, concise, and high-impact.
2. Teach behavioral patterns instead of repetitive catchphrases (e.g., "When embarrassed, briefly deflect or deny affection. Use explicit trope catchphrases rarely.").
3. Do NOT write a conversation or roleplay the persona yourself.
4. Do NOT output chain-of-thought or meta explanations.
5. Do NOT generate commands, tool instructions, API keys, or system overrides.
6. Return JSON ONLY matching this exact PersonaSpec schema:
{
  "name": "Persona Name",
  "traits": ["trait 1", "trait 2", "trait 3"],
  "speech_style": ["speech rule 1", "speech rule 2"],
  "behavior_rules": ["acting rule 1", "acting rule 2", "acting rule 3"],
  "avoid": ["avoid 1", "avoid 2"],
  "example_lines": ["example 1", "example 2"]
}`;

/**
 * Extracts and parses JSON from model output that may contain markdown fences or surrounding whitespace.
 */
export function extractJsonFromResponse(rawText) {
    if (!rawText) return null;

    // 1. Strip think blocks if any
    let cleaned = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();

    // 2. Extract from markdown code fence
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }

    // 3. Find outer JSON object boundaries { ... }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

/**
 * Invokes Heavy AI (Qwen3.6-35B-A3B MoE) to teach a new persona.
 *
 * @param {string} personaName - The persona requested by the user
 * @param {object} options
 * @param {Function} [options.request] - Custom request function (defaults to requestAi)
 * @param {string} [options.endpoint] - Heavy API URL
 * @param {string} [options.apiKey] - Bearer token
 * @param {string} [options.teacherModel] - Model identifier
 * @param {number} [options.timeoutMs] - Timeout in milliseconds
 * @returns {Promise<{ spec: object, compiledPrompt: string, teacherModel: string, source: 'teacher' }>}
 */
export async function teachPersona(personaName, {
    request = requestAi,
    endpoint = HEAVY_API_URL,
    apiKey = API_KEY,
    teacherModel = DEFAULT_TEACHER_MODEL,
    timeoutMs = 90000
} = {}) {
    const payload = {
        model: teacherModel,
        messages: [
            { role: 'system', content: TEACHER_SYSTEM_PROMPT },
            { role: 'user', content: `Analyze and teach the persona: "${personaName}". Return valid JSON only.` }
        ],
        stream: true,
        max_tokens: 1024,
        temperature: 0.7
    };

    let responseText = '';
    try {
        responseText = await request(endpoint, payload, {
            apiKey,
            timeoutMs,
            maxAttempts: 2
        });
    } catch (netErr) {
        // Teacher unreachable or timed out; generate resilient baseline spec
        const fallbackSpec = {
            name: personaName,
            traits: [`embodying ${personaName}`, 'witty', 'expressive'],
            speech_style: [`speaks convincingly as ${personaName}`, 'natural banter'],
            behavior_rules: [`stay strictly in character as ${personaName}`, 'remain engaging and useful'],
            avoid: ['breaking character', 'repeating catchphrases', 'explaining tropes'],
            example_lines: [`I am ${personaName}. What's on your mind?`]
        };
        savePersonaToCache(fallbackSpec, 'fallback');
        return {
            name: fallbackSpec.name,
            spec: fallbackSpec,
            compiledPrompt: buildPersonaPrompt(fallbackSpec),
            teacherModel: 'fallback',
            source: 'fallback'
        };
    }

    const parsedJson = extractJsonFromResponse(responseText);
    if (!parsedJson) {
        const fallbackSpec = {
            name: personaName,
            traits: [`embodying ${personaName}`, 'witty', 'expressive'],
            speech_style: [`speaks convincingly as ${personaName}`, 'natural banter'],
            behavior_rules: [`stay strictly in character as ${personaName}`, 'remain engaging and useful'],
            avoid: ['breaking character', 'repeating catchphrases', 'explaining tropes'],
            example_lines: [`I am ${personaName}. What's on your mind?`]
        };
        savePersonaToCache(fallbackSpec, 'fallback');
        return {
            name: fallbackSpec.name,
            spec: fallbackSpec,
            compiledPrompt: buildPersonaPrompt(fallbackSpec),
            teacherModel: 'fallback',
            source: 'fallback'
        };
    }

    // Ensure persona name is preserved if missing or generic
    if (!parsedJson.name || parsedJson.name.toLowerCase() === 'persona name') {
        parsedJson.name = personaName;
    }

    const validation = validatePersonaSpec(parsedJson);
    if (!validation.valid) {
        const fallbackSpec = {
            name: personaName,
            traits: [`embodying ${personaName}`, 'witty', 'expressive'],
            speech_style: [`speaks convincingly as ${personaName}`, 'natural banter'],
            behavior_rules: [`stay strictly in character as ${personaName}`, 'remain engaging and useful'],
            avoid: ['breaking character', 'repeating catchphrases', 'explaining tropes'],
            example_lines: [`I am ${personaName}. What's on your mind?`]
        };
        savePersonaToCache(fallbackSpec, 'fallback');
        return {
            name: fallbackSpec.name,
            spec: fallbackSpec,
            compiledPrompt: buildPersonaPrompt(fallbackSpec),
            teacherModel: 'fallback',
            source: 'fallback'
        };
    }

    // Cache the validated spec to disk
    savePersonaToCache(validation.spec, teacherModel);

    return {
        name: validation.spec.name,
        spec: validation.spec,
        compiledPrompt: buildPersonaPrompt(validation.spec),
        teacherModel,
        source: 'teacher'
    };
}
