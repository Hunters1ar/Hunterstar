import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

export function createStreamParser({ onReasoningToken = () => {}, onContentToken = () => {} } = {}) {
    const state = {
        content: '',
        reasoningContent: '',
        inThinkTag: false,
        isDone: false,
        finishReason: null
    };

    function handleReasoningChunk(chunk) {
        if (!chunk) return;
        state.reasoningContent += chunk;
        if (onReasoningToken) onReasoningToken(chunk);
    }

    function handleContentChunk(chunk) {
        if (!chunk) return;
        let remaining = chunk;
        while (remaining.length > 0) {
            if (!state.inThinkTag) {
                const thinkStart = remaining.indexOf('<think>');
                if (thinkStart !== -1) {
                    const before = remaining.slice(0, thinkStart);
                    if (before) {
                        state.content += before;
                        if (onContentToken) onContentToken(before);
                    }
                    state.inThinkTag = true;
                    remaining = remaining.slice(thinkStart + 7);
                } else {
                    state.content += remaining;
                    if (onContentToken) onContentToken(remaining);
                    break;
                }
            } else {
                const thinkEnd = remaining.indexOf('</think>');
                if (thinkEnd !== -1) {
                    const thinkText = remaining.slice(0, thinkEnd);
                    handleReasoningChunk(thinkText);
                    state.inThinkTag = false;
                    remaining = remaining.slice(thinkEnd + 8);
                } else {
                    handleReasoningChunk(remaining);
                    break;
                }
            }
        }
    }

    function parseLine(line) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') {
            state.isDone = true;
            return;
        }
        let json;
        try {
            json = JSON.parse(dataStr);
        } catch {
            return;
        }
        const choice = json.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) {
            state.finishReason = choice.finish_reason;
        }
        const delta = choice.delta;
        if (!delta) return;

        const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
            handleReasoningChunk(reasoning);
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
            handleContentChunk(delta.content);
        }
    }

    return { state, parseLine, handleReasoningChunk, handleContentChunk };
}

function canUseCurl() {
    return process.platform === 'win32';
}

function curlStreamRequest(endpoint, payload, { headers = {}, timeoutMs = 60000, onReasoningToken, onContentToken }) {
    return new Promise((resolve, reject) => {
        const tempFile = path.join(os.tmpdir(), `hs_payload_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
        try {
            fs.writeFileSync(tempFile, JSON.stringify(payload));
        } catch (e) {
            return reject(e);
        }

        const cleanup = () => {
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
        };

        const args = ['-s', '-N', '-g', '--max-time', String(Math.max(10, Math.ceil(timeoutMs / 1000))), '-X', 'POST', endpoint];
        for (const [k, v] of Object.entries(headers)) {
            args.push('-H', `${k}: ${v}`);
        }
        args.push('-d', `@${tempFile}`);

        let proc;
        try {
            proc = spawn('curl.exe', args, { windowsHide: true });
        } catch (err) {
            cleanup();
            return reject(err);
        }

        const parser = createStreamParser({ onReasoningToken, onContentToken });
        let buffer = '';
        let rawOutput = '';

        proc.stdout.on('data', chunk => {
            const str = chunk.toString();
            rawOutput += str;
            buffer += str;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                parser.parseLine(line);
            }
        });

        proc.stderr.on('data', () => {});

        proc.on('close', code => {
            cleanup();
            if (buffer.trim()) {
                parser.parseLine(buffer);
            }

            const { content, reasoningContent } = parser.state;
            if (content.trim() || reasoningContent.trim()) {
                return resolve(content.trim() ? content : reasoningContent);
            }

            try {
                const data = JSON.parse(rawOutput);
                const message = data?.choices?.[0]?.message;
                const reasoning = message?.reasoning_content || message?.reasoning || message?.thinking || '';
                const text = message?.content || '';
                if (text.trim() || reasoning.trim()) {
                    if (reasoning && onReasoningToken) onReasoningToken(reasoning);
                    if (text && onContentToken) onContentToken(text);
                    return resolve(text.trim() ? text : reasoning);
                }
                const errDetail = data?.error?.message || data?.error;
                if (errDetail) {
                    return reject(new AiRequestError(typeof errDetail === 'string' ? errDetail : 'API error', { retryable: true }));
                }
            } catch {}

            if (code !== 0) {
                return reject(new AiRequestError(`The AI API connection failed (curl exit code ${code}).`, { retryable: true }));
            }
            return reject(new AiRequestError('The API returned an empty or invalid AI response.', { retryable: true }));
        });

        proc.on('error', err => {
            cleanup();
            reject(err);
        });
    });
}

export async function requestAi(endpoint, payload, {
    fetchImpl = globalThis.fetch, wait = sleep, timeoutMs = 50000,
    maxAttempts = 3, maxRetryDelayMs = 60000, onRetry = () => {},
    headers = {}, apiKey = null,
    onReasoningToken = null, onContentToken = null,
} = {}) {
    // Retries request another answer, never rerun a local command.
    const body = JSON.stringify(payload);
    const requestHeaders = { 'Content-Type': 'application/json', ...headers };
    if (apiKey) {
        requestHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    const preferCurl = fetchImpl === globalThis.fetch && canUseCurl() && endpoint.includes('moonlightsoldiers');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let failure;
        try {
            if (preferCurl) {
                const result = await curlStreamRequest(endpoint, payload, {
                    headers: requestHeaders,
                    timeoutMs,
                    onReasoningToken,
                    onContentToken,
                });
                return result;
            }

            const response = await fetchImpl(endpoint, {
                method: 'POST', headers: requestHeaders, body, signal: controller.signal,
            });

            const contentType = response.headers?.get?.('content-type') || '';
            const isEventStream = contentType.includes('text/event-stream');

            if (!response.ok) {
                const raw = await response.text();
                let data;
                try { data = JSON.parse(raw); } catch { /* Gateways may return HTML. */ }
                const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
                const retryable = data?.retryable ?? ([408, 429, 500, 502, 503, 504].includes(response.status));
                const retryAfterMs = Math.max(retryDelay(response.headers?.get?.('retry-after')),
                    Number(data?.retryAfterMs) || 0, Number(detail?.match(/retry in ([\d.]+)s/i)?.[1] || 0) * 1000);
                const fallback = response.status === 429 ? 'The API rate limit was reached.'
                    : retryable ? `The API is temporarily unavailable (HTTP ${response.status}).`
                        : `The API rejected the request (HTTP ${response.status}). Check the API URL and server configuration.`;
                throw new AiRequestError(detail || fallback, { status: response.status, retryable, retryAfterMs });
            }

            if (isEventStream && response.body && typeof response.body.getReader === 'function') {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const parser = createStreamParser({ onReasoningToken, onContentToken });
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (const line of lines) {
                        parser.parseLine(line);
                    }
                    if (parser.state.isDone) break;
                }
                if (buffer.trim()) {
                    parser.parseLine(buffer);
                }

                const { content, reasoningContent } = parser.state;
                if (!content.trim() && !reasoningContent.trim()) {
                    throw new AiRequestError('The API returned an empty or invalid AI response.', { retryable: true });
                }
                return content.trim() ? content : reasoningContent;
            }

            const raw = await response.text();
            let data;
            try { data = JSON.parse(raw); } catch { /* Gateways may return HTML. */ }
            const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
            if (data?.ok === false) {
                const retryable = data?.retryable ?? true;
                throw new AiRequestError(detail || 'The API returned an error response.', { status: response.status, retryable });
            }

            const message = data?.data?.choices?.[0]?.message || data?.choices?.[0]?.message;
            if (message?.tool_calls?.length || message?.function_call) {
                throw new AiRequestError('The provider returned unsupported native tools. Configure a text chat model using the [EXEC] protocol.');
            }

            let content = typeof message?.content === 'string' ? message.content : '';
            let reasoning = typeof (message?.reasoning_content ?? message?.reasoning ?? message?.thinking) === 'string'
                ? (message?.reasoning_content ?? message?.reasoning ?? message?.thinking)
                : '';

            const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch) {
                reasoning = (reasoning ? reasoning + '\n' : '') + thinkMatch[1].trim();
                content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            }

            if (reasoning && onReasoningToken) {
                onReasoningToken(reasoning);
            }
            if (content && onContentToken) {
                onContentToken(content);
            }

            const finalResult = content.trim() ? content : reasoning;
            if (!finalResult.trim()) {
                throw new AiRequestError('The API returned an empty or invalid AI response.', { retryable: true });
            }
            return finalResult;
        } catch (error) {
            if (fetchImpl === globalThis.fetch && canUseCurl() && !preferCurl) {
                try {
                    const curlResult = await curlStreamRequest(endpoint, payload, {
                        headers: requestHeaders,
                        timeoutMs,
                        onReasoningToken,
                        onContentToken,
                    });
                    return curlResult;
                } catch {
                    // ignore curl error and retain original failure
                }
            }
            failure = error instanceof AiRequestError ? error : new AiRequestError(
                controller.signal.aborted ? 'The AI request timed out.' : 'Could not connect to the AI API.', { retryable: true });
        } finally { clearTimeout(timer); }
        const delay = Math.max(failure.retryAfterMs, 1000 * 2 ** (attempt - 1));
        if (!failure.retryable || attempt === maxAttempts || delay > maxRetryDelayMs) throw failure;
        onRetry({ attempt, delay, error: failure });
        await wait(delay);
    }
}
