// Provider requests share a deadline shorter than the reverse proxy timeout.
class ProviderError extends Error {
    constructor(message, { status = 502, retryable = false, retryAfterMs = 0 } = {}) {
        super(message);
        Object.assign(this, { status, retryable, retryAfterMs });
    }
}

function getKeys(env) {
    const keys = [];
    for (const [type, prefix, count] of [['openrouter', 'OPEN_ROUTER_API_KEY', 10], ['aistudio', 'AI_STUDIO_API_KEY', 15]]) {
        for (let i = 0; i <= count; i++) {
            const key = env[prefix + (i || '')];
            if (key && !keys.some(entry => entry.type === type && entry.key === key)) keys.push({ type, key });
        }
    }
    return keys;
}

function parseDelay(response, data) {
    const header = response.headers.get('retry-after');
    const headerMs = header ? (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
    const detail = data?.error?.details?.find(item => item.retryDelay)?.retryDelay;
    const text = data?.error?.message || '';
    return Math.max(0, headerMs || 0, parseFloat(detail || '0') * 1000 || 0,
        Number(text.match(/retry in ([\d.]+)s/i)?.[1] || 0) * 1000);
}

function createAiProvider({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now,
    requestTimeoutMs = 12000, totalTimeoutMs = 45000 } = {}) {
    const cooldowns = new Map();
    const modelCache = new Map();

    async function jsonRequest(url, options, deadline) {
        const remaining = deadline - now();
        if (remaining <= 0) throw new ProviderError('AI providers exceeded the request deadline.', { status: 504, retryable: true });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remaining));
        try {
            const response = await fetchImpl(url, { ...options, signal: controller.signal });
            let data;
            try { data = JSON.parse(await response.text()); } catch { /* HTML from a gateway. */ }
            if (!response.ok || data?.error) {
                const status = response.ok ? Number(data?.error?.code) || 502 : response.status;
                throw new ProviderError(`AI provider returned HTTP ${status}.`, {
                    status, retryable: [408, 429, 500, 502, 503, 504].includes(status),
                    retryAfterMs: parseDelay(response, data),
                });
            }
            if (!data) throw new ProviderError('AI provider returned invalid JSON.', { retryable: true });
            return data;
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            // Do not expose provider URLs, keys, or raw responses to clients/logs.
            throw new ProviderError(controller.signal.aborted ? 'AI provider timed out.' : 'AI provider connection failed.', { status: 504, retryable: true });
        } finally { clearTimeout(timer); }
    }

    async function geminiModel(key, deadline) {
        if (env.GEMINI_MODEL) return env.GEMINI_MODEL.replace(/^models\//, '');
        const cached = modelCache.get(key);
        if (cached && cached.until > now()) return cached.model;
        let pageToken;
        const models = [];
        do {
            const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
            url.searchParams.set('pageSize', '1000');
            if (pageToken) url.searchParams.set('pageToken', pageToken);
            const data = await jsonRequest(url, { headers: { 'x-goog-api-key': key } }, deadline);
            models.push(...(data.models || []));
            pageToken = data.nextPageToken;
        } while (pageToken && now() < deadline);
        // Prefer a standard Flash text model, avoiding image/audio specializations.
        const candidates = models.filter(m => m.supportedGenerationMethods?.includes('generateContent')
            && /^models\/gemini-.*flash/.test(m.name)
            && !/image|tts|audio|live|robotics|computer-use/i.test(m.name));
        candidates.sort((a, b) => Number(/preview|exp/.test(a.name)) - Number(/preview|exp/.test(b.name))
            || b.name.localeCompare(a.name, undefined, { numeric: true }));
        if (!candidates.length) throw new ProviderError('No Gemini Flash text model is available. Set GEMINI_MODEL to an available text model.', { status: 503 });
        const model = candidates[0].name.replace(/^models\//, '');
        modelCache.set(key, { model, until: now() + 300000 });
        return model;
    }

    return async function callAiProviderWithFallback(systemContent, messages, { model: requestedModel } = {}) {
        // This route is public: client model selection must not enable arbitrary paid models.
        const allowedModels = [env.OPENROUTER_MODEL || 'dots-studio/dots-3-note-preview:free',
            ...(env.CLI_ALLOWED_MODELS || '').split(',').map(value => value.trim())];
        if (requestedModel && !requestedModel.endsWith(':free') && !allowedModels.includes(requestedModel)) {
            throw new ProviderError('This model is not enabled for the CLI. Choose a :free model or ask the server owner to set CLI_ALLOWED_MODELS.', { status: 400 });
        }
        const keys = getKeys(env);
        if (!keys.length) throw new ProviderError('No AI API keys configured on the server.', { status: 503 });
        const deadline = now() + totalTimeoutMs;
        let lastError;
        let attempts = 0;
        const typeAttempts = new Map();
        const skippedTypes = new Set();
        for (const { type, key } of keys) {
            if (skippedTypes.has(type)) continue;
            if ((typeAttempts.get(type) || 0) >= 2) continue;
            const model = type === 'openrouter' ? (requestedModel || env.OPENROUTER_MODEL || 'dots-studio/dots-3-note-preview:free') : (env.GEMINI_MODEL || 'auto');
            const id = `${type}:${key}:${model}`;
            const cooldown = cooldowns.get(id);
            if (cooldown && cooldown.until > now()) {
                lastError = new ProviderError(cooldown.error.message, { ...cooldown.error, retryAfterMs: cooldown.until - now() });
                continue;
            }
            if (attempts++ >= 4 || now() >= deadline) break;
            typeAttempts.set(type, (typeAttempts.get(type) || 0) + 1);
            try {
                let data;
                if (type === 'openrouter') {
                    data = await jsonRequest('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
                            'HTTP-Referer': 'https://hunterstar.uz', 'X-Title': 'Hunterstar Portfolio' },
                        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemContent }, ...messages] }),
                    }, deadline);
                } else {
                    const selected = await geminiModel(key, deadline);
                    const result = await jsonRequest(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selected)}:generateContent`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
                        body: JSON.stringify({ systemInstruction: { parts: [{ text: systemContent }] },
                            contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }),
                    }, deadline);
                    const parts = result?.candidates?.[0]?.content?.parts || [];
                    data = { choices: [{ message: { content: parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('') } }] };
                }
                const message = data?.choices?.[0]?.message;
                if (!message || message.tool_calls?.length || message.function_call || typeof message.content !== 'string' || !message.content.trim()) {
                    throw new ProviderError('AI provider returned no usable text answer.', { retryable: true });
                }
                cooldowns.delete(id);
                return data;
            } catch (error) {
                lastError = error;
                const delay = error.status === 429 ? Math.max(30000, error.retryAfterMs) : error.retryable ? 5000 : 300000;
                // Bound memory even if a public client supplies many model names.
                if (cooldowns.size >= 500) cooldowns.delete(cooldowns.keys().next().value);
                cooldowns.set(id, { error, until: now() + delay });
                if (error.status === 429) {
                    for (const sibling of keys.filter(entry => entry.type === type)) {
                        cooldowns.set(`${type}:${sibling.key}:${model}`, { error, until: now() + delay });
                    }
                }
                if (error.status === 404 && type === 'aistudio') modelCache.delete(key);
                // Rotating keys does not solve a shared project quota or missing model.
                if ([429, 404].includes(error.status)) skippedTypes.add(type);
            }
        }
        const status = lastError?.status === 429 ? 429 : 503;
        const configuration = lastError && !lastError.retryable;
        throw new ProviderError(configuration
            ? 'AI provider configuration failed. Check server API keys and model availability (OPENROUTER_MODEL / GEMINI_MODEL).'
            : status === 429 ? 'AI provider quota reached. Wait before retrying or check the provider plan.'
                : 'AI providers are temporarily unavailable. Please retry shortly.',
        { status, retryable: !configuration, retryAfterMs: lastError?.retryAfterMs || (status === 429 ? 30000 : 5000) });
    };
}

module.exports = { createAiProvider, ProviderError };
