import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { requestAi, AiRequestError, retryDelay } from '../src/utils/aiTransport.js';
import { parseAiCommand } from '../src/utils/aiProtocol.js';
import { isUserCancellation } from '../src/utils/errors.js';
import { startAiChat, parseToolCall } from '../src/commands/ai.js';

const success = content => new Response(JSON.stringify({ ok: true, data: { choices: [{ message: { content } }] } }));
const platformInfo = { os: 'windows', osDisplayName: 'Windows', shell: 'powershell', shellPath: 'powershell.exe', isWindows: true, commandSeparator: ';' };

test('HTML 504 retries the same request and returns the recovered answer', async () => {
    const bodies = [], waits = [];
    const answer = await requestAi('https://example.test', { messages: [{ role: 'user', content: 'hello' }] }, {
        fetchImpl: async (_, options) => { bodies.push(options.body); return bodies.length === 1 ? new Response('<html>504</html>', { status: 504 }) : success('Recovered'); },
        wait: async ms => waits.push(ms),
    });
    assert.equal(answer, 'Recovered');
    assert.deepEqual(waits, [1000]);
    assert.equal(bodies[0], bodies[1]);
});

test('429 honors retry-after header and legacy Gemini retry text', async () => {
    for (const [headers, error, expected] of [
        [{ 'Retry-After': '4' }, 'Too many messages', 4000],
        [{}, 'Quota exceeded. Please retry in 23.440343911s.', 23440.343911],
    ]) {
        let calls = 0;
        const waits = [];
        await requestAi('https://example.test', {}, {
            fetchImpl: async () => ++calls === 1 ? new Response(JSON.stringify({ ok: false, error }), { status: 429, headers }) : success('ok'),
            wait: async ms => waits.push(ms),
        });
        assert.equal(waits[0], expected);
    }
    const now = Date.parse('2026-09-17T00:00:00Z');
    assert.equal(retryDelay('Thu, 17 Sep 2026 00:00:05 GMT', now), 5000);
});

test('long cooldown, authentication, and configuration failures do not retry', async () => {
    for (const response of [
        new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } }),
        new Response('{}', { status: 401 }),
        new Response(JSON.stringify({ ok: false, retryable: false, error: 'Invalid model' }), { status: 503 }),
    ]) {
        let calls = 0;
        await assert.rejects(requestAi('https://example.test', {}, { fetchImpl: async () => { calls++; return response; }, wait: async () => assert.fail('must not wait') }), AiRequestError);
        assert.equal(calls, 1);
    }
});

test('invalid/empty replies have a finite retry budget', async () => {
    for (const body of ['<html>bad</html>', '{invalid', '{"ok":true,"data":{}}', '{"ok":true,"data":{"choices":[{"message":{"content":""}}]}}']) {
        let calls = 0;
        await assert.rejects(requestAi('https://example.test', {}, { fetchImpl: async () => { calls++; return new Response(body); }, wait: async () => {} }), AiRequestError);
        assert.equal(calls, 3);
    }
});

test('timeout aborts fetch and body reads; retries stay bounded', async () => {
    for (const duringBody of [false, true]) {
        let calls = 0;
        await assert.rejects(requestAi('https://example.test', {}, {
            timeoutMs: 5, maxAttempts: 2, wait: async () => {},
            fetchImpl: async (_, { signal }) => {
                calls++;
                const stalled = () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
                return duringBody ? { text: stalled } : stalled();
            },
        }), /timed out/);
        assert.equal(calls, 2);
    }
});

test('malformed, multiple, mixed, and unknown tool calls cannot partially execute', () => {
    for (const text of ['[EXEC]git status', '[EXEC][/EXEC]', '[EXEC]pwd[/EXEC][EXEC]ls[/EXEC]', '<invoke name="unknown"></invoke>']) {
        assert.ok(parseAiCommand(text).error);
    }
    for (const text of ['<invoke name="exec"><parameter name="command">git status', '<invoke name="exec">pwd</invoke><invoke name="exec">ls</invoke>', '<invoke name="exec">pwd</invoke>[EXEC]pwd[/EXEC]', '<invoke name="exec"><parameter name="command">pwd</invoke>']) {
        assert.equal(parseToolCall(text, platformInfo), null);
    }
    const parsed = parseToolCall('<invoke name="read_file"><parameter name="path">$(whoami)\'file</parameter></invoke>', platformInfo);
    assert.equal(parsed.command, "Get-Content -LiteralPath '$(whoami)''file' -TotalCount 200");
});

test('retry after an executed command preserves results without rerunning it', async () => {
    const inputs = ['inspect this folder', '/retry', '/exit'];
    const requests = [];
    let executions = 0;
    await startAiChat({ turbo: true }, {
        platformInfo, ask: async () => inputs.shift() ?? assert.fail('unexpected prompt'),
        execute: async () => { executions++; return { stdout: 'files listed', stderr: '' }; },
        request: async (_, payload) => {
            requests.push(structuredClone(payload));
            if (requests.length === 1) return '[EXEC]Get-ChildItem -Name[/EXEC]';
            if (requests.length === 2) throw new AiRequestError('Gateway timed out', { retryable: true });
            return 'Folder inspected.';
        },
    });
    assert.equal(executions, 1);
    assert.deepEqual(requests[1].messages, requests[2].messages);
    assert.match(requests[2].messages.at(-1).content, /files listed/);
});

test('unknown XML is repaired automatically, then execution continues to final answer', async () => {
    const inputs = ['inspect', '/exit'];
    let calls = 0, executions = 0;
    await startAiChat({ turbo: true }, {
        platformInfo, ask: async () => inputs.shift() ?? assert.fail('unexpected prompt'),
        execute: async () => { executions++; return { stdout: 'ok', stderr: '' }; },
        request: async () => ['<invoke name="unsupported">x</invoke>', '[EXEC]Get-Location[/EXEC]', 'Done'][calls++],
    });
    assert.equal(calls, 3);
    assert.equal(executions, 1);
});

test('repeated protocol errors stop after two repair attempts', async () => {
    let calls = 0;
    const inputs = ['inspect', '/exit'];
    await startAiChat({}, { platformInfo, ask: async () => inputs.shift() ?? assert.fail('unexpected prompt'), request: async () => { calls++; return '<invoke name="unknown">x</invoke>'; }, execute: async () => assert.fail('must not execute') });
    assert.equal(calls, 3);
});

test('no-exec mode never executes XML or EXEC commands', async () => {
    for (const reply of ['[EXEC]Get-Location[/EXEC]', '<invoke name="exec">Get-Location</invoke>']) {
        const inputs = ['inspect', '/exit'];
        await startAiChat({ noExec: true, turbo: true }, { platformInfo, ask: async () => inputs.shift(), request: async () => reply, execute: async () => assert.fail('must not execute') });
    }
});

test('Ctrl+C during command approval escapes the API catch as cancellation', async () => {
    const error = Object.assign(new Error('User force closed'), { name: 'ExitPromptError' });
    let prompts = 0;
    await assert.rejects(startAiChat({}, {
        platformInfo, ask: async () => { if (++prompts > 1) throw error; return 'inspect'; },
        request: async () => '[EXEC]Get-Location[/EXEC]', execute: async () => assert.fail('must not execute'),
    }), e => e === error);
    assert.equal(isUserCancellation(error), true);
    assert.equal(isUserCancellation(new Error('bug')), false);
});

test('dashboard uses a prompt type registered by installed Inquirer', async () => {
    const { default: inquirer } = await import('inquirer');
    const source = await fs.readFile(new URL('../src/commands/dashboard.js', import.meta.url), 'utf8');
    for (const [, type] of source.matchAll(/type:\s*'([^']+)'/g)) assert.ok(type in inquirer.prompt.prompts, type);
});

test('supported XML requests approval in turbo mode and continues with its result', async () => {
    const inputs = ['inspect', 'y', '/exit'];
    const requests = [];
    let executions = 0;
    await startAiChat({ turbo: true }, {
        platformInfo, ask: async () => inputs.shift() ?? assert.fail('unexpected prompt'),
        execute: async command => { executions++; assert.match(command, /Get-ChildItem/); return { stdout: 'a.txt', stderr: '' }; },
        request: async (_, payload) => {
            requests.push(structuredClone(payload));
            return requests.length === 1 ? '<dots_function_call><invoke name="glob"><parameter name="pattern">**/*</parameter></invoke></dots_function_call>' : 'Done';
        },
    });
    assert.equal(executions, 1);
    assert.match(requests[1].messages.at(-1).content, /a.txt/);
    assert.equal(inputs.length, 0);
});

test('requestAi handles standard OpenAI/llama-server format and bearer auth', async () => {
    let capturedHeaders = null;
    let capturedBody = null;
    const answer = await requestAi('https://api.moonlightsoldiers.xyz/v1/chat/completions', {
        messages: [{ role: 'user', content: 'test' }],
        model: 'Qwen3-Coder-30B'
    }, {
        apiKey: 'hunterella@152634879man',
        fetchImpl: async (_, options) => {
            capturedHeaders = options.headers;
            capturedBody = JSON.parse(options.body);
            return new Response(JSON.stringify({
                choices: [{ message: { role: 'assistant', content: 'hello from qwen' } }]
            }), { status: 200 });
        }
    });
    assert.equal(answer, 'hello from qwen');
    assert.equal(capturedHeaders['Authorization'], 'Bearer hunterella@152634879man');
    assert.equal(capturedBody.model, 'Qwen3-Coder-30B');
});

test('AI presets apply correctly between own and cloud', async () => {
    const { applyPreset, loadConfig, saveConfig } = await import('../src/utils/configManager.js');
    const original = loadConfig();
    try {
        const ownRes = applyPreset('own');
        assert.equal(ownRes.name, 'own');
        assert.equal(ownRes.preset['api-url'], 'https://api.moonlightsoldiers.xyz/v1/chat/completions');
        assert.equal(ownRes.preset['api-key'], 'hunterella@152634879man');
        assert.equal(ownRes.preset['model'], 'Qwen3-Coder-30B');

        const cloudRes = applyPreset('cloud');
        assert.equal(cloudRes.name, 'cloud');
        assert.equal(cloudRes.preset['api-url'], 'https://api.hunterstar.uz');
    } finally {
        saveConfig(original);
    }
});

test('memoryManager records mistake on recursive search timeout and compacts output', async () => {
    const { recordMistake, compactCommandOutput, recordUserLesson } = await import('../src/utils/memoryManager.js');
    const lesson = recordMistake('Get-ChildItem -Path C:\\Users\\Hunte -Recurse -Filter "Tlauncher*"', { timeout: true });
    assert.ok(lesson);
    assert.match(lesson.rule, /unbounded recursive searches/);

    const compacted = compactCommandOutput('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17\nline18', '', 5, 200);
    assert.match(compacted, /omitted to preserve tokens/);

    const userLesson = recordUserLesson('TLauncher is located in $env:APPDATA\\.tlauncher');
    assert.equal(userLesson.rule, 'TLauncher is located in $env:APPDATA\\.tlauncher');
});

test('createStreamParser captures delta.reasoning_content and delta.content', async () => {
    const { createStreamParser } = await import('../src/utils/aiTransport.js');
    const reasoningChunks = [];
    const contentChunks = [];
    const parser = createStreamParser({
        onReasoningToken: t => reasoningChunks.push(t),
        onContentToken: t => contentChunks.push(t),
    });

    parser.parseLine('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}');
    parser.parseLine('data: {"choices":[{"index":0,"delta":{"reasoning_content":"Thinking"}}]}');
    parser.parseLine('data: {"choices":[{"index":0,"delta":{"reasoning_content":" process"}}]}');
    parser.parseLine('data: {"choices":[{"index":0,"delta":{"content":"Final"}}]}');
    parser.parseLine('data: {"choices":[{"index":0,"delta":{"content":" answer"}}]}');
    parser.parseLine('data: [DONE]');

    assert.equal(parser.state.reasoningContent, 'Thinking process');
    assert.equal(parser.state.content, 'Final answer');
    assert.deepEqual(reasoningChunks, ['Thinking', ' process']);
    assert.deepEqual(contentChunks, ['Final', ' answer']);
    assert.equal(parser.state.isDone, true);
});

test('createStreamParser routes inline <think> tags in content to reasoning', async () => {
    const { createStreamParser } = await import('../src/utils/aiTransport.js');
    const reasoningChunks = [];
    const contentChunks = [];
    const parser = createStreamParser({
        onReasoningToken: t => reasoningChunks.push(t),
        onContentToken: t => contentChunks.push(t),
    });

    parser.parseLine('data: {"choices":[{"index":0,"delta":{"content":"<think>Internal thought</think>Actual output"}}]}');
    assert.equal(parser.state.reasoningContent, 'Internal thought');
    assert.equal(parser.state.content, 'Actual output');
    assert.deepEqual(reasoningChunks, ['Internal thought']);
    assert.deepEqual(contentChunks, ['Actual output']);
});

test('requestAi handles streaming SSE responses with thinking tokens', async () => {
    const { requestAi } = await import('../src/utils/aiTransport.js');
    const reasoning = [];
    const content = [];

    const sseLines = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"I will check the folder."}}]}',
        'data: {"choices":[{"delta":{"content":"[EXEC]Get-ChildItem[/EXEC]"}}]}',
        'data: [DONE]\n\n'
    ].join('\n\n');

    const result = await requestAi('https://fake-endpoint.local/v1/chat/completions', {
        messages: [{ role: 'user', content: 'test' }],
        stream: true
    }, {
        onReasoningToken: t => reasoning.push(t),
        onContentToken: t => content.push(t),
        fetchImpl: async () => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(sseLines));
                    controller.close();
                }
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            });
        }
    });

    assert.equal(result, '[EXEC]Get-ChildItem[/EXEC]');
    assert.deepEqual(reasoning, ['I will check the folder.']);
    assert.deepEqual(content, ['[EXEC]Get-ChildItem[/EXEC]']);
});

test('requestAi does not throw error when budget exhausts inside thinking block', async () => {
    const { requestAi } = await import('../src/utils/aiTransport.js');
    const reasoning = [];

    const sseLines = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"Thinking budget ran out here."},"finish_reason":"length"}]}',
        'data: [DONE]\n\n'
    ].join('\n\n');

    const result = await requestAi('https://fake-endpoint.local/v1/chat/completions', {
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 128,
        stream: true
    }, {
        onReasoningToken: t => reasoning.push(t),
        fetchImpl: async () => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(sseLines));
                    controller.close();
                }
            });
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            });
        }
    });

    assert.equal(result, 'Thinking budget ran out here.');
    assert.deepEqual(reasoning, ['Thinking budget ran out here.']);
});

test('requestAi handles non-streaming responses with reasoning_content fallback', async () => {
    const { requestAi } = await import('../src/utils/aiTransport.js');
    const reasoning = [];

    const result = await requestAi('https://fake-endpoint.local/v1/chat/completions', {
        messages: [{ role: 'user', content: 'test' }]
    }, {
        onReasoningToken: t => reasoning.push(t),
        fetchImpl: async () => {
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: '',
                        reasoning_content: 'Non-streaming thought process'
                    }
                }]
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

    assert.equal(result, 'Non-streaming thought process');
    assert.deepEqual(reasoning, ['Non-streaming thought process']);
});

test('calculateVisualRows accurately computes line and wrap counts for thinking erasure', async () => {
    const { calculateVisualRows } = await import('../src/commands/ai.js');

    assert.equal(calculateVisualRows(''), 0);
    assert.equal(calculateVisualRows('Single line', 80), 1);
    assert.equal(calculateVisualRows('Line 1\nLine 2\nLine 3', 80), 3);
    assert.equal(calculateVisualRows('\n🧠 Thinking Process:\nLine 1\nLine 2', 80), 4);
    // Line wrapping: 85 chars with cols=80 takes 2 visual rows
    const longLine = 'a'.repeat(85);
    assert.equal(calculateVisualRows(longLine, 80), 2);
    // ANSI codes stripped properly
    assert.equal(calculateVisualRows('\x1b[90m' + 'a'.repeat(80) + '\x1b[0m', 80), 1);
});

test('classifyPromptTier intelligently routes casual chatter to fast tier and coding/debug to heavy tier', async () => {
    const { classifyPromptTier, FAST_API_URL, HEAVY_API_URL, FAST_MODEL, HEAVY_MODEL } = await import('../src/utils/aiRouter.js');

    assert.equal(FAST_API_URL, 'https://api.moonlightsoldiers.xyz/fast/v1/chat/completions');
    assert.equal(HEAVY_API_URL, 'https://api.moonlightsoldiers.xyz/v1/chat/completions');

    // Casual chatter -> fast
    const chat1 = classifyPromptTier('hello there, how are you?');
    assert.equal(chat1.tier, 'fast');
    assert.equal(chat1.endpoint, FAST_API_URL);
    assert.equal(chat1.model, FAST_MODEL);

    const chat2 = classifyPromptTier('tell me a joke');
    assert.equal(chat2.tier, 'fast');

    // Code task -> heavy
    const code1 = classifyPromptTier('write a python script to ping 8.8.8.8');
    assert.equal(code1.tier, 'heavy');
    assert.equal(code1.endpoint, HEAVY_API_URL);
    assert.equal(code1.model, HEAVY_MODEL);

    // Debugging request -> heavy
    const debug1 = classifyPromptTier('fix this bug where undefined is not a function');
    assert.equal(debug1.tier, 'heavy');

    // Multi-line prompt -> heavy
    const multiline = classifyPromptTier('const a = 10;\nconst b = 20;');
    assert.equal(multiline.tier, 'heavy');

    // Active tool/agent execution context -> heavy
    const agentStep = classifyPromptTier('hello', { steps: 2 });
    assert.equal(agentStep.tier, 'heavy');

    const agentMsg = classifyPromptTier('looks good', {
        messages: [{ role: 'user', content: '[EXECUTION RESULT]\n{"success": true}' }]
    });
    assert.equal(agentMsg.tier, 'heavy');

    // Manual overrides
    const forcedFast = classifyPromptTier('write complex compiler AST in rust', { forcedTier: 'fast' });
    assert.equal(forcedFast.tier, 'fast');

    const forcedHeavy = classifyPromptTier('hi', { forcedTier: 'heavy' });
    assert.equal(forcedHeavy.tier, 'heavy');
});




