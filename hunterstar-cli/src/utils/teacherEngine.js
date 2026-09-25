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
 * Fetches active rules and lessons taught by Heavy AI for this specific user.
 * Cached in-memory to prevent adding latency to Fast AI turns.
 */
export async function fetchActiveInstructions({
    userId,
    intelectUrl = 'https://heavy.moonlightsoldiers.xyz/intelect/instructions',
    fetchImpl = globalThis.fetch,
    maxAgeMs = 30000
} = {}) {
    const resolvedUser = (userId || process.env.HUNTERSTAR_USER || process.env.USERNAME || process.env.USER || 'guest').toLowerCase();
    const cached = activeInstructionsCache.get(resolvedUser);
    if (cached && (Date.now() - cached.timestamp < maxAgeMs)) {
        return cached.instructions;
    }

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
            activeInstructionsCache.set(resolvedUser, { instructions: list, timestamp: Date.now() });
            return list;
        }
    } catch {
        // Fall back to cached or empty on timeout/network issue
    }
    return cached ? cached.instructions : [];
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
Your mission: Evaluate the Fast model (1.5B) student response to the active human user (${sessionContext.userId}).
Detect hallucinations or identity confusion, critique the response, and generate the ideal target response for fine-tuning dataset distillation.

ACTIVE SESSION CONTEXT:
- Active human user: ${sessionContext.userId} (the engineer, creator, and owner of this session)
- Working directory: ${sessionContext.cwd}
- Platform: ${sessionContext.platform} (${sessionContext.shell})

CRITICAL IDENTITY RULES:
1. The human user is "${sessionContext.userId}". HunterStar AI is the AI assistant.
2. If asked "who am i", Fast AI must identify the human user as "${sessionContext.userId}".
3. If Fast AI calls itself the user, penalize quality_score (<= 4).
4. Formulate a generalized takeaway lesson targeting ${sessionContext.userId} (e.g., "When the prompt asks identity, resolve to the current user (${sessionContext.userId}).").

Respond ONLY with a valid JSON object matching this schema:
{
  "critique": "analysis of Fast response: correctness, tone, hallucinations, identity confusion",
  "ideal_response": "the perfect response Fast should produce for ${sessionContext.userId}",
  "quality_score": 1-10,
  "lesson": "generalized behavioral lesson targeting ${sessionContext.userId}"
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
            max_tokens: 384
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
        const lesson = parsed.lesson || null;

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
