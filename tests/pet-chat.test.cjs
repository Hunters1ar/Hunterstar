const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/chat-widget.js'), 'utf8');

function harness({ hostname = '127.0.0.1', pathname = '/', fetchReply } = {}) {
    const timers = new Map(), requests = [], states = [];
    let timerId = 0;
    class Element {
        constructor(tag) {
            this.tagName = tag; this.listeners = {}; this.children = []; this.attrs = {};
            this.style = { setProperty(key, value) { this[key] = value; } };
            this.dataset = {}; this.hidden = false; this.open = false; this.value = '';
            this.offsetWidth = 380; this.offsetHeight = 160;
        }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        fire(type, data = {}) {
            return Promise.all((this.listeners[type] || []).map(fn => fn({ type, target: this, preventDefault() {}, ...data })));
        }
        dispatchEvent(event) { void this.fire(event.type, event); }
        append(...children) { this.children.push(...children); }
        setAttribute(key, value) { this.attrs[key] = value; }
        removeAttribute(key) { delete this.attrs[key]; }
        focus() { document.activeElement = this; }
        showModal() { this.open = true; }
        close() { this.open = false; void this.fire('close'); }
        requestSubmit() { void this.fire('submit'); }
        set innerHTML(markup) {
            this.markup = markup;
            this.nodes = {};
            const selectors = this.tagName === 'dialog'
                ? ['form', 'textarea', '[data-chat="cancel"]']
                : ['.pet-speech-text', 'nav', '.pet-speech-count', '[data-chat="previous"]',
                    '[data-chat="next"]', '[data-chat="ask"]', '[data-chat="dismiss"]'];
            for (const selector of selectors) this.nodes[selector] = new Element(selector);
        }
        querySelector(selector) { return this.nodes[selector]; }
        querySelectorAll(selector) { return [this.nodes[selector]]; }
    }
    const document = new Element('document');
    document.body = new Element('body'); document.readyState = 'complete';
    document.createElement = tag => new Element(tag);
    document.addEventListener('hunterstar:chat-state', event => states.push(event.detail));
    const window = new Element('window'); window.location = { hostname, pathname };
    const context = {
        document, window, innerWidth: 900, innerHeight: 700, AbortController, TextEncoder, TextDecoder,
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        async fetch(url, options) {
            requests.push({ url, options });
            if (fetchReply) return fetchReply(url, options);
            return { ok: true, json: async () => ({ ok: true, data: { choices: [{ message: { content: 'A real answer from the test backend.' } }] } }) };
        }
    };
    vm.runInNewContext(source, context);
    const dialog = document.body.children[0], bubble = document.body.children[1];
    const character = new Element('button'), pet = new Element('div');
    pet.nodes = { '.pet-character': character };
    let rect = { left: 22, top: 418, width: 228, bottom: 684 };
    pet.getBoundingClientRect = () => rect;
    const open = () => document.fire('hunterstar:pet-talk', { detail: { pet } });
    const input = dialog.querySelector('textarea');
    const reply = () => bubble.querySelector('.pet-speech-text').textContent;
    const button = name => bubble.querySelector(`[data-chat="${name}"]`);
    const send = value => { input.value = value; return dialog.querySelector('form').fire('submit'); };
    return { document, window, context, dialog, bubble, pet, character, input, requests, timers, states, open, reply, button, send,
        move(nextRect) { rect = nextRect; void document.fire('hunterstar:pet-move'); },
        timeout() { for (const timer of timers.values()) timer.fn(); }
    };
}

test('pet talk opens a focused modal without a launcher or initial API traffic', async () => {
    const h = harness();
    assert.equal(h.requests.length, 0); assert.equal(h.dialog.open, false); assert.equal(h.bubble.hidden, true);
    await h.open();
    assert.equal(h.dialog.open, true); assert.equal(h.document.activeElement, h.input);
    assert.equal(h.states.at(-1).active, true);
    await h.dialog.querySelector('[data-chat="cancel"]').fire('click');
    assert.equal(h.dialog.open, false); assert.equal(h.bubble.hidden, true);
    assert.equal(h.states.at(-1).active, false); assert.equal(h.document.activeElement, h.character);
});

test('sending shows an anchored reply and preserves conversation history', async () => {
    const h = harness(); await h.open(); await h.send('Who are you?');
    assert.equal(h.requests[0].url, 'https://api.moonlightsoldiers.xyz/api/pet/chat');
    assert.equal(h.requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(h.requests[0].options.body).messages, [{ role: 'user', content: 'Who are you?' }]);
    assert.equal(h.dialog.open, false); assert.equal(h.bubble.hidden, false);
    assert.match(h.reply(), /real answer/); assert.equal(h.states.at(-1).thinking, false);
    assert.equal(h.input.value, '');
    await h.button('ask').fire('click'); await h.send('Tell me more');
    assert.equal(JSON.parse(h.requests[1].options.body).messages.length, 3);
    assert.equal(h.bubble.querySelector('nav').hidden, false);
    assert.equal(h.bubble.querySelector('.pet-speech-count').textContent, '2 / 2');
    await h.button('previous').fire('click');
    assert.equal(h.bubble.querySelector('.pet-speech-count').textContent, '1 / 2');
    assert.equal(h.button('previous').disabled, true);
});

test('reply text remains plain text, including HTML from the backend', async () => {
    const answer = '<img src=x onerror=alert(1)>\nSecond line';
    const h = harness({ fetchReply: async () => ({ ok: true, json: async () => ({ ok: true, data: { choices: [{ message: { content: answer } }] } }) }) });
    await h.open(); await h.send('Hello');
    assert.equal(h.reply(), answer);
    assert.equal(h.bubble.querySelector('.pet-speech-text').markup, undefined);
});

test('failed responses show a retryable error and preserve the prompt without polluting history', async () => {
    let succeeds = false;
    const h = harness({ fetchReply: async () => succeeds
        ? { ok: true, json: async () => ({ ok: true, data: { choices: [{ message: { content: 'Connected.' } }] } }) }
        : { ok: false, json: async () => ({ ok: false, error: 'private upstream details' }) } });
    await h.open(); await h.send('Hello');
    assert.match(h.reply(), /can’t reach/); assert.doesNotMatch(h.reply(), /private upstream/);
    assert.equal(h.bubble.dataset.error, 'true'); assert.equal(h.input.value, 'Hello');
    assert.equal(h.button('ask').disabled, false);
    succeeds = true;
    await h.button('ask').fire('click'); await h.send('Hello');
    assert.equal(JSON.parse(h.requests[1].options.body).messages.length, 1);
});

test('dismissing a pending reply aborts it and prevents a late answer from reappearing', async () => {
    let resolve;
    const h = harness({ fetchReply: () => new Promise(done => { resolve = done; }) });
    await h.open(); const sending = h.send('Hello');
    assert.equal(h.states.at(-1).thinking, true); assert.equal(h.button('ask').disabled, true);
    await h.button('dismiss').fire('click');
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.bubble.hidden, true); assert.equal(h.states.at(-1).active, false);
    resolve({ ok: true, json: async () => ({ ok: true, data: { choices: [{ message: { content: 'Late answer' } }] } }) });
    await sending;
    assert.equal(h.bubble.hidden, true); assert.equal(h.timers.size, 0);
    await h.open(); assert.equal(h.dialog.open, true);
});

test('request timeout restores retry controls', async () => {
    const h = harness({ fetchReply: (_, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }) });
    await h.open(); const sending = h.send('Hello'); h.timeout(); await sending;
    assert.match(h.reply(), /too long/); assert.equal(h.button('ask').disabled, false);
    assert.equal(h.states.at(-1).thinking, false);
});

test('the bubble follows the pet and clamps within desktop and mobile viewports', async () => {
    const h = harness(); await h.open(); await h.send('Hello');
    h.move({ left: 656, top: 8, width: 228, bottom: 274 });
    assert.equal(h.bubble.style.left, '508px'); assert.equal(h.bubble.dataset.placement, 'below');
    assert.equal(h.bubble.style.top, '286px');
    h.context.innerWidth = 360; h.context.innerHeight = 640; h.bubble.offsetWidth = 336;
    h.move({ left: 176, top: 420, width: 168, bottom: 616 });
    assert.equal(h.bubble.style.left, '12px');
    assert.ok(parseFloat(h.bubble.style.top) >= 12);
    assert.ok(parseFloat(h.bubble.style.top) + h.bubble.offsetHeight <= 628);
});

test('hiding the pet closes chat and cancelling a new prompt restores the last reply', async () => {
    const h = harness(); await h.open(); await h.send('Hello');
    await h.button('ask').fire('click'); h.dialog.close();
    assert.equal(h.bubble.hidden, false);
    await h.button('ask').fire('click'); h.pet.hidden = true;
    await h.document.fire('hunterstar:pet-hidden');
    assert.equal(h.bubble.hidden, true); assert.equal(h.dialog.open, false);
    assert.equal(h.states.at(-1).active, false);
});

test('opening pet controls dismisses the reply so the two panels do not overlap', async () => {
    const h = harness(); await h.open(); await h.send('Hello');
    await h.document.fire('hunterstar:pet-controls');
    assert.equal(h.bubble.hidden, true); assert.equal(h.states.at(-1).active, false);
});

test('Enter sends, while Shift+Enter and composing input remain editable', async () => {
    const h = harness(); await h.open(); h.input.value = 'Hello';
    await h.input.fire('keydown', { key: 'Enter', shiftKey: true });
    await h.input.fire('keydown', { key: 'Enter', isComposing: true });
    assert.equal(h.requests.length, 0);
    await h.input.fire('keydown', { key: 'Enter' });
    assert.equal(h.requests.length, 1);
});

test('local and production previews use the dedicated pet API', async () => {
    for (const [hostname, pathname] of [
        ['127.0.0.1', '/'],
        ['hunterstar.uz', '/']
    ]) {
        const h = harness({ hostname, pathname }); await h.open(); await h.send('Hello');
        assert.equal(h.requests[0].url, 'https://api.moonlightsoldiers.xyz/api/pet/chat');
    }
});

function sseResponse(stream) {
    return { ok: true, headers: { get: () => 'text/event-stream; charset=utf-8' }, body: stream };
}

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('streamed tokens appear before completion and only a finished answer enters history', async () => {
    let streamController;
    const stream = new ReadableStream({ start(controller) { streamController = controller; } });
    const h = harness({ fetchReply: async () => sseResponse(stream) });
    await h.open(); const sending = h.send('Salom');
    await tick();
    assert.equal(JSON.parse(h.requests[0].options.body).stream, true);
    streamController.enqueue(new TextEncoder().encode(frame('token', { token: 'Salom, ' })));
    await tick();
    assert.equal(h.reply(), 'Salom, ');
    assert.equal(h.states.at(-1).thinking, true);
    assert.equal(h.button('ask').disabled, true);
    streamController.enqueue(new TextEncoder().encode(frame('token', { token: 'do‘stim!' }) + frame('done', { ok: true })));
    await sending;
    assert.equal(h.reply(), 'Salom, do‘stim!');
    assert.equal(h.states.at(-1).thinking, false);
    assert.equal(h.input.value, '');
});

test('SSE reader handles split UTF-8, split boundaries, CRLF and multiple frames per chunk', async () => {
    const bytes = new TextEncoder().encode((frame('start', { ok: true }) + frame('token', { token: 'Привет 👋' })
        + frame('done', { ok: true })).replaceAll('\n', '\r\n'));
    const stream = new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
    } });
    const h = harness({ fetchReply: async () => sseResponse(stream) });
    await h.open(); await h.send('Hello');
    assert.equal(h.reply(), 'Привет 👋');
    assert.equal(h.bubble.dataset.error, 'false');
});

test('incomplete and failed streams preserve the prompt and leave partial text out of history', async () => {
    for (const ending of ['', frame('error', { ok: false, error: 'Please retry shortly.', retryable: true })]) {
        let succeeds = false;
        const h = harness({ fetchReply: async () => sseResponse(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode(frame('token', { token: 'Partial answer' })
                + (succeeds ? frame('done', { ok: true }) : ending)));
            controller.close();
        } })) });
        await h.open(); await h.send('Hello');
        assert.equal(h.bubble.dataset.error, 'true');
        assert.equal(h.input.value, 'Hello');
        assert.equal(h.button('ask').disabled, false);
        succeeds = true;
        await h.button('ask').fire('click'); await h.send('Hello');
        assert.equal(JSON.parse(h.requests[1].options.body).messages.length, 1);
    }
});

test('dismissing during streaming cancels the reader and prevents partial replies from reopening', async () => {
    let controller, cancelled = false;
    const stream = new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } });
    const h = harness({ fetchReply: async () => sseResponse(stream) });
    await h.open(); const sending = h.send('Hello'); await tick();
    controller.enqueue(new TextEncoder().encode(frame('token', { token: 'First token' }))); await tick();
    await h.button('dismiss').fire('click');
    controller.enqueue(new TextEncoder().encode(frame('done', { ok: true })));
    await sending;
    assert.equal(cancelled, true);
    assert.equal(h.bubble.hidden, true);
    assert.equal(h.requests[0].options.signal.aborted, true);
});
