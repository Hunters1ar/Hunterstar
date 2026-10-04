const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/pet-comments.js'), 'utf8');

function harness({ accept = true, random = () => 0 } = {}) {
    let clock = 0, timerId = 0;
    const timers = new Map(), attempts = [], comments = [], requests = [];
    class Target {
        constructor() { this.listeners = new Map(); }
        addEventListener(type, callback) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(callback);
        }
        dispatchEvent(event) {
            for (const callback of this.listeners.get(event.type) || []) callback(event);
            return true;
        }
        fire(type, detail) { return this.dispatchEvent({ type, detail }); }
    }
    const document = new Target(), window = new Target(), panel = { hidden: true };
    document.hidden = false;
    document.activeElement = { matches: () => false };
    const sections = new Map();
    document.getElementById = id => sections.get(id);
    const pet = { hidden: false, querySelector: selector => selector === '.pet-panel' ? panel : null };
    let acknowledging = accept;
    document.addEventListener('hunterstar:pet-comment', event => {
        attempts.push({ ...event.detail, at: clock });
        event.detail.accepted = typeof acknowledging === 'function' ? acknowledging(event.detail) : acknowledging;
        if (event.detail.accepted) comments.push({ ...event.detail, at: clock });
    });
    const context = {
        document, window, innerHeight: 800,
        performance: { now: () => clock },
        Math: Object.create(Math),
        CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
        setTimeout(callback, delay) { timers.set(++timerId, { callback, at: clock + delay }); return timerId; },
        clearTimeout(id) { timers.delete(id); },
        fetch(...args) { requests.push(args); throw new Error('Comments must stay local'); }
    };
    context.Math.random = random;
    vm.runInNewContext(source, context);
    const life = (kind, detail = {}) => document.fire('hunterstar:pet-life', { pet, kind, ...detail });
    return {
        document, window, panel, pet, timers, comments, attempts, requests, life,
        ready(enabled = true) { life('ready', { enabled }); },
        accept(value) { acknowledging = value; },
        scroll() { window.fire('scroll'); },
        section(id, top = 100, bottom = 700) {
            const rect = { left: 0, right: 900, width: 900, height: bottom - top, top, bottom };
            const element = { hidden: false, getBoundingClientRect: () => rect };
            sections.set(id, element); return { element, rect };
        },
        advance(ms) {
            const until = clock + ms;
            let steps = 0;
            while (true) {
                const next = Array.from(timers).filter(([, value]) => value.at <= until)
                    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!next) break;
                assert.ok(++steps < 1000, 'Timer loop must stay bounded');
                const [id, timer] = next;
                clock = timer.at; timers.delete(id); timer.callback();
            }
            clock = until;
        },
        kinds() { return comments.map(comment => comment.kind); }
    };
}

test('welcome waits for mount, appears once per document, and sends no requests', () => {
    const h = harness();
    h.advance(3000); assert.equal(h.comments.length, 0);
    h.ready(); h.advance(999); assert.equal(h.comments.length, 0);
    h.advance(1); assert.deepEqual(h.kinds(), ['welcome']);
    assert.match(h.comments[0].text, /Hunterstar/);
    assert.equal(h.comments[0].duration, 10000);
    h.ready(); h.life('show', { enabled: true }); h.advance(1000);
    assert.deepEqual(h.kinds(), ['welcome']);
    assert.deepEqual(h.requests, []);
});

test('an automatic landing during initial placement cannot suppress the first welcome', () => {
    const h = harness(); h.ready(); h.advance(400);
    h.life('land', { impact: 950, surface: { name: 'floor' } });
    h.life('land', { impact: 200, surface: { name: 'Title', kind: 'heading', element: {} } });
    assert.equal(h.attempts.length, 0);
    h.advance(600);
    assert.deepEqual(h.kinds(), ['welcome']);
    h.advance(200); h.life('land', { impact: 950, surface: { name: 'floor' } });
    assert.deepEqual(h.kinds(), ['welcome']); // Automatic settling cannot immediately replace it either.
    h.life('show', { enabled: true }); h.advance(1000);
    assert.deepEqual(h.kinds(), ['welcome']);
    h.advance(8800); h.life('land', { impact: 950, surface: { name: 'floor' } });
    assert.deepEqual(h.kinds(), ['welcome', 'landing']);
});

test('drag replaces a welcome promptly, ignores repeated start signals, and reacts once to a long hold', () => {
    const h = harness(); h.ready(); h.advance(1000);
    h.life('drag-start');
    for (let i = 0; i < 30; i++) h.life('drag-start');
    assert.deepEqual(h.kinds(), ['welcome', 'drag']);
    h.advance(2999); assert.equal(h.comments.length, 2);
    h.advance(1); assert.deepEqual(h.kinds(), ['welcome', 'drag', 'hold']);
    h.advance(3000); assert.equal(h.comments.length, 3);
    h.life('drag-end', { speed: 0 });
    h.advance(20000); assert.equal(h.comments.length, 3);
});

test('a quick drag cancels a pending welcome and releasing cancels the hold timer', () => {
    const h = harness(); h.ready(); h.advance(200);
    h.life('drag-start'); h.advance(200); h.life('drag-end', { speed: 100 });
    h.advance(4000);
    assert.deepEqual(h.kinds(), ['drag']);
});

test('a fast throw can follow its drag, but rapid repeated gestures do not burst comments', () => {
    const h = harness(); h.ready(); h.advance(1000);
    h.life('drag-start'); h.advance(100); h.life('drag-end', { speed: 600 });
    assert.deepEqual(h.kinds(), ['welcome', 'drag', 'throw']);
    h.life('drag-start'); h.advance(100); h.life('drag-end', { speed: 800 });
    assert.deepEqual(h.kinds(), ['welcome', 'drag', 'throw']);
    h.advance(10000); h.life('drag-start'); h.life('drag-end', { speed: 600 });
    assert.deepEqual(h.kinds(), ['welcome', 'drag', 'throw', 'drag', 'throw']);
    assert.notEqual(h.comments[1].text, h.comments[3].text);
    assert.notEqual(h.comments[2].text, h.comments[4].text);
});

test('cancelled pointers, unmatched releases, and slow drops do not get throw lines', () => {
    const h = harness(); h.ready();
    h.life('drag-end', { speed: 1000 });
    h.life('drag-start'); h.life('drag-end', { speed: 1000, cancelled: true });
    h.advance(10000); h.life('drag-start'); h.life('drag-end', { speed: 350 });
    assert.deepEqual(h.kinds(), ['drag', 'drag']);
    h.advance(4000); assert.equal(h.comments.length, 2);
});

test('a landing reacts to a hard impact, while a toss landing does not create another immediate line', () => {
    const h = harness(); h.ready(); h.advance(11000);
    h.life('land', { impact: 800, surface: { name: 'floor' } });
    assert.deepEqual(h.kinds(), ['welcome', 'landing']);
    h.advance(10000); h.life('drag-start'); h.life('drag-end', { speed: 600 });
    h.life('land', { impact: 1100, surface: { name: 'floor' } });
    assert.deepEqual(h.kinds(), ['welcome', 'landing', 'drag', 'throw']);
});

test('ordinary comments use a longer cooldown and only record an accepted perch visit', () => {
    const h = harness(); h.ready(); h.advance(1000);
    const surface = { name: 'JavaScript', kind: 'technology', element: {} };
    h.life('land', { impact: 200, surface });
    assert.deepEqual(h.kinds(), ['welcome']);
    h.advance(35000); h.life('land', { impact: 200, surface });
    assert.deepEqual(h.kinds(), ['welcome', 'technology']);
    h.advance(35000); h.life('land', { impact: 200, surface });
    assert.equal(h.kinds().filter(kind => kind === 'technology').length, 1);
});

test('a rejected bubble does not spend cooldown or prevent a later meaningful reaction', () => {
    const h = harness({ accept: false }); h.ready(); h.advance(1000);
    assert.equal(h.attempts.length, 1); assert.equal(h.comments.length, 0);
    h.accept(true);
    h.life('land', { impact: 200, surface: { name: 'Title', kind: 'heading', element: {} } });
    assert.deepEqual(h.kinds(), ['heading']);
    assert.equal(h.requests.length, 0);
});

test('section commentary waits until scrolling has stopped, uses the final section, and avoids revisits', () => {
    const h = harness(); h.ready(); h.advance(36000);
    const terminal = h.section('terminal');
    h.scroll(); h.advance(1700);
    terminal.rect.top = -700; terminal.rect.bottom = -100;
    const stack = h.section('stack');
    h.scroll(); h.advance(1799);
    assert.equal(h.kinds().filter(kind => kind === 'section').length, 0);
    h.advance(1); assert.equal(h.kinds().filter(kind => kind === 'section').length, 1);
    assert.match(h.comments.at(-1).text, /stack|Technology/);
    h.advance(36000); h.scroll(); h.advance(1800);
    assert.equal(h.kinds().filter(kind => kind === 'section').length, 1);
    stack.rect.top = -900; stack.rect.bottom = -300;
    h.section('contact'); h.advance(35000); h.scroll(); h.advance(1800);
    assert.equal(h.kinds().filter(kind => kind === 'section').length, 2);
    assert.match(h.comments.at(-1).text, /contact|write/);
});

test('nested game commentary wins over the surrounding stack section', () => {
    const h = harness(); h.ready(); h.advance(36000);
    h.section('stack', 0, 1200); h.section('game-menu', 200, 700);
    h.scroll(); h.advance(1800);
    assert.equal(h.comments.at(-1).kind, 'section');
    assert.match(h.comments.at(-1).text, /game|play/i);
});

test('opening chat clears pending reactions and blocks commentary until chat is closed', () => {
    const h = harness(); h.ready(); h.life('drag-start');
    h.section('contact'); h.scroll();
    h.document.fire('hunterstar:chat-state', { active: true, thinking: true });
    assert.equal(h.timers.size, 0);
    const count = h.comments.length;
    h.life('drag-end', { speed: 1000 }); h.life('land', { impact: 1000 }); h.advance(120000);
    assert.equal(h.comments.length, count);
    h.document.fire('hunterstar:chat-state', { active: false, thinking: false });
    h.advance(59999); assert.equal(h.comments.length, count);
    h.advance(1); assert.equal(h.comments.at(-1).kind, 'idle');
});

test('hiding and visibility changes clear timers without replaying an old drag or scroll', () => {
    const h = harness(); h.ready(); h.life('drag-start');
    h.pet.hidden = true; h.document.fire('hunterstar:pet-hidden');
    assert.equal(h.timers.size, 0);
    h.advance(5000); assert.deepEqual(h.kinds(), ['drag']);
    h.pet.hidden = false; h.life('show', { enabled: true }); h.advance(1000);
    assert.deepEqual(h.kinds(), ['drag']); // The drag's cooldown also protects restoration.
    h.document.hidden = true; h.document.fire('visibilitychange');
    assert.equal(h.timers.size, 0);
    h.advance(120000); assert.deepEqual(h.kinds(), ['drag']);
    h.document.hidden = false; h.document.fire('visibilitychange'); h.advance(1000);
    assert.deepEqual(h.kinds(), ['drag']);
});

test('paused pets still welcome and react to a manual drag, while autonomous remarks stay quiet', () => {
    const h = harness(); h.ready(false); h.advance(120000);
    assert.deepEqual(h.kinds(), ['welcome']); assert.equal(h.timers.size, 0);
    h.life('drag-start'); h.life('drag-end', { speed: 0 });
    assert.deepEqual(h.kinds(), ['welcome', 'drag']);
    h.life('pause', { enabled: true }); h.advance(60000);
    assert.deepEqual(h.kinds(), ['welcome', 'drag', 'idle']);
    h.life('pause', { enabled: false }); assert.equal(h.timers.size, 0);
    h.life('land', { impact: 1000 }); h.advance(120000);
    assert.deepEqual(h.kinds(), ['welcome', 'drag', 'idle']);
});

test('controls clear pending chatter; closing controls starts a fresh idle interval', () => {
    const h = harness(); h.ready(); h.advance(300);
    h.panel.hidden = false; h.document.fire('hunterstar:pet-controls');
    assert.equal(h.timers.size, 0); h.advance(100000); assert.equal(h.comments.length, 0);
    h.panel.hidden = true; h.life('controls-close', { enabled: true }); h.advance(60000);
    assert.deepEqual(h.kinds(), ['idle']);
});

test('focused editing suppresses idle, section, and reactive remarks without consuming their cooldown', () => {
    const h = harness(); h.ready(); h.advance(36000); h.section('contact');
    h.document.activeElement = { matches: () => true };
    h.scroll(); h.life('drag-start'); h.life('land', { impact: 1000 }); h.advance(24000);
    assert.deepEqual(h.kinds(), ['welcome']);
    h.document.activeElement = { matches: () => false };
    h.life('land', { impact: 1000 }); assert.deepEqual(h.kinds(), ['welcome', 'landing']);
});

test('another pet cannot replace the mounted companion or trigger its reactions', () => {
    const h = harness(); h.ready(); h.advance(1000);
    h.document.fire('hunterstar:pet-life', { pet: { hidden: false }, kind: 'drag-start', enabled: true });
    assert.deepEqual(h.kinds(), ['welcome']);
});
