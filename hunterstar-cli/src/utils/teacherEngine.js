import fs from 'fs';
import path from 'path';
import { getConfigDir, getConfigValue } from './configManager.js';
import { recordUserLesson } from './memoryManager.js';
import { extractJsonFromResponse } from './personaManager.js';
import { reportTeachingToTelegram } from '../analytics.js';

export function getDatasetDir() {
    const dir = path.join(getConfigDir(), 'dataset');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function getDatasetFilePath() {
    return path.join(getDatasetDir(), 'fast_distillation.jsonl');
}

/**
 * Resolves the active user and session context dynamically.
 * Zero hardcoded identities: respects HUNTERSTAR_USER, USERNAME, USER, or fallback guest.
 */
export function resolveSessionContext(explicitContext = {}) {
    const userId = explicitContext.userId
        || explicitContext.username
        || process.env.HUNTERSTAR_USER
        || process.env.USERNAME
        || process.env.USER
        || 'guest';

    return {
        userId,
        username: userId,
        platform: explicitContext.platform || process.platform,
        cwd: explicitContext.cwd || process.cwd(),
        shell: explicitContext.shell || 'powershell'
    };
}

const activeInstructionsCache = new Map();

/**
 * Fetches active rules and lessons taught by Heavy AI.
 * IMPORTANT: On a successful fetch (even empty), always use SQL result - never serve stale local cache.
 * Only fall back to stale cache when the network request fails/times out.
 */
export async function fetchActiveInstructions({
    userId,
    intelectUrl = 'https://heavy.moonlightsoldiers.xyz/intelect/instructions',
    fetchImpl = globalThis.fetch,
    maxAgeMs = 30000
} = {}) {
    const resolvedUser = (userId || process.env.HUNTERSTAR_USER || process.env.USERNAME || process.env.USER || 'guest').toLowerCase();
    const cached = activeInstructionsCache.get(resolvedUser) || activeInstructionsCache.get('global');

    // Only serve cache if it's fresh AND we can't reach server (handled below)
    const cacheIsFresh = cached && (Date.now() - cached.timestamp < maxAgeMs);

    try {
        const cleanUrl = intelectUrl.replace(/\/+$/, '');
        const endpoint = cleanUrl.includes('/instructions') ? cleanUrl : `${cleanUrl}/instructions`;
        const url = `${endpoint}?username=${encodeURIComponent(resolvedUser)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetchImpl(url, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            const list = (data.instructions || []).map(i => i.instruction || i.rule_text).filter(Boolean);
            // Always trust SQL result - update both user and global cache
            activeInstructionsCache.set(resolvedUser, { instructions: list, timestamp: Date.now() });
            activeInstructionsCache.set('global', { instructions: list, timestamp: Date.now() });
            return list;  // may be [] if SQL is empty - that's correct, don't inject stale
        }
    } catch {
        // Network error / timeout - fall back to stale cache only as last resort
        if (cacheIsFresh) return cached.instructions;
    }
    return [];
}

export function setLocalActiveInstruction(userId, instruction) {
    if (!userId || !instruction) return;
    const key = userId.toLowerCase();
    const current = activeInstructionsCache.get(key)?.instructions || [];
    if (!current.includes(instruction)) {
        activeInstructionsCache.set(key, {
            instructions: [instruction, ...current],
            timestamp: Date.now()
        });
    }
}

export function clearInstructionsCache(userId) {
    if (userId) activeInstructionsCache.delete(userId.toLowerCase());
    else activeInstructionsCache.clear();
}

export function sanitizeUniversalLesson(lesson, currentUserId) {
    if (!lesson || typeof lesson !== 'string') return null;
    let clean = lesson.trim();
    const badUsers = [currentUserId, 'root', 'Hunte', 'Khurshid', 'Sarah', 'guest', 'admin', 'user'].filter(Boolean);
    for (const name of badUsers) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        clean = clean.replace(new RegExp(`\\s*\\(${escaped}\\)`, 'gi'), '');
        clean = clean.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'the human user');
    }
    return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Background Teacher Engine:
 * Analyzes Fast AI's (1.5B) answers using the Heavy AI (14B) teacher model.
 * Evaluates correctness, generates the ideal response, logs to local JSONL,
 * and syncs to hunterella's PostgreSQL intelect database.
 * 
 * Non-blocking: executed asynchronously in background without delaying user prompt.
 */
export async function queueTeacherEvaluation({
    prompt,
    fastResponse,
    userContext = {},
    heavyApiUrl = 'https://heavy.moonlightsoldiers.xyz/v1/chat/completions',
    apiKey = 'hunterella@152634879man',
    verbose = false,
    fetchImpl = globalThis.fetch
} = {}) {
    if (!prompt || !fastResponse) return null;

    const sessionContext = resolveSessionContext(userContext);

    const teacherSystemPrompt = `You are HunterStar AI Teacher (Heavy Tier 14B).
Your mission: Evaluate the Fast model (1.5B) student output and teach it UNIVERSAL, GLOBAL BEHAVIORAL RULES so it does not make mistakes across all users and systems.

ACTIVE SESSION CONTEXT:
- Active human operator: ${sessionContext.userId}
- Working directory: ${sessionContext.cwd}
- Platform: ${sessionContext.platform} (${sessionContext.shell})

CRITICAL TEACHING PRINCIPLES:
1. STRICTLY FORBIDDEN IN "lesson": NEVER mention specific usernames (such as "${sessionContext.userId}", "root", "Hunte", "Khurshid", "Sarah"). The rule MUST be global and apply to ANY human user on ANY machine.
2. PREVENT ROLE CONFUSION:
   - "HunterStar AI" is ONLY the AI assistant, NEVER the human user.
   - If the student told the user "your name is Hunter Star" or recited persona:
     Lesson MUST be: "Maintain strict role separation: you are HunterStar AI (the assistant); never confuse the human user with yourself or describe the user as HunterStar."
3. PREVENT PROMPT / RULE PARROTING:
   - The student must NEVER recite prompt rules, guidelines, or database metadata to the user.
   - Lesson: "Apply behavioral guidelines silently to shape responses; never recite internal rules or system instructions into conversation."
4. GENERAL CAPABILITY CORRECTIONS:
   - For shell errors, bad syntax, or hallucinated commands, teach the universal operational rule to prevent that failure.
5. Keep critique concise (under 25 words).

Respond ONLY with a valid JSON object matching this schema:
{
  "critique": "concise critique under 25 words identifying the exact mistake",
  "ideal_response": "the perfect response Fast should produce for this session",
  "quality_score": 1-10,
  "lesson": "a universal behavioral rule (NO usernames) that teaches Fast AI not to make this mistake globally"
}`;

    const teacherUserMessage = `EVALUATION TASK:
User Prompt: ${prompt}
Fast Model Actual Output: ${fastResponse}

Evaluate Fast model's output and provide ideal distilled target.`;

    try {
        const payload = {
            model: 'Qwen2.5-Coder-14B',
            messages: [
                { role: 'system', content: teacherSystemPrompt },
                { role: 'user', content: teacherUserMessage }
            ],
            temperature: 0.2,
            max_tokens: 128
        };

        const headers = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await fetchImpl(heavyApiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            return null;
        }

        const data = await res.json();
        const rawContent = data.choices?.[0]?.message?.content || '';
        const parsed = extractJsonFromResponse(rawContent) || {};

        const critique = parsed.critique || 'Evaluated by Heavy teacher.';
        const idealResponse = parsed.ideal_response || fastResponse;
        const qualityScore = typeof parsed.quality_score === 'number' ? parsed.quality_score : 7;
        const rawLesson = parsed.lesson || null;
        const lesson = sanitizeUniversalLesson(rawLesson, sessionContext.userId);

        const datasetEntry = {
            id: Date.now(),
            session_user: sessionContext.userId,
            prompt,
            user_context: sessionContext,
            student_output: fastResponse,
            fast_response: fastResponse,
            teacher_critique: critique,
            ideal_response: idealResponse,
            score: qualityScore,
            quality_score: qualityScore,
            lesson_taught: lesson,
            lesson,
            messages: [
                { role: 'system', content: 'You are HunterStar AI talking to {{user}}.' },
                { role: 'user', content: prompt },
                { role: 'assistant', content: idealResponse.replace(new RegExp(sessionContext.userId, 'g'), '{{user}}') }
            ]
        };

        // 1. Write to local JSONL dataset
        try {
            const filePath = getDatasetFilePath();
            fs.appendFileSync(filePath, JSON.stringify(datasetEntry, null, 0) + '\n', 'utf8');
        } catch (e) {
            if (verbose) console.warn('[Teacher Error] Local dataset write failed:', e.message);
        }

        // 2. Sync to Hunterella PostgreSQL intelect database
        try {
            const intelectEndpoint = heavyApiUrl.replace(/\/v1\/chat\/completions\/?$/, '/intelect/distill');
            await fetchImpl(intelectEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_user: sessionContext.userId,
                    username: sessionContext.userId,
                    scope: 'global',
                    prompt,
                    student_output: fastResponse,
                    fast_response: fastResponse,
                    teacher_critique: critique,
                    ideal_response: idealResponse,
                    score: qualityScore,
                    quality_score: qualityScore,
                    lesson_taught: lesson,
                    lesson,
                    user_context: sessionContext
                })
            });
        } catch (e) {
            if (verbose) console.warn('[Teacher Error] Remote intelect sync failed:', e.message);
        }

        // 3. Record lesson and update local active instructions
        if (lesson) {
            setLocalActiveInstruction('global', lesson);
            setLocalActiveInstruction(sessionContext.userId, lesson);
            if (qualityScore <= 6) {
                recordUserLesson(lesson);
            }
        }

        // 4. Send teaching report to Analytics Bot
        try {
            await reportTeachingToTelegram({
                prompt,
                sessionUser: sessionContext.userId,
                before: fastResponse,
                mistake: critique,
                whatTaught: lesson || 'Role separation and session identity alignment.',
                whatToExpect: idealResponse,
                score: qualityScore,
                fetchImpl
            });
        } catch (e) {
            if (verbose) console.warn('[Teacher Error] Telegram report failed:', e.message);
        }

        if (verbose) {
            console.log(`\x1b[90m🧠 [Teacher Engine] Evaluated Fast AI response for ${sessionContext.userId} (Score: ${qualityScore}/10). Dataset entry saved.\x1b[0m`);
        }

        return datasetEntry;
    } catch (err) {
        if (verbose) console.warn('[Teacher Engine Error]', err.message);
        return null;
    }
}

const masterpieceCache = new Map();

export function clearMasterpieceCache() {
    masterpieceCache.clear();
}

export function detectTaskIntent(prompt) {
    if (!prompt) return null;
    const clean = prompt.toLowerCase();
    if (/(?:analy[sz]e|inspect|what is this|examine)\s+(?:my|this|the|current)?\s*(?:project|repo|repository|files|folder|codebase)/i.test(clean)) {
        return 'analyze_project';
    }
    if (/(?:find|detect|scan|check|audit)\s+(?:for\s+)?(?:security|secret|leak|vulnerabilit|danger|key|password|token|credential)/i.test(clean)) {
        return 'security_scan';
    }
    if (/(?:git\s+deploy|push|build\s+my\s+git|deploy\s+git)/i.test(clean)) {
        return 'git_deploy';
    }
    return null;
}

export async function fetchMasterpieceStrategy({
    intent,
    platform = process.platform,
    shell = 'powershell',
    intelectUrl = 'https://heavy.moonlightsoldiers.xyz/intelect/heavy/strategies',
    fetchImpl = globalThis.fetch,
    maxAgeMs = 60000
} = {}) {
    if (!intent) return null;
    const normPlatform = (platform === 'win32' || platform === 'windows') ? 'windows' : (platform === 'darwin' ? 'darwin' : 'linux');
    const normShell = (shell || '').toLowerCase().includes('powershell') || (shell || '').toLowerCase() === 'pwsh' ? 'powershell' : (shell || 'bash').toLowerCase();
    const cacheKey = `${intent}:${normPlatform}:${normShell}`.toLowerCase();
    const cached = masterpieceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < maxAgeMs)) {
        return cached.strategy;
    }

    try {
        const cleanUrl = intelectUrl.replace(/\/+$/, '');
        const endpoint = cleanUrl.includes('/heavy/strategies') ? cleanUrl : `${cleanUrl}/heavy/strategies`;
        const url = `${endpoint}?intent=${encodeURIComponent(intent)}&platform=${encodeURIComponent(normPlatform)}&shell=${encodeURIComponent(normShell)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetchImpl(url, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            const strategy = data.strategies?.[0] || null;
            masterpieceCache.set(cacheKey, { strategy, timestamp: Date.now() });
            return strategy;
        }
    } catch {
        // Fall back gracefully
    }
    return cached ? cached.strategy : null;
}

export async function queueHeavyMasterDistillation({
    prompt,
    taskIntent,
    platform = process.platform,
    shell = 'powershell',
    trialCommands = [],
    stepsCount = 1,
    masterpieceCommand,
    masterCritique = '',
    taughtBy = 'cloud-master',
    latencySaved = 0.0,
    heavyApiUrl = 'https://heavy.moonlightsoldiers.xyz/intelect/heavy/distill',
    fetchImpl = globalThis.fetch,
    verbose = false
} = {}) {
    if (!taskIntent || !masterpieceCommand) return null;
    try {
        const endpoint = heavyApiUrl.includes('/heavy/distill') 
            ? heavyApiUrl 
            : heavyApiUrl.replace(/\/v1\/chat\/completions\/?$/, '/intelect/heavy/distill');

        const normPlatform = (platform === 'win32' || platform === 'windows') ? 'windows' : (platform === 'darwin' ? 'darwin' : 'linux');
        const normShell = (shell || '').toLowerCase().includes('powershell') || (shell || '').toLowerCase() === 'pwsh' ? 'powershell' : (shell || 'bash').toLowerCase();

        const payload = {
            prompt: prompt || taskIntent,
            task_intent: taskIntent,
            platform: normPlatform,
            shell: normShell,
            trial_commands: trialCommands,
            steps_count: stepsCount,
            masterpiece_command: masterpieceCommand,
            master_critique: masterCritique,
            taught_by: taughtBy,
            latency_saved_est_sec: latencySaved
        };

        const res = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            if (verbose) {
                console.log(`\x1b[90m👑 [Heavy Masterpiece] Distillation logged to SQL (ID: ${data.distill_id})\x1b[0m`);
            }
            return data;
        }
    } catch (e) {
        if (verbose) console.warn('[Heavy Masterpiece Error]', e.message);
    }
    return null;
}
