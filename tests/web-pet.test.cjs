const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/web-pet.js'), 'utf8');
const worldSource = fs.readFileSync(path.join(root, 'js/pet-world.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/pet/manifest.json'), 'utf8'));
const manifestUrl = '/assets/pet/manifest.json?v=4';

function harness({ preference, connection, reduced = false, fail, random = Math.random, platforms = [], zones = [] } = {}) {
    let now = 100;
    let id = 0;
    const requests = [], bitmaps = [], drawn = [], timers = new Map(), frames = new Map();
    const storage = new Map(preference ? [['hunterstar-pet', preference]] : []);
    class Element {
        constructor(tag) {
            this.tagName = tag; this.listeners = {}; this.style = {}; this.dataset = {};
            this.hidden = false; this.offsetWidth = 228; this.offsetHeight = 266;
            this.children = []; this.attrs = {};
        }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        fire(type, data = {}) {
            for (const fn of this.listeners[type] || []) fn({ target: this, type, ...data });
        }
        dispatchEvent(event) { this.fire(event.type, event); }
        append(child) { this.children.push(child); }
        setAttribute(key, value) { this.attrs[key] = value; }
        setPointerCapture() {}
        focus() {}
        remove() {}
        contains(target) { return target === this || this.children.some(child => child.contains(target)); }
        set innerHTML(_) {
            this.character = new Element('button');
            this.canvas = new Element('canvas'); this.canvas.width = 192; this.canvas.height = 224;
            this.canvas.getContext = () => ({ clearRect() {}, save() {}, translate() {}, scale() {}, restore() {},
                drawImage(image, sx, sy) {
                    assert.ok(!image.closed, 'never draw a released bitmap');
                    drawn.push({ url: image.url, sx, sy });
                } });
            this.panel = new Element('div'); this.panel.hidden = true;
            this.shadow = new Element('span');
            this.actions = {};
            for (const action of ['talk', 'jump', 'sit', 'pause', 'hide']) {
                const button = new Element('button'); button.dataset.action = action;
                this.actions[action] = button; this.panel.append(button);
            }
            this.children = [this.character, this.canvas, this.panel];
        }
        querySelector(selector) {
            if (selector === '.pet-character') return this.character;
            if (selector === 'canvas') return this.canvas;
            if (selector === '.pet-panel') return this.panel;
            if (selector === '.pet-contact-shadow') return this.shadow;
            if (selector === 'button') return this.children[0];
            return this.actions[selector.match(/data-action="(.*?)"/)[1]];
        }
    }
    const document = new Element('document');
    document.body = new Element('body'); document.readyState = 'loading';
    document.createElement = tag => new Element(tag);
    const rect = spec => ({ ...spec, width: spec.right - spec.left, height: spec.bottom - spec.top });
    const elements = new Map();
    const elementFor = (spec, platform = false) => {
        if (!elements.has(spec)) elements.set(spec, {
            tagName: 'DIV', nodeType: 1, childNodes: [],
            get isConnected() { return (platform ? platforms : zones).includes(spec); },
            dataset: platform ? { petPlatform: spec.name || 'Test card' } : { petProtect: '' },
            textContent: spec.name || '',
            closest: () => null,
            matches: selector => selector.includes(platform ? '[data-pet-platform]' : '[data-pet-protect]'),
            getAttribute: name => name === 'data-pet-platform' && platform ? spec.name || 'Test card' : null,
            getBoundingClientRect: () => rect(spec),
            getClientRects: () => [rect(spec)]
        });
        return elements.get(spec);
    };
    document.querySelectorAll = selector => {
        if (selector === '[data-pet-platform]') return platforms.map(spec => elementFor(spec, true));
        // Explicit geometry fixtures are platforms; protected-content fixtures are
        // returned only to the content scan, never as semantic platform candidates.
        if (selector.includes('[data-pet-protect]')) return zones.map(spec => elementFor(spec));
        return [];
    };
    const window = new Element('window');
    const media = new Element('media'); media.matches = reduced;
    const context = {
        window, document, navigator: { connection }, matchMedia: () => media,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        performance: { now: () => now }, innerWidth: 900, innerHeight: 700, AbortController,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        Math: Object.assign(Object.create(Math), { random }),
        setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
        clearTimeout: timer => timers.delete(timer),
        requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
        cancelAnimationFrame: frame => frames.delete(frame),
        fetch: async url => {
            requests.push(url);
            if (fail?.(url)) throw new Error('simulated network failure');
            return { ok: true, json: async () => manifest, blob: async () => ({ url }) };
        },
        createImageBitmap: async blob => {
            const image = { url: blob.url, close() { this.closed = true; } };
            bitmaps.push(image); return image;
        }
    };
    window.createImageBitmap = context.createImageBitmap;
    vm.runInNewContext(worldSource, context);
    vm.runInNewContext(source, context);
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    async function boot() {
        window.fire('load');
        for (const [key, timer] of [...timers]) if (timer.delay === 1000) { timers.delete(key); timer.fn(); }
        await flush();
    }
    const pet = () => document.body.children.find(element => element.className === 'web-pet');
    const restore = () => document.body.children.find(element => element.className === 'pet-restore');
    async function action(name) { const element = pet(); element.panel.fire('click', { target: element.actions[name] }); await flush(); }
    async function tick(ms = 16) {
        now += ms;
        for (const [key, fn] of [...frames]) { frames.delete(key); fn(now); }
        await flush();
    }
    async function advance(ms, hz = 60) {
        let elapsed = 0;
        while (elapsed < ms - 1e-9) {
            const step = Math.min(1000 / hz, ms - elapsed);
            await tick(step); elapsed += step;
        }
    }
    function position() {
        const values = pet().style.transform.match(/translate3d\(([-\d.e+]+)px, ([-\d.e+]+)px/);
        return { x: Number(values[1]), y: Number(values[2]) };
    }
    function beginDrag() {
        const { x, y } = position();
        pet().character.fire('pointerdown', { pointerId: 1, isPrimary: true, button: 0,
            clientX: x + 50, clientY: y + 80, timeStamp: now });
    }
    async function move(x, y, ms) {
        await tick(ms);
        pet().character.fire('pointermove', { pointerId: 1, clientX: x + 50, clientY: y + 80, timeStamp: now });
        await flush();
    }
    async function release(ms = 0, type = 'pointerup') {
        if (ms) await tick(ms);
        pet().character.fire(type, { pointerId: 1, timeStamp: now });
        await flush();
    }
    return { boot, flush, requests, frames, drawn, bitmaps, storage, document, window, context,
        pet, restore, action, tick, advance, position, beginDrag, move, release,
        element: spec => elementFor(spec, platforms.includes(spec)),
        fireTimers(delay) { for (const [key, timer] of [...timers]) if (timer.delay === delay) { timers.delete(key); timer.fn(); } } };
}

test('defer all pet traffic until page load and request only boot + idle initially', async () => {
    const h = harness();
    assert.equal(h.requests.length, 0);
    await h.boot();
    assert.deepEqual(h.requests, [manifestUrl, manifest.boot.src, manifest.animations.idle.src]);
    assert.equal(h.pet().canvas.width, manifest.frameWidth);
    assert.equal(h.pet().canvas.height, manifest.frameHeight);
    assert.ok(h.pet());
    assert.ok(h.frames.size > 0);
    assert.ok(h.requests.every(url => !url.startsWith('/frames/')));
});

for (const options of [{ connection: { saveData: true } }, { connection: { effectiveType: '2g' } },
    { connection: { effectiveType: 'slow-2g' } }, { reduced: true }, { preference: 'pause' }]) {
    test(`static fallback avoids animation traffic: ${JSON.stringify(options)}`, async () => {
        const h = harness(options); await h.boot();
        assert.deepEqual(h.requests, [manifestUrl, manifest.boot.src]);
        assert.equal(h.frames.size, 0);
        assert.equal(h.pet().actions.jump.disabled, true);
        await h.action('pause');
        assert.equal(h.requests.at(-1), manifest.animations.idle.src);
        assert.ok(h.frames.size > 0);
    });
}

test('hidden preference makes zero requests; show, hide, and restore stop/resume animation', async () => {
    const h = harness({ preference: 'hidden' }); await h.boot();
    assert.equal(h.requests.length, 0);
    assert.equal(h.restore().hidden, false);
    h.restore().fire('click'); await h.flush();
    assert.ok(h.pet());
    await h.action('hide');
    assert.equal(h.pet().hidden, true); assert.equal(h.frames.size, 0);
    assert.equal(h.storage.get('hunterstar-pet'), 'hidden');
    const count = h.requests.length;
    h.restore().fire('click'); await h.flush();
    assert.equal(h.pet().hidden, false); assert.ok(h.frames.size > 0);
    assert.equal(h.requests.length, count);
});

test('asset failures preserve fallback and do not retry continuously', async () => {
    const h = harness({ fail: url => url === manifest.animations.idle.src }); await h.boot();
    await h.tick();
    assert.equal(h.drawn.at(-1).url, manifest.boot.src);
    for (let i = 0; i < 10; i++) await h.tick();
    assert.equal(h.requests.filter(url => url === manifest.animations.idle.src).length, 1);
    const broken = harness({ fail: () => true }); await broken.boot();
    assert.equal(broken.pet(), undefined);
    assert.equal(broken.restore().textContent, 'Retry companion');
    assert.equal(broken.frames.size, 0);
});

test('dragging, falling, landing, pause, and tab visibility keep position and loop bounded', async () => {
    const h = harness(); await h.boot();
    const c = h.pet().character;
    c.fire('pointerdown', { pointerId: 1, isPrimary: true, button: 0, clientX: 50, clientY: 600, timeStamp: 100 });
    c.fire('pointermove', { pointerId: 1, clientX: 250, clientY: 200, timeStamp: 200 }); await h.flush();
    assert.ok(h.requests.includes(manifest.animations.drag.src));
    c.fire('pointerup', { pointerId: 1, timeStamp: 400 }); await h.flush();
    assert.ok(h.requests.includes(manifest.animations.fall.src));
    for (let i = 0; i < 80; i++) await h.tick();
    assert.ok(h.requests.includes(manifest.animations.land.src));
    assert.ok(h.pet().style.transform.includes('418px'));
    assert.ok(h.bitmaps.filter(image => !image.closed).length <= 4, 'three atlases plus boot');
    h.document.hidden = true; h.document.fire('visibilitychange'); assert.equal(h.frames.size, 0);
    h.document.hidden = false; h.document.fire('visibilitychange'); await h.flush(); assert.equal(h.frames.size, 1);
    await h.action('pause'); assert.equal(h.frames.size, 0);
});

test('packed library and initial payload stay within network and decoding budgets', () => {
    assert.equal(Object.keys(manifest.animations).length, 9);
    assert.ok(manifest.boot.bytes + manifest.animations.idle.bytes < 100 * 1024);
    assert.ok(Object.values(manifest.animations).reduce((sum, item) => sum + item.bytes, 0) < 1024 * 1024);
    for (const entry of [manifest.boot, ...Object.values(manifest.animations)]) {
        assert.equal(fs.statSync(path.join(root, entry.src)).size, entry.bytes);
        assert.match(entry.src, /\.[a-f0-9]{12}\.webp$/);
    }
});

test('idle, thinking, and sitting hold each frame for about one second', async () => {
    for (const state of ['idle', 'think', 'sit']) {
        const entry = manifest.animations[state];
        assert.ok(entry.frameMs >= 900 && entry.frameMs <= 1200);
        const h = harness({ random: () => .9 }); await h.boot();
        if (state === 'think') await h.advance(7010);
        if (state === 'sit') await h.action('sit');
        assert.equal(h.pet().dataset.state, state);
        await h.advance(850);
        assert.equal(h.drawn.at(-1).url, entry.src);
        assert.equal(h.drawn.at(-1).sx, 0, `${state} does not flip frames rapidly`);
        await h.advance(400);
        assert.equal(h.drawn.at(-1).sx, manifest.frameWidth, `${state} advances after the longer hold`);
    }
});

test('release velocity averages a short motion history instead of the last jitter', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(180, 200, 200);
    await h.move(220, 200, 40);
    await h.move(260, 200, 40);
    await h.move(258, 200, 8); // A tiny final twitch must not reverse a rightward throw.
    await h.release(4); await h.advance(100);
    assert.ok(h.position().x > 278, 'throw follows the sustained direction');
});

test('holding still before release drops vertically without stale throw velocity', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(230, 160, 200); await h.release(200);
    const initial = h.position(); await h.advance(200);
    assert.equal(h.position().x, initial.x);
    assert.ok(h.position().y > initial.y && h.position().y < 418);
});

test('the same throw follows the same trajectory at 30, 60, and 144 Hz', async () => {
    const positions = [];
    for (const hz of [30, 60, 144]) {
        const h = harness(); await h.boot(); h.beginDrag();
        await h.move(200, 230, 200);
        await h.move(225, 205, 50);
        await h.move(250, 180, 50);
        await h.release(8); await h.advance(300, hz);
        positions.push(h.position());
    }
    for (const position of positions.slice(1)) {
        assert.ok(Math.abs(position.x - positions[0].x) < .1);
        assert.ok(Math.abs(position.y - positions[0].y) < .1);
    }
});

test('landing preserves horizontal momentum and ground friction brings it to rest', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(150, 418, 250); await h.move(180, 418, 80); await h.release(8);
    const start = h.position().x; await h.advance(80);
    assert.equal(h.position().y, 418);
    assert.equal(h.pet().dataset.state, 'land');
    assert.ok(h.position().x > start + 10, 'landing continues to slide');
    await h.advance(1000);
    const stopped = h.position().x; await h.advance(250);
    assert.equal(h.position().x, stopped, 'friction ends the slide');
});

test('wall collisions keep throws in bounds and soften the rebound', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(540, 180, 200); await h.move(580, 160, 40);
    await h.move(620, 150, 40); await h.release(4);
    let hitRight = false, furthestRight = -Infinity, previousX = h.position().x;
    const launchX = previousX;
    for (let i = 0; i < 70; i++) {
        await h.tick(16);
        const { x, y } = h.position();
        const feetX = x + manifest.animations.idle.geometry[0].footX * h.pet().offsetWidth;
        assert.ok(feetX >= 8 && feetX <= 892 && y >= 8 && y <= 418);
        assertVisibleBody(h, 'extended airborne poses must remain visible at the wall');
        if (furthestRight > launchX + 30 && x < previousX) hitRight = true;
        furthestRight = Math.max(furthestRight, x);
        previousX = x;
    }
    assert.ok(hitRight);
    assert.ok(h.position().x < furthestRight - 35, 'rebound carries the pet gently away from the wall');
    await h.advance(1000);
    const bodyLeft = h.position().x + parseFloat(h.pet().character.style.left);
    const bodyRight = bodyLeft + parseFloat(h.pet().character.style.width);
    assert.ok(bodyLeft >= 8 && bodyRight <= 892,
        'the resting visible character stays inside the viewport; transparent canvas padding may extend beyond it');
});

test('an upward throw rebounds softly at the ceiling and falls back down', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(230, 260, 200); await h.move(230, 170, 40);
    await h.move(230, 90, 40); await h.release(4);
    let minY = 90;
    for (let i = 0; i < 30; i++) {
        await h.tick(16);
        assert.ok(h.position().y >= 8);
        minY = Math.min(minY, h.position().y);
    }
    assert.ok(minY <= 10, 'throw reaches the ceiling');
    assert.ok(h.position().y > minY + 30, 'ceiling redirects the pet downward');
});

test('a hard landing makes one small rebound and then rests on the floor', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(230, 8, 200); await h.release(200);
    let reboundCount = 0, previousY = 8, rising = false, minLandingY = 418;
    for (let i = 0; i < 200; i++) {
        await h.tick(1000 / 120);
        const { y } = h.position();
        if (h.pet().dataset.state === 'land') {
            minLandingY = Math.min(minLandingY, y);
            const movingUp = y < previousY - 1e-6;
            if (movingUp && !rising) reboundCount++;
            rising = movingUp;
        }
        previousY = y;
    }
    assert.equal(reboundCount, 1);
    assert.ok(minLandingY < 418 && minLandingY > 408, 'rebound stays subtle');
    assert.equal(h.position().y, 418);
});

test('cancelled dragging falls from the release point without teleporting to the floor', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(200, 160, 200); await h.release(0, 'pointercancel');
    assert.equal(h.position().y, 160);
    await h.advance(100);
    assert.ok(h.position().y > 160 && h.position().y < 180);
});

test('landing animation plays once and holds its final frame during recovery', async () => {
    const h = harness(); await h.boot(); h.beginDrag();
    await h.move(200, 418, 200); await h.release(200);
    await h.advance(550);
    assert.equal(h.pet().dataset.state, 'land');
    assert.equal(h.drawn.at(-1).url, manifest.animations.land.src);
    assert.equal(h.drawn.at(-1).sx, manifest.frameWidth * 2);
    await h.advance(100);
    assert.equal(h.drawn.at(-1).sx, manifest.frameWidth * 2, 'landing must not restart its first frame');
    await h.advance(200);
    assert.equal(h.pet().dataset.state, 'idle');
});

test('jump rises smoothly and returns to the floor', async () => {
    const h = harness(); await h.boot(); await h.action('jump');
    await h.advance(300);
    assert.ok(h.position().y < 338, 'jump has a visible upward arc');
    await h.advance(2300);
    assert.equal(h.position().y, 418);
    assert.equal(h.pet().dataset.state, 'idle');
});

test('walking accelerates gradually instead of starting at full speed', async () => {
    const h = harness({ random: () => .1 }); await h.boot(); await h.advance(7000);
    assert.equal(h.pet().dataset.state, 'walk');
    const start = h.position().x; await h.advance(50);
    assert.ok(h.position().x > start && h.position().x < start + 1);
    await h.advance(500);
    assert.ok(h.position().x > start + 15);
});

test('two nearby taps talk; one tap, distant taps, and slow taps do not', async () => {
    const h = harness(); await h.boot();
    let talks = 0;
    h.document.addEventListener('hunterstar:pet-talk', event => { talks++; assert.equal(event.detail.pet, h.pet()); });
    const tap = (x = 70) => h.pet().character.fire('click', { detail: 1, clientX: x, clientY: 500 });
    tap(); assert.equal(talks, 0); assert.equal(h.pet().panel.hidden, true);
    await h.tick(200); tap(); assert.equal(talks, 1);
    tap(); await h.tick(450); tap(); assert.equal(talks, 1);
    await h.tick(100); tap(140); assert.equal(talks, 1);
    await h.tick(150); tap(142); assert.equal(talks, 2);
});

test('drag release never counts as a tap or opens chat', async () => {
    const h = harness(); await h.boot();
    let talks = 0;
    h.document.addEventListener('hunterstar:pet-talk', () => talks++);
    h.pet().character.fire('click', { detail: 1, clientX: 70, clientY: 500 });
    h.beginDrag(); await h.move(180, 200, 120); await h.release();
    h.pet().character.fire('click', { detail: 1, clientX: 70, clientY: 500 });
    h.fireTimers(0);
    h.pet().character.fire('click', { detail: 1, clientX: 70, clientY: 500 });
    assert.equal(talks, 0);
});

test('keyboard activation talks; context menu and a stationary hold open controls', async () => {
    const h = harness(); await h.boot();
    let talks = 0;
    h.document.addEventListener('hunterstar:pet-talk', () => talks++);
    h.pet().character.fire('click', { detail: 0 }); assert.equal(talks, 1);
    h.pet().character.fire('contextmenu', { preventDefault() {} }); assert.equal(h.pet().panel.hidden, false);
    h.beginDrag(); h.fireTimers(550); assert.equal(h.pet().panel.hidden, false);
    await h.release();
    h.pet().character.fire('contextmenu', { preventDefault() {} });
    assert.equal(h.pet().panel.hidden, false, 'native long-press menu does not close the controls again');
    h.pet().character.fire('click', { detail: 1 }); assert.equal(talks, 1);
    await h.action('talk'); assert.equal(talks, 2); assert.equal(h.pet().panel.hidden, true);
});

test('open chat stops wandering, animates thinking, and resumes after dismissal', async () => {
    const h = harness({ random: () => .1 }); await h.boot();
    h.document.fire('hunterstar:chat-state', { detail: { active: true, thinking: true } });
    const start = h.position(); await h.advance(10000);
    assert.deepEqual(h.position(), start);
    assert.equal(h.pet().dataset.state, 'think');
    h.document.fire('hunterstar:chat-state', { detail: { active: false, thinking: false } });
    await h.advance(7100);
    assert.equal(h.pet().dataset.state, 'walk');
});

const footOffset = height => manifest.animations.idle.geometry[0].footY * height;
function assertVisibleBody(h, message = 'the complete opaque character remains inside the viewport') {
    const { x, y } = h.position(), character = h.pet().character;
    const left = x + parseFloat(character.style.left), top = y + parseFloat(character.style.top);
    const right = left + parseFloat(character.style.width), bottom = top + parseFloat(character.style.height);
    assert.ok(left >= -.01 && top >= -.01 && right <= h.context.innerWidth + .01
        && bottom <= h.context.innerHeight + .01, `${message}: ${JSON.stringify({ left, top, right, bottom })}`);
}
async function perch(h, surface, { floorX } = {}) {
    await h.boot();
    if (floorX !== undefined) {
        h.beginDrag(); await h.move(floorX, 418, 250); await h.release(200); await h.advance(500);
    }
    h.document.fire('focusin', { target: h.element(surface) });
    await h.advance(3500);
    assert.equal(h.pet().dataset.surface, surface.name || 'Test card');
    assert.equal(h.pet().dataset.mode, 'perched');
}

test('an autonomous jump lands with its visible contact point on its chosen card top', async () => {
    const card = { name: 'Builds', left: 100, right: 620, top: 500, bottom: 620 };
    const h = harness({ platforms: [card], random: () => .9 }); await perch(h, card);
    assert.equal(h.pet().dataset.surface, 'Builds');
    assert.ok(Math.abs(h.position().y + footOffset(266) - card.top) < .01);
    assert.equal(Number(h.pet().shadow.style.opacity), .25);
    await h.action('sit'); await h.tick();
    const translation = Number(h.pet().canvas.style.transform.match(/, ([-\d.e+]+)px/)[1]);
    assert.ok(Math.abs(h.position().y + translation + manifest.animations.sit.geometry[0].footY * 266 - card.top) < .01);
});

test('autonomous destinations protect text above their feet while card content below remains clear', async () => {
    const card = { left: 100, right: 620, top: 500, bottom: 620 };
    for (const unsafe of [false, true]) {
        const zone = { left: 150, right: 600, top: unsafe ? 300 : 530, bottom: unsafe ? 480 : 590 };
        const h = harness({ platforms: [card], zones: [zone], random: () => .9 }); await h.boot();
        h.document.fire('focusin', { target: h.element(card) }); await h.advance(3500);
        assert.equal(h.pet().dataset.surface, unsafe ? 'floor' : 'Test card');
        if (unsafe) assert.equal(h.position().y, 418, 'the pet refuses an unsafe destination');
    }
});

test('scrolling releases a perched pet without changing its viewport position or reattaching to the old support', async () => {
    const card = { left: 100, right: 650, top: 530, bottom: 640 };
    const h = harness({ platforms: [card], random: () => .9 }); await perch(h, card);
    const grounded = h.position(); card.top -= 65; card.bottom -= 65; h.window.fire('scroll');
    assert.deepEqual(h.position(), grounded, 'scrolling moves the site, not the pet');
    assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.surface, 'air');
    assert.equal(h.pet().dataset.destination, undefined);
    await h.advance(100);
    assert.ok(h.position().y > grounded.y && h.position().y < 418);
    const falling = h.position();
    card.top -= 40; card.bottom -= 40; h.window.fire('scroll');
    assert.deepEqual(h.position(), falling, 'additional scrolling does not carry an airborne pet');
    await h.advance(700);
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.pet().dataset.mode, 'free');
    assert.equal(h.position().y, 418);
});

test('removing a support makes the pet fall instead of hovering or snapping to a new card', async () => {
    const platforms = [{ left: 100, right: 650, top: 510, bottom: 630 }];
    const h = harness({ platforms, random: () => .9 }); await perch(h, platforms[0]);
    const supported = h.position(); platforms.length = 0; h.window.fire('scroll');
    assert.deepEqual(h.position(), supported);
    await h.advance(100);
    assert.ok(h.position().y > supported.y && h.position().y < 418);
    await h.advance(1400); assert.equal(h.position().y, 418);
});

test('a fast missed platform keeps horizontal momentum and falls to the floor', async () => {
    const h = harness({ platforms: [{ left: 290, right: 380, top: 450, bottom: 550 }], random: () => .9 });
    await h.boot(); h.beginDrag(); await h.move(170, 90, 200); await h.move(210, 90, 40);
    await h.move(250, 90, 40); await h.release(4); const launch = h.position();
    await h.advance(150);
    assert.ok(h.position().x > launch.x + 80);
    await h.advance(1700);
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.position().y, 418);
});

test('autonomous movement chooses a reachable card and physically lands on it', async () => {
    const card = { name: 'Core Stacks', left: 80, right: 370, top: 490, bottom: 600 };
    const h = harness({ platforms: [card], random: () => .9 }); await h.boot(); await h.advance(7100);
    assert.equal(h.pet().dataset.destination, 'Core Stacks'); assert.equal(h.pet().dataset.surface, 'air');
    await h.advance(2000);
    assert.equal(h.pet().dataset.surface, 'Core Stacks');
    assert.ok(Math.abs(h.position().y + footOffset(266) - card.top) < .01);
});

test('autonomous repositioning chooses a clear edge instead of landing over protected glyphs', async () => {
    const card = { left: 80, right: 700, top: 500, bottom: 630 };
    const zone = { left: 310, right: 445, top: 300, bottom: 470 };
    const h = harness({ platforms: [card], zones: [zone], random: () => .9 });
    await perch(h, card, { floorX: 280 });
    assert.ok(Math.abs(h.position().x - 280) > 90, 'chooses a destination away from the protected glyphs');
    assert.equal(h.pet().dataset.surface, 'Test card');
    assert.ok(Math.abs(h.position().y + footOffset(266) - card.top) < .01);
    const left = h.position().x + parseFloat(h.pet().character.style.left);
    const right = left + parseFloat(h.pet().character.style.width);
    assert.ok(right <= zone.left - 6 || left >= zone.right + 6, 'the landed visible character clears the text');
});

test('responsive resizing keeps the same contact point attached to its card', async () => {
    const card = { left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [card], random: () => .9 }); await perch(h, card, { floorX: 160 });
    h.context.innerWidth = 390; h.context.innerHeight = 720;
    h.pet().offsetWidth = 168; h.pet().offsetHeight = 196;
    card.left = 24; card.right = 366; card.top = 420; card.bottom = 550; h.window.fire('resize');
    assert.ok(Math.abs(h.position().y + footOffset(196) - card.top) < .01);
    assert.equal(h.pet().dataset.surface, 'Test card');
});

test('scrolling a visible support releases it instead of following its new DOM coordinates', async () => {
    const ledge = { name: 'Scrolling ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await perch(h, ledge);
    assert.equal(h.pet().dataset.surface, 'Scrolling ledge');
    const grounded = h.position();
    ledge.top = 260; ledge.bottom = 380; h.window.fire('scroll');
    assert.deepEqual(h.position(), grounded);
    assert.equal(h.pet().dataset.surface, 'air'); assert.equal(h.pet().dataset.mode, 'free');
    await h.advance(700);
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.position().y, 418);
});

test('scrolling a support past the visible body detaches from the last on-screen position before falling', async () => {
    const ledge = { name: 'Scrolled-away ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await perch(h, ledge);
    const supported = h.position();
    assert.equal(h.pet().dataset.surface, 'Scrolled-away ledge'); assertVisibleBody(h);
    ledge.top = 100; ledge.bottom = 220; h.window.fire('scroll');
    assertVisibleBody(h, 'scroll must not first apply an off-screen support position');
    assert.deepEqual(h.position(), supported, 'detachment begins at the previous visible position');
    assert.equal(h.pet().dataset.surface, 'air');
    await h.advance(100);
    assert.ok(h.position().y > supported.y && h.position().y < 418, 'gravity advances the detached pet naturally');
    assertVisibleBody(h);
    await h.advance(700);
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.position().y, 418); assertVisibleBody(h);
});

test('grounded pets follow a transformed support every frame without waiting for a rescan', async () => {
    const ledge = { name: 'Moving ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await perch(h, ledge);
    await h.tick(); // Begin immediately after a cached world scan, without user scrolling.
    const initial = h.position();
    ledge.left += 20; ledge.right += 20; ledge.top -= 30; ledge.bottom -= 30;
    await h.tick();
    assert.ok(Math.abs(h.position().x - initial.x - 20) < .01);
    assert.ok(Math.abs(h.position().y + footOffset(266) - ledge.top) < .01,
        'CSS transforms do not fire resize events, so the active support must be sampled live');
});

test('an obstructed floor seeks a clear reachable surface instead of remaining invisible', async () => {
    const ledge = { name: 'Safe ledge', left: 100, right: 650, top: 400, bottom: 500 };
    const h = harness({ platforms: [ledge], zones: [{ left: 0, right: 900, top: 450, bottom: 700 }], random: () => .9 });
    await h.boot(); await h.advance(9000);
    assert.equal(h.pet().dataset.surface, 'Safe ledge');
    assert.notEqual(h.pet().dataset.sheltered, 'true', 'content protection must not deadlock the companion invisibly');
    assert.ok(Math.abs(h.position().y + footOffset(266) - ledge.top) < .01);
});

test('pausing in midair freezes the trajectory and resuming continues from that position', async () => {
    const h = harness({ random: () => .9 }); await h.boot(); await h.action('jump'); await h.advance(300);
    const inFlight = h.position();
    assert.ok(inFlight.y < 338);
    await h.action('pause');
    assert.deepEqual(h.position(), inFlight, 'pause must not teleport the pet to the viewport floor');
    await h.advance(1500); assert.deepEqual(h.position(), inFlight);
    await h.action('pause');
    assert.deepEqual(h.position(), inFlight, 'resume must keep the saved trajectory origin');
    await h.advance(100);
    assert.ok(Math.abs(h.position().y - inFlight.y) > 1, 'gravity resumes after animation is enabled');
    await h.advance(2200); assert.equal(h.position().y, 418);
});

test('a visibility change suspends an airborne pet without teleporting it to the floor', async () => {
    const h = harness({ random: () => .9 }); await h.boot(); await h.action('jump'); await h.advance(300);
    const inFlight = h.position();
    h.document.hidden = true; h.document.fire('visibilitychange');
    assert.deepEqual(h.position(), inFlight);
    await h.advance(1500); assert.deepEqual(h.position(), inFlight);
    h.document.hidden = false; h.document.fire('visibilitychange');
    assert.deepEqual(h.position(), inFlight);
    await h.advance(100);
    assert.ok(Math.abs(h.position().y - inFlight.y) > 1);
    await h.advance(2200); assert.equal(h.position().y, 418);
});

test('a sit request during a manual drop ignores DOM surfaces and waits for the viewport floor', async () => {
    const ledge = { name: 'Sit ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await h.boot(); h.beginDrag();
    await h.move(160, 70, 200); await h.release(200); await h.advance(100);
    const inFlight = h.position();
    await h.action('sit');
    assert.deepEqual(h.position(), inFlight, 'requesting a pose must not bypass physics');
    assert.equal(h.pet().dataset.surface, 'air');
    await h.advance(2400);
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.pet().dataset.mode, 'free');
    assert.equal(h.pet().dataset.state, 'sit');
    assert.equal(h.position().y, 418);
});

for (const event of ['pointerover', 'focusin']) {
    test(`${event} draws attention to a reachable element and visits it ahead of a closer card`, async () => {
        const near = { name: 'Nearby card', left: 80, right: 260, top: 490, bottom: 600 };
        const noticed = { name: 'Noticed element', left: 400, right: 700, top: 490, bottom: 600 };
        const ordinary = harness({ platforms: [near, noticed], random: () => .9 });
        await ordinary.boot(); await ordinary.advance(7100);
        assert.equal(ordinary.pet().dataset.destination, 'Nearby card', 'distance alone prefers the nearby surface');

        const h = harness({ platforms: [near, noticed], random: () => .9 }); await h.boot(); await h.tick();
        h.document.fire(event, { target: h.element(noticed) });
        assert.equal(h.pet().dataset.attention, 'Noticed element');
        await h.advance(700);
        assert.equal(h.pet().dataset.destination, undefined, 'attention leaves a brief looking pause before jumping');
        await h.advance(event === 'focusin' ? 900 : 350);
        assert.equal(h.pet().dataset.destination, 'Noticed element', 'visitor interest outweighs the closer card');
        assert.equal(h.pet().dataset.surface, 'air', 'visitor attention creates a fresh goal after its interaction cooldown');
        await h.advance(2500);
        assert.equal(h.pet().dataset.surface, 'Noticed element');
        assert.ok(Math.abs(h.position().y + footOffset(266) - noticed.top) < .01);
    });
}

test('the character hit area excludes transparent canvas padding and preserves foot anchoring across poses', async () => {
    const h = harness({ random: () => .9 }); await h.boot(); await h.tick();
    const character = h.pet().character, canvas = h.pet().canvas;
    assert.ok(parseFloat(character.style.width) > 0 && parseFloat(character.style.width) < h.pet().offsetWidth);
    assert.ok(parseFloat(character.style.height) > 0 && parseFloat(character.style.height) < h.pet().offsetHeight);
    assert.ok(parseFloat(character.style.left) > 0 && parseFloat(character.style.top) > 0,
        'transparent margins must not intercept nearby site controls');
    const contactY = h.position().y + footOffset(266);
    await h.action('sit'); await h.tick();
    assert.ok(parseFloat(character.style.width) < h.pet().offsetWidth);
    assert.ok(parseFloat(character.style.height) < h.pet().offsetHeight);
    const canvasOffsetY = Number(canvas.style.transform.match(/, ([-\d.e+]+)px/)[1]);
    assert.ok(Math.abs(h.position().y + canvasOffsetY + manifest.animations.sit.geometry[0].footY * 266 - contactY) < .01,
        'canvas anchoring must remain independent of the smaller button hit area');
});

test('a far-right ledge is reachable while every jumping, falling, and landing pose remains fully visible', async () => {
    const ledge = { name: 'Right-edge technology chip', left: 760, right: 850, top: 490, bottom: 535 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await h.boot(); h.beginDrag();
    await h.move(620, 418, 250); await h.release(200); await h.advance(1000);
    assert.equal(h.pet().dataset.surface, 'floor');
    h.document.fire('pointerover', { target: h.element(ledge) });
    const seen = new Set();
    async function advanceVisible(ms) {
        for (let elapsed = 0; elapsed < ms - 1e-9;) {
            const step = Math.min(1000 / 60, ms - elapsed);
            await h.tick(step); elapsed += step;
            seen.add(h.pet().dataset.state);
            assertVisibleBody(h, 'a reachable ledge must accommodate all rendered poses during the trip');
        }
    }
    await advanceVisible(1050);
    assert.equal(h.pet().dataset.destination, 'Right-edge technology chip');
    await advanceVisible(2500);
    assert.equal(h.pet().dataset.surface, 'Right-edge technology chip');
    assert.ok(Math.abs(h.position().y + footOffset(266) - ledge.top) < .01);
    const bodyLeft = h.position().x + parseFloat(h.pet().character.style.left);
    const bodyRight = bodyLeft + parseFloat(h.pet().character.style.width);
    assert.ok(bodyLeft >= 8 && bodyRight <= 892, 'opaque pixels stay clear of the right viewport edge');
    for (const pose of ['jump', 'fall', 'land']) assert.ok(seen.has(pose), `the trip exercises ${pose} geometry`);
});

test('a fully obstructed floor keeps the complete pet visible and recovers onto a newly available safe surface', async () => {
    const platforms = [];
    const h = harness({ platforms, zones: [{ left: 0, right: 900, top: 450, bottom: 700 }], random: () => .9 });
    await h.boot(); assertVisibleBody(h);
    for (let i = 0; i < 10; i++) { await h.tick(100); assertVisibleBody(h); }
    assert.notEqual(h.pet().dataset.sheltered, 'true');
    assert.notEqual(h.pet().dataset.sheltered, 'peek', 'fallback must not hide part of the character beyond an edge');
    const ledge = { name: 'New safe ledge', left: 100, right: 800, top: 400, bottom: 440 };
    platforms.push(ledge); h.window.fire('scroll');
    await h.advance(1500);
    h.document.fire('pointerover', { target: h.element(ledge) });
    await h.advance(3500);
    assert.equal(h.pet().dataset.surface, 'New safe ledge');
    assert.equal(h.pet().dataset.sheltered, 'false');
    assert.ok(Math.abs(h.position().y + footOffset(266) - ledge.top) < .01);
    assertVisibleBody(h);
});

test('a manually dragged drop ignores every DOM platform and lands only on the viewport floor', async () => {
    const platforms = [400, 500, 600].map(top => ({ name: `DOM ledge ${top}`, left: 100, right: 650, top, bottom: top + 40 }));
    const h = harness({ platforms, random: () => .9 }); await h.boot(); h.beginDrag();
    await h.move(280, 70, 200); await h.release(200);
    for (let i = 0; i < 12; i++) {
        await h.tick(100);
        assert.equal(h.pet().dataset.mode, 'free');
        assert.ok(['air', 'floor'].includes(h.pet().dataset.surface), 'manual drops must pass through site rectangles');
        assert.equal(h.pet().dataset.destination, undefined); assertVisibleBody(h);
    }
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.position().y, 418);
});

test('a manual jump clears a perched destination and passes through DOM surfaces on its way to the floor', async () => {
    const ledge = { name: 'Manual-jump ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await perch(h, ledge);
    await h.action('jump');
    assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.destination, undefined);
    for (let i = 0; i < 24; i++) {
        await h.tick(100);
        assert.ok(['air', 'floor'].includes(h.pet().dataset.surface)); assertVisibleBody(h);
    }
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.position().y, 418);
});

test('rapid scrolling during an autonomous jump cancels its goal and never applies DOM motion to viewport coordinates', async () => {
    const ledge = { name: 'Canceled ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await h.boot();
    h.document.fire('pointerover', { target: h.element(ledge) }); await h.advance(1050);
    assert.equal(h.pet().dataset.mode, 'exploring');
    for (let i = 0; i < 8; i++) {
        const before = h.position();
        ledge.top += i % 2 ? 80 : -65; ledge.bottom = ledge.top + 120;
        h.window.fire('scroll'); h.window.fire('scroll');
        assert.deepEqual(h.position(), before, 'each scroll event leaves the viewport position unchanged');
        assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.destination, undefined);
        await h.tick(50); assertVisibleBody(h);
        assert.ok(['air', 'floor'].includes(h.pet().dataset.surface), 'canceled goals cannot become accidental supports');
    }
    // Put the stale rectangle directly beneath the original trajectory; it still
    // cannot receive a landing without the pet choosing a new goal.
    ledge.top = 500; ledge.bottom = 620;
    for (let i = 0; i < 14; i++) {
        await h.tick(100);
        assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.destination, undefined);
        assert.ok(['air', 'floor'].includes(h.pet().dataset.surface));
    }
    assert.equal(h.pet().dataset.surface, 'floor'); assert.equal(h.position().y, 418);
});

test('a fresh autonomous goal after scrolling uses the current element rectangle rather than its canceled destination', async () => {
    const ledge = { name: 'Fresh destination', left: 80, right: 370, top: 490, bottom: 600 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await h.boot();
    h.document.fire('pointerover', { target: h.element(ledge) }); await h.advance(1050);
    assert.equal(h.pet().dataset.mode, 'exploring');
    const beforeScroll = h.position(); h.window.fire('scroll');
    assert.deepEqual(h.position(), beforeScroll);
    ledge.left = 450; ledge.right = 730; ledge.top = 450; ledge.bottom = 560;
    await h.advance(1500);
    assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.destination, undefined);
    h.document.fire('pointerover', { target: h.element(ledge) });
    await h.advance(1100);
    assert.equal(h.pet().dataset.mode, 'exploring'); assert.equal(h.pet().dataset.destination, 'Fresh destination');
    await h.advance(2500);
    assert.equal(h.pet().dataset.mode, 'perched'); assert.equal(h.pet().dataset.surface, 'Fresh destination');
    assert.ok(Math.abs(h.position().y + footOffset(266) - ledge.top) < .01);
    const feetX = h.position().x + manifest.animations.idle.geometry[0].footX * 228;
    assert.ok(feetX >= ledge.left + 6 && feetX <= ledge.right - 6); assertVisibleBody(h);
});

test('a deferred sit pose preserves an owned autonomous goal and sits after its natural landing', async () => {
    const ledge = { name: 'Owned sit ledge', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await h.boot();
    h.document.fire('pointerover', { target: h.element(ledge) }); await h.advance(1050);
    assert.equal(h.pet().dataset.mode, 'exploring'); const inFlight = h.position();
    await h.action('sit'); assert.deepEqual(h.position(), inFlight);
    assert.equal(h.pet().dataset.destination, 'Owned sit ledge');
    await h.advance(2500);
    assert.equal(h.pet().dataset.mode, 'perched'); assert.equal(h.pet().dataset.surface, 'Owned sit ledge');
    assert.equal(h.pet().dataset.state, 'sit');
    assert.ok(Math.abs(h.position().y + footOffset(266) - ledge.top) < .01);
});

test('a held pointer outside the pet suppresses autonomous goals until release and a fresh interaction cooldown', async () => {
    const ledge = { name: 'After-drag destination', left: 100, right: 650, top: 500, bottom: 620 };
    const h = harness({ platforms: [ledge], random: () => .9 }); await perch(h, ledge);
    const outside = h.element(ledge), supported = h.position();
    h.document.fire('pointerdown', { target: outside, pointerId: 7, isPrimary: true, button: 0, buttons: 1, pointerType: 'mouse' });
    assert.deepEqual(h.position(), supported);
    assert.equal(h.pet().dataset.mode, 'free');
    h.document.fire('pointerover', { target: outside });
    for (let i = 0; i < 40; i++) {
        h.document.fire('pointermove', { target: outside, pointerId: 7, buttons: 1, pointerType: 'mouse', clientX: 500, clientY: 600 });
        await h.tick(100);
        assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.destination, undefined);
        assert.ok(['air', 'floor'].includes(h.pet().dataset.surface)); assertVisibleBody(h);
    }
    assert.equal(h.pet().dataset.surface, 'floor');
    h.document.fire('pointerup', { target: outside, pointerId: 7, buttons: 0, pointerType: 'mouse' });
    h.document.fire('click', { target: outside });
    await h.advance(1000);
    assert.equal(h.pet().dataset.mode, 'free'); assert.equal(h.pet().dataset.destination, undefined);
    await h.advance(600);
    assert.equal(h.pet().dataset.mode, 'exploring'); assert.equal(h.pet().dataset.destination, 'After-drag destination');
    await h.advance(2500);
    assert.equal(h.pet().dataset.mode, 'perched'); assert.equal(h.pet().dataset.surface, 'After-drag destination');
});
