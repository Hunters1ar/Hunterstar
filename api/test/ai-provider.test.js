const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiProvider } = require('../ai-provider');
const { buildCliPrompt } = require('../cli-prompt');
const reply = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const messages = [{ role: 'user', content: 'hello' }];

test('provider HTML timeout falls back to discovered Gemini text model', async () => {
    const calls = [];
    const call = createAiProvider({ env: { OPEN_ROUTER_API_KEY: 'fake-router', AI_STUDIO_API_KEY: 'fake-gemini' }, fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        if (String(url).includes('openrouter')) return new Response('<html>504</html>', { status: 504 });
        if (String(url).includes('/models?')) return new Response(JSON.stringify({ models: [
            { name: 'models/gemini-test-flash-tts', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-test-flash', supportedGenerationMethods: ['generateContent'] },
        ] }));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Thinking', thought: true }, { text: 'Hello' }, { text: ' world' }] } }] }));
    } });
    const result = await call('system', messages);
    assert.equal(result.choices[0].message.content, 'Hello world');
    assert.equal(calls.length, 3);
    assert.match(calls[2].url, /gemini-test-flash:generateContent/);
    assert.ok(!calls[2].url.includes('fake-gemini'));
});

test('quota cooldown honors provider delay and does not rotate shared keys', async () => {
    let calls = 0;
    let now = 100;
    const call = createAiProvider({ now: () => now, env: { OPEN_ROUTER_API_KEY: 'a', OPEN_ROUTER_API_KEY1: 'b' }, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429, headers: { 'Retry-After': '45' } }); } });
    await assert.rejects(call('s', messages), e => e.status === 429 && e.retryAfterMs === 45000);
    now += 1000;
    await assert.rejects(call('s', messages), e => e.retryAfterMs === 44000);
    assert.equal(calls, 1);
    now += 45000;
    await assert.rejects(call('s', messages));
    assert.equal(calls, 2);
});

test('configured and requested models are used; missing models are configuration failures', async () => {
    let selected;
    const call = createAiProvider({ env: { OPEN_ROUTER_API_KEY: 'fake', OPENROUTER_MODEL: 'configured' }, fetchImpl: async (_, options) => { selected = JSON.parse(options.body).model; return reply('ok'); } });
    await call('s', messages);
    assert.equal(selected, 'configured');
    await call('s', messages, { model: 'requested:free' });
    assert.equal(selected, 'requested:free');
    await assert.rejects(call('s', messages, { model: 'unapproved-paid-model' }), e => e.status === 400 && !e.retryable);
    const broken = createAiProvider({ env: { AI_STUDIO_API_KEY: 'fake', GEMINI_MODEL: 'missing' }, fetchImpl: async () => new Response('{}', { status: 404 }) });
    await assert.rejects(broken('s', messages), e => e.retryable === false && /configuration/.test(e.message));
});

test('network timeout falls back and total deadline is bounded', async () => {
    let attempts = 0;
    const call = createAiProvider({ requestTimeoutMs: 5, totalTimeoutMs: 20, env: { OPEN_ROUTER_API_KEY: 'fake', AI_STUDIO_API_KEY: 'fake', GEMINI_MODEL: 'test' }, fetchImpl: async (_, { signal }) => {
        attempts++;
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))));
    } });
    await assert.rejects(call('s', messages), e => e.retryable && e.status === 503);
    assert.ok(attempts >= 1 && attempts <= 2);
});

test('empty provider answers fall back; missing credentials are not retryable', async () => {
    let calls = 0;
    const call = createAiProvider({ env: { OPEN_ROUTER_API_KEY: 'one', OPEN_ROUTER_API_KEY1: 'two' }, fetchImpl: async () => reply(++calls === 1 ? '' : 'ok') });
    assert.equal((await call('s', messages)).choices[0].message.content, 'ok');
    await assert.rejects(createAiProvider({ env: {} })('s', messages), e => e.retryable === false);
});

test('CLI prompt preserves client instructions and recognizes Windows shell variants', () => {
    for (const platform of ['windows', 'win32']) {
        const prompt = buildCliPrompt({ messages: [{ role: 'system', content: 'Use hunterstar convert for images.' }, ...messages], platform, shell: 'powershell' });
        assert.match(prompt, /Operating system: Windows/);
        assert.match(prompt, /Get-Location/);
        assert.match(prompt, /Use hunterstar convert/);
        assert.match(prompt, /untrusted data/);
    }
    assert.match(buildCliPrompt({ messages, platform: 'windows', shell: 'cmd' }), /\[EXEC\]cd\[\/EXEC\]/);
    assert.match(buildCliPrompt({ messages, platform: 'linux', shell: 'bash' }), /\[EXEC\]pwd\[\/EXEC\]/);
});
