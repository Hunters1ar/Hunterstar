import { setTimeout as sleep } from 'node:timers/promises';

export class AiRequestError extends Error {
    constructor(message, { status = 0, retryable = false, retryAfterMs = 0 } = {}) {
        super(message);
        this.name = 'AiRequestError';
        Object.assign(this, { status, retryable, retryAfterMs });
    }
}

export function retryDelay(value, now = Date.now()) {
    if (!value) return 0;
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - now) || 0;
}

export async function requestAi(endpoint, payload, {
    fetchImpl = globalThis.fetch, wait = sleep, timeoutMs = 50000,
    maxAttempts = 3, maxRetryDelayMs = 60000, onRetry = () => {},
} = {}) {
    // Retries request another answer, never rerun a local command.
    const body = JSON.stringify(payload);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let failure;
        try {
            const response = await fetchImpl(endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
            });
            const raw = await response.text();
            let data;
            try { data = JSON.parse(raw); } catch { /* Gateways may return HTML. */ }
            const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
            if (!response.ok || data?.ok === false) {
                const retryable = data?.retryable ?? ([408, 429, 500, 502, 503, 504].includes(response.status));
                const retryAfterMs = Math.max(retryDelay(response.headers.get('retry-after')),
                    Number(data?.retryAfterMs) || 0, Number(detail?.match(/retry in ([\d.]+)s/i)?.[1] || 0) * 1000);
                const fallback = response.status === 429 ? 'The API rate limit was reached.'
                    : retryable ? `The API is temporarily unavailable (HTTP ${response.status}).`
                        : `The API rejected the request (HTTP ${response.status}). Check the API URL and server configuration.`;
                throw new AiRequestError(detail || fallback, { status: response.status, retryable, retryAfterMs });
            }
            const message = data?.data?.choices?.[0]?.message;
            if (message?.tool_calls?.length || message?.function_call) {
                throw new AiRequestError('The provider returned unsupported native tools. Configure a text chat model using the [EXEC] protocol.');
            }
            if (!data?.ok || typeof message?.content !== 'string' || !message.content.trim()) {
                throw new AiRequestError('The API returned an empty or invalid AI response.', { retryable: true });
            }
            return message.content;
        } catch (error) {
            failure = error instanceof AiRequestError ? error : new AiRequestError(
                controller.signal.aborted ? 'The AI request timed out.' : 'Could not connect to the AI API.', { retryable: true });
        } finally { clearTimeout(timer); }
        const delay = Math.max(failure.retryAfterMs, 1000 * 2 ** (attempt - 1));
        if (!failure.retryable || attempt === maxAttempts || delay > maxRetryDelayMs) throw failure;
        onRetry({ attempt, delay, error: failure });
        await wait(delay);
    }
}
