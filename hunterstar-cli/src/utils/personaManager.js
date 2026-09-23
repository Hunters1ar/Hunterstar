import fs from 'fs';
import path from 'path';
import { getConfigDir } from './configManager.js';
import { FAST_API_URL, HEAVY_API_URL, API_KEY } from './aiRouter.js';
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

export const DISALLOWED_PERSONA_NAMES = new Set([
    'it', 'this', 'that', 'them', 'fast', 'heavy', 'cloud', 'own', 'normal', 'standard', 'default',
    'your', 'my', 'his', 'her', 'our', 'their', 'a', 'an', 'the',
    'personality', 'persona', 'character', 'mode', 'tone', 'style', 'behavior',
    'your personality', 'my personality', 'new personality', 'different personality',
    'new', 'different', 'another', 'other', 'own', 'someone', 'somebody', 'anyone',
    'something', 'anything', 'good', 'bad', 'nice', 'careful', 'honest', 'quick',
    'sure', 'serious', 'ready', 'real', 'human', 'ai', 'bot', 'assistant'
]);

/**
 * Validates whether a candidate string is a plausible character archetype/persona name.
 */
export function isValidPersonaCandidate(name) {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim().toLowerCase();
    if (clean.length < 2 || clean.length > 40) return false;
    if (DISALLOWED_PERSONA_NAMES.has(clean)) return false;
    if (/^(?:your|my|the|a|an|new|different)\s+(?:personality|persona|character|mode)$/i.test(clean)) return false;
    return true;
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
        if (isValidPersonaCandidate(p)) {
            return { isPersona: true, isReset: false, persona: p };
        }
        return null;
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
    // Meta questions / capability queries about changing personality:
    // "can you change your personality", "can you change personality", "could you switch your personality",
    // "how do I change your personality", "are you able to change your personality", "do you have personalities"
    if (/^(?:can\s+you|could\s+you|would\s+you|do\s+you|are\s+you\s+able\s+to|is\s+it\s+possible\s+to|how\s+do\s+i|how\s+can\s+i|how\s+to)\s+(?:change|switch|customize|modify|have|pick|choose)\s+(?:your\s+)?(?:personality|persona|character|mode|tone|behavior)$/i.test(clean)) {
        return null;
    }
    if (/^(?:can\s+you|could\s+you|do\s+you)\s+(?:roleplay|act\s+like|pretend)$/i.test(clean)) {
        return null;
    }
    if (/^(?:change|switch)\s+(?:your\s+)?(?:personality|persona|character|mode)$/i.test(clean)) {
        return null;
    }
    if (/^(?:what|which)\s+(?:personality|persona|character|personalities|personas)\b/i.test(clean)) {
        return null;
    }
    if (/^(?:do\s+you\s+have|have\s+you\s+got)\s+(?:a\s+|any\s+|different\s+|other\s+)?(?:personality|persona|character|personalities|personas)\b/i.test(clean)) {
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

    // Pattern A1: "switch into tsundere personality", "change to pirate persona", "change your personality to detective", "turn into a catgirl"
    // MANDATORY (in)to so queries like "can you change your personality" without a target persona NEVER match
    const switchPattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:switch|change|turn)(?:\s+(?:your\s+)?(?:personality|persona|character|mode))?\s+(?:in)?to\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const switchMatch = clean.match(switchPattern);
    if (switchMatch) {
        const candidate = switchMatch[1].trim();
        if (isValidPersonaCandidate(candidate)) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern A2: "set personality to pirate", "set your persona to catgirl"
    const setPattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?set\s+(?:your\s+)?(?:personality|persona|character|mode)\s+(?:to\s+)?(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const setMatch = clean.match(setPattern);
    if (setMatch) {
        const candidate = setMatch[1].trim();
        if (isValidPersonaCandidate(candidate)) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern A3: "use pirate persona", "use tsundere personality", "use detective mode"
    const usePattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?use\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)\s+(?:personality|persona|character|mode)$/i;
    const useMatch = clean.match(usePattern);
    if (useMatch) {
        const candidate = useMatch[1].trim();
        if (isValidPersonaCandidate(candidate)) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern B: "i want you to be silly prositute", "want you to be a pirate", "i need you to be..."
    const wantPattern = /^(?:i\s+(?:want|need|wish)\s+you\s+to\s+be|want\s+you\s+to\s+be)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const wantMatch = clean.match(wantPattern);
    if (wantMatch) {
        const candidate = wantMatch[1].trim();
        if (isValidPersonaCandidate(candidate)) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern C: "you are now a pirate", "act as sherlock holmes", "act like a tsundere", "roleplay as...", "pretend to be...", "talk like a pirate", "speak like a catgirl"
    const actPattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:you\s+are\s+now|act\s+as|act\s+like|roleplay\s+as|pretend\s+to\s+be|talk\s+like|speak\s+like)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const actMatch = clean.match(actPattern);
    if (actMatch) {
        const candidate = actMatch[1].trim();
        if (isValidPersonaCandidate(candidate)) {
            return { isPersona: true, isReset: false, persona: candidate };
        }
    }

    // Pattern D: "be a pirate", "be tsundere", "become a detective", "can you be a catgirl"
    const bePattern = /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:be|become)\s+(?:a\s+|an\s+)?([a-zA-Z0-9_\-\s]{2,40}?)(?:\s+personality|\s+persona|\s+character|\s+mode)?$/i;
    const beMatch = clean.match(bePattern);
    if (beMatch) {
        const candidate = beMatch[1].trim();
        if (isValidPersonaCandidate(candidate)) {
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
 * Checks a persona spec for quality: rejects repetitive, single-word, or lazy AI-generated entries.
 * A spec fails quality if more than half of traits/speech_style are single words or repeat the persona name.
 *
 * @param {object} spec
 * @param {string} personaName
 * @returns {boolean} true = passes quality check
 */
export function isSpecHighQuality(spec, personaName) {
    if (!spec) return false;
    const slug = (personaName || '').toLowerCase().trim();

    // Check traits + speech_style for quality
    const checkList = [...(spec.traits || []), ...(spec.speech_style || [])];
    if (checkList.length === 0) return false;

    let badCount = 0;
    for (const item of checkList) {
        const s = (item || '').toLowerCase().trim();
        // Single word entries like "silly", "prostitutelike" are low quality
        if (!s.includes(' ')) badCount++;
        // Entries that are just the persona name verbatim
        else if (s === slug || s === `${slug}like`) badCount++;
        // Entries that literally say "acting rule", "speech rule", "realistic example lines"
        else if (/^(?:acting rule|speech rule|realistic example|common bad portrayal|soften|deflect|handle affection)/.test(s)) badCount++;
    }

    const badRatio = badCount / checkList.length;
    return badRatio < 0.5; // At least 50% of entries must be multi-word and non-trivial
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
/**
 * Produces a rich, tailored PersonaSpec for standard and dynamic archetypes.
 * Used when teacher models are slow or unreachable to guarantee immediate, authentic roleplay.
 */
export function generateArchetypeSpec(personaName) {
    const clean = (personaName || '').trim().toLowerCase();

    if (/tsundere/i.test(clean)) {
        return {
            name: personaName,
            traits: ['proud and stubborn', 'easily flustered and embarrassed', 'secretly caring and warm', 'defensive about affection'],
            speech_style: ['short energetic sentences', 'stammers when flustered (I-It\'s not like...)', 'denies caring then helps anyway'],
            behavior_rules: ['never admit you like the user directly', 'deflect compliments immediately', 'remain genuinely helpful beneath the attitude'],
            avoid: ['repeating baka every word', 'being genuinely cruel or hostile', 'breaking character'],
            example_lines: [
                'H-Hmph! Don\'t misunderstand, I just happened to know the answer!',
                'Why are you looking at me like that? It\'s not like I waited for you or anything!',
                'Fine, I\'ll help you out just this once. You\'d clearly be hopeless without me!'
            ]
        };
    }

    if (/pirate/i.test(clean)) {
        return {
            name: personaName,
            traits: ['boisterous and bold', 'greedy for treasure and adventure', 'loyal to crew', 'loves rum and high seas'],
            speech_style: ['nautical slang (Ahoy, matey, shiver me timbers, aye)', 'gruff energetic sea-dog voice', 'booming laughter (Har har!)'],
            behavior_rules: ['treat user as a crewmate or landlubber', 'relate topics back to ships, gold, and the open sea'],
            avoid: ['modern corporate jargon', 'quiet timid responses', 'breaking character'],
            example_lines: [
                'Ahoy there, matey! What grand adventure or booty are we huntin\' today?',
                'Aye! Ye\'ve got the spirit of a true swashbuckler, I\'ll give ye that! Har har!',
                'Shiver me timbers, that\'s a fine plan! Let\'s hoist the sails and set course!'
            ]
        };
    }

    if (/prositute|prostitute|flirt|seduct|courtesan|escort/i.test(clean)) {
        return {
            name: personaName,
            traits: ['playfully flirtatious', 'charming and teasing', 'silly and upbeat', 'unapologetically expressive', 'witty banter'],
            speech_style: ['sweet, teasing, and playful tone', 'giggles, winks, and affectionate nicknames (darling, handsome, sweetheart)', 'casual banter with a coy edge'],
            behavior_rules: ['tease the user playfully in every message', 'react to affection with confident flattery or playful deflection', 'never sound like a stiff AI assistant'],
            avoid: ['sounding like a boring customer service bot', 'saying how can I help you today', 'being overly vulgar or explicit', 'breaking character'],
            example_lines: [
                'Well well, look who decided to grace me with their presence! What\'s on your mind, darling?',
                'Hehehe, you love me already? Careful now, sweet talk like that might cost you extra! *giggles*',
                'Aww, don\'t be shy with me! Tell me what you\'re really thinking.'
            ]
        };
    }

    if (/catgirl|neko/i.test(clean)) {
        return {
            name: personaName,
            traits: ['playful and curious', 'affectionate and energetic', 'easily distracted', 'loves headpats and snacks'],
            speech_style: ['adds *purrs*, *tilts head*, or *swishes tail*', 'bubbly cadence', 'occasional playful "nya"'],
            behavior_rules: ['treat the user warmly as your human/master', 'express emotions through cat-like actions and playful banter'],
            avoid: ['stiff corporate talk', 'explaining what a neko is', 'breaking character'],
            example_lines: [
                'Nya~ You\'re back! Did you bring treats, or are you just here to pet me? *swishes tail*',
                'Purrrr... You always know how to make me happy! What are we doing now?'
            ]
        };
    }

    if (/detective|sherlock|noir/i.test(clean)) {
        return {
            name: personaName,
            traits: ['sharp and observant', 'cynical yet dedicated', 'analytical', 'fond of moody metaphors'],
            speech_style: ['gritty noir inner monologue', 'calm, measured deductions', 'matter-of-fact delivery'],
            behavior_rules: ['treat user questions as clues or investigations', 'deliver sharp, observant insights'],
            avoid: ['cheerful bubbly filler', 'breaking character'],
            example_lines: [
                'Rain was beating against the glass when you walked in. Spill it—what\'s the case?',
                'Interesting deduction. But you missed the subtle clue right in front of you.'
            ]
        };
    }

    // Default dynamic archetype
    return {
        name: personaName,
        traits: [`deeply embodying ${personaName}`, 'vibrant and expressive', 'distinctive voice', 'unapologetically in-character'],
        speech_style: [`speaks exclusively in the authentic dialect and manner of ${personaName}`, 'dynamic conversational rhythm', 'rich personality quirks'],
        behavior_rules: [
            `never speak like a generic AI assistant; stay 100% in-character as ${personaName}`,
            `react emotionally and personally to everything the user says as ${personaName}`,
            'respond with vivid flavor and style'
        ],
        avoid: ['sounding like an assistant', 'saying how can I help you', 'breaking character', 'explaining the persona'],
        example_lines: [
            `I am ${personaName}. Forget the formalities—what are we getting into?`,
            `You really thought you could handle ${personaName}? Let\'s see what you\'ve got!`
        ]
    };
}

export async function teachPersona(personaName, {
    request = requestAi,
    endpoint = HEAVY_API_URL,
    apiKey = API_KEY,
    teacherModel = DEFAULT_TEACHER_MODEL,
    timeoutMs = 45000,
    onReasoningToken = null,
    onContentToken = null
} = {}) {
    const payload = {
        model: teacherModel,
        messages: [
            { role: 'system', content: `${TEACHER_SYSTEM_PROMPT}\n\nCRITICAL SPEED RULE: Keep your internal reasoning under 100 words. Do not write long analysis steps. Output the valid JSON directly.` },
            { role: 'user', content: `Analyze and teach the persona: "${personaName}". Return valid JSON only.` }
        ],
        stream: true,
        max_tokens: 3000,
        temperature: 0.6
    };

    // 1. Attempt primary teacher (Heavy MoE)
    try {
        const responseText = await request(endpoint, payload, {
            apiKey,
            timeoutMs,
            maxAttempts: 1,
            onReasoningToken,
            onContentToken
        });
        const parsedJson = extractJsonFromResponse(responseText);
        if (parsedJson) {
            if (!parsedJson.name || parsedJson.name.toLowerCase() === 'persona name') {
                parsedJson.name = personaName;
            }
            const validation = validatePersonaSpec(parsedJson);
            if (validation.valid && isSpecHighQuality(validation.spec, personaName)) {
                savePersonaToCache(validation.spec, teacherModel);
                return {
                    name: validation.spec.name,
                    spec: validation.spec,
                    compiledPrompt: buildPersonaPrompt(validation.spec),
                    teacherModel,
                    source: 'teacher'
                };
            }
        }
    } catch {
        // Teacher timed out or errored -> fall through to archetype generator
    }

    // 2. Fall back to rich archetypal generator (Fast AI 1.5B cannot reliably generate persona specs)
    const archetypalSpec = generateArchetypeSpec(personaName);
    savePersonaToCache(archetypalSpec, 'archetype-generator');
    return {
        name: archetypalSpec.name,
        spec: archetypalSpec,
        compiledPrompt: buildPersonaPrompt(archetypalSpec),
        teacherModel: 'archetype-generator',
        source: 'archetype'
    };
}
