import fs from 'fs';
import path from 'path';
import { getConfigDir, getConfigValue } from './configManager.js';
import { recordUserLesson } from './memoryManager.js';
import { extractJsonFromResponse } from './personaManager.js';

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

    const username = userContext.username || process.env.USERNAME || process.env.USER || 'Hunte';
    const cwd = userContext.cwd || process.cwd();
    const platform = userContext.platform || process.platform;
    const shell = userContext.shell || 'powershell';

    const teacherSystemPrompt = `You are HunterStar AI Teacher (Heavy Tier 14B).
Your mission: Evaluate the Fast model (1.5B) response to the human user, detect hallucinations or identity confusion, critique the response, and generate the ideal target response for fine-tuning dataset distillation.

HUMAN USER CONTEXT:
- Real human user name: ${username} (the engineer, creator, and owner of this environment)
- Current working directory: ${cwd}
- Platform: ${platform} (${shell})
CRITICAL IDENTITY RULE: The human user is ${username} (Hunte). The user is NOT HunterStar AI! HunterStar AI is the AI assistant. If the user asks "who am i", they are asking about THEMSELVES (${username}), not the assistant.

Respond ONLY with a valid JSON object matching this schema:
{
  "critique": "analysis of Fast response: correctness, tone, hallucinations, identity confusion",
  "ideal_response": "the perfect response Fast should learn to produce",
  "quality_score": 1-10,
  "lesson": "short takeaway rule to remember, or null"
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
            timestamp: new Date().toISOString(),
            prompt,
            user_context: { username, cwd, platform, shell },
            fast_response: fastResponse,
            teacher_critique: critique,
            ideal_response: idealResponse,
            quality_score: qualityScore,
            lesson
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
                    prompt,
                    fast_response: fastResponse,
                    teacher_critique: critique,
                    ideal_response: idealResponse,
                    quality_score: qualityScore,
                    user_context: { username, cwd, platform, shell }
                })
            });
        } catch (e) {
            if (verbose) console.warn('[Teacher Error] Remote intelect sync failed:', e.message);
        }

        // 3. Record lesson if Fast made a significant mistake (score <= 6)
        if (lesson && qualityScore <= 6) {
            recordUserLesson(lesson);
        }

        if (verbose) {
            console.log(`\x1b[90m🧠 [Teacher Engine] Evaluated Fast AI response (Score: ${qualityScore}/10). Dataset entry saved.\x1b[0m`);
        }

        return datasetEntry;
    } catch (err) {
        if (verbose) console.warn('[Teacher Engine Error]', err.message);
        return null;
    }
}
