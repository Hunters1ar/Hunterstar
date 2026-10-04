const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/pet-world.js'), 'utf8'), context);
const { safeIntervals, closestSpot, jumpPlan } = context.window.HunterstarPetWorld;
const surface = { left: 100, right: 400, top: 300 };
const body = { left: -40, right: 40, top: -100, bottom: 0 };
const limits = { left: 0, right: 800, height: 700 };
const plain = value => JSON.parse(JSON.stringify(value));

test('protected glyphs cut out unsafe resting spots while card content below stays clear', () => {
    assert.deepEqual(plain(safeIntervals(surface, body, [{ left: 100, right: 400, top: 310, bottom: 350 }], limits)), [[106, 394]]);
    const intervals = safeIntervals(surface, body, [{ left: 190, right: 240, top: 230, bottom: 290 }], limits);
    assert.deepEqual(plain(intervals), [[106, 144], [286, 394]]);
    assert.equal(closestSpot(intervals, 200), 144);
});

test('fully obstructed and offscreen surfaces cannot be selected as resting spots', () => {
    assert.equal(safeIntervals(surface, body, [{ left: 0, right: 800, top: 0, bottom: 700 }], limits).length, 0);
    assert.equal(safeIntervals({ ...surface, top: 90 }, body, [], limits).length, 0);
    assert.equal(closestSpot([], 220), null);
});

test('jump planner includes drag and rejects unreachable height and distance', () => {
    const start = { x: 200, y: 650 };
    const target = { x: 450, y: 500 };
    const plan = jumpPlan(start, target, 900, 1100, .35);
    assert.ok(plan && plan.vx > 0 && plan.vx <= 420 && plan.time > 0);
    const dt = 1 / 120, damping = Math.exp(-.35 * dt);
    let x = start.x, y = start.y, vx = plan.vx, vy = plan.vy;
    for (let time = dt; time <= plan.time + 1e-6; time += dt) {
        vx *= damping; x += vx * dt; y += vy * dt + 1100 * dt * dt / 2; vy = (vy + 1100 * dt) * damping;
    }
    assert.ok(Math.abs(x - target.x) < .01);
    assert.ok(y >= target.y && y - target.y < 10);
    assert.equal(jumpPlan(start, { x: 200, y: 100 }, 900, 1100, .35), null);
    assert.equal(jumpPlan(start, { x: 1400, y: 500 }, 900, 1100, .35), null);
});

test('every packed frame carries contact and opaque-body metadata', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/pet/manifest.json'), 'utf8'));
    for (const entry of Object.values(manifest.animations)) {
        assert.equal(entry.geometry.length, entry.frames);
        for (const geometry of entry.geometry) {
            assert.ok(geometry.footX > 0 && geometry.footX < 1 && geometry.footY > 0 && geometry.footY < 1);
            assert.equal(geometry.body.length, 4);
            assert.ok(geometry.body.every(value => value >= 0 && value <= 1));
        }
    }
});

// A small DOM fixture with real text nodes, Range rectangles, visibility ancestry
// and selector discovery. The scanner receives DOM objects, not prebuilt surfaces.
function scannerFixture() {
    const rectangle = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
    function match(element, selector) {
        return selector.split(',').some(part => {
            part = part.trim();
            if (part.includes(' > ')) {
                const [parent, child] = part.split(' > ');
                return match(element, child) && element.parentElement && match(element.parentElement, parent);
            }
            if (part.startsWith('.')) return element.className.split(' ').includes(part.slice(1));
            if (/^[a-z]+\[/.test(part)) {
                const split = part.indexOf('[');
                return match(element, part.slice(0, split)) && match(element, part.slice(split));
            }
            if (part.startsWith('[')) {
                const [, name, value] = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || [];
                return name && Object.hasOwn(element.attributes, name) && (value === undefined || element.attributes[name] === value);
            }
            return element.tagName.toLowerCase() === part;
        });
    }
    class Element {
        constructor(tag, box = rectangle(0, 0, 900, 700), attributes = {}) {
            this.nodeType = 1; this.tagName = tag.toUpperCase(); this.box = box;
            this.attributes = attributes; this.className = attributes.class || ''; this.dataset = {};
            if (Object.hasOwn(attributes, 'data-pet-platform')) this.dataset.petPlatform = attributes['data-pet-platform'];
            this.childNodes = []; this.isConnected = true; this.hidden = Boolean(attributes.hidden);
            this.style = { display: 'block', visibility: 'visible', opacity: '1' };
        }
        get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
        append(...nodes) { for (const node of nodes) { node.parentElement = this; this.childNodes.push(node); } return this; }
        contains(node) { return node === this || this.childNodes.some(child => child.nodeType === 1 ? child.contains(node) : child === node); }
        matches(selector) { return match(this, selector); }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
        getAttribute(name) { return this.attributes[name] ?? null; }
        getBoundingClientRect() { return this.box; }
    }
    const body = new Element('body'), root = new Element('div', rectangle(22, 430, 228, 266), { class: 'web-pet' });
    body.append(root);
    const allElements = element => [element, ...element.childNodes.filter(node => node.nodeType === 1).flatMap(allElements)];
    const allText = element => element.childNodes.flatMap(node => node.nodeType === 3 ? [node] : allText(node));
    let mutation, queryCount = 0;
    const document = {
        body,
        querySelectorAll(selector) { queryCount++; return allElements(body).filter(element => element.matches(selector)); },
        createRange() { let selected; return { selectNodeContents(node) { selected = node; }, getClientRects() { return selected.rects; } }; },
        createTreeWalker(element) {
            const nodes = allText(element); let index = -1;
            return { nextNode() { this.currentNode = nodes[++index]; return this.currentNode || null; }, currentNode: null };
        }
    };
    const listeners = {};
    const context = {
        document, innerWidth: 900, innerHeight: 700,
        window: { addEventListener(type, callback) { listeners[type] = callback; } },
        getComputedStyle(element) { return element.style; },
        MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
        ResizeObserver: class { observe() {} }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/pet-world.js'), 'utf8'), context);
    return {
        rectangle, Element, root, body, world: context.window.HunterstarPetWorld.create(root), listeners,
        text(value, ...rects) { return { nodeType: 3, textContent: value, rects }; },
        mutation(record) { mutation([record]); }, queryCount: () => queryCount
    };
}

test('DOM discovery includes measured headings, controls, technologies and site shells without card annotations', () => {
    const f = scannerFixture(), box = f.rectangle;
    const heading = new f.Element('h2', box(20, 280, 820, 44))
        .append(f.text('Technologies I Use', box(80, 288, 250, 32)));
    const button = new f.Element('button', box(420, 410, 140, 44), { 'aria-label': 'Run terminal command' });
    const tech = new f.Element('span', box(50, 400, 100, 32)).append(f.text('Python', box(66, 407, 60, 18)));
    const cloud = new f.Element('div', box(20, 390, 800, 100), { class: 'tech-cloud' }).append(tech);
    const form = new f.Element('form', box(30, 510, 600, 140));
    const media = new f.Element('div', box(650, 480, 200, 160), { class: 'game-frame-shell' });
    const footer = new f.Element('footer', box(0, 650, 900, 50));
    f.body.append(heading, button, cloud, form, media, footer);
    const { surfaces, interests } = f.world.scan(100);
    assert.deepEqual(plain(surfaces.map(({ kind }) => kind)), ['heading', 'control', 'technology', 'form', 'media', 'footer']);
    const ledge = surfaces.find(surface => surface.element === heading);
    assert.deepEqual([ledge.left, ledge.right, ledge.top], [80, 330, 288], 'a full-width heading row is not an invisible platform');
    assert.equal(interests.find(target => target.element === button).name, 'Run terminal command');
    assert.ok(interests.every(target => target.interest > 0));
});

test('all visible text is protected including rich text and aria-hidden visual labels, without duplicate control glyphs', () => {
    const f = scannerFixture(), box = f.rectangle;
    const terminal = new f.Element('div', box(30, 260, 600, 60), { class: 'terminal-topbar', 'aria-hidden': 'true' })
        .append(f.text('hunterstar@portfolio', box(50, 275, 200, 20)));
    const strong = new f.Element('strong', box(50, 350, 100, 20)).append(f.text('Role:', box(50, 350, 50, 20)));
    const code = new f.Element('code', box(110, 350, 120, 20)).append(f.text('backend', box(110, 350, 100, 20)));
    const output = new f.Element('div', box(30, 340, 600, 40)).append(strong, code,
        f.text('direct output', box(260, 350, 150, 20)));
    const button = new f.Element('button', box(50, 430, 140, 40)).append(f.text('Run', box(80, 440, 40, 20)));
    const petLabel = new f.Element('span', box(22, 450, 80, 20)).append(f.text('Pet UI', box(22, 450, 80, 20)));
    f.root.append(petLabel); f.body.append(terminal, output, button);
    const { zones } = f.world.scan(100);
    assert.deepEqual(plain(zones.map(zone => [zone.left, zone.top, zone.right, zone.bottom])), [
        [50, 430, 190, 470], [50, 275, 250, 295], [50, 350, 100, 370], [110, 350, 210, 370], [260, 350, 410, 370]
    ]);
    assert.equal(zones.some(zone => zone.element === petLabel), false);
});

test('hidden ancestors exclude surfaces and content while visible aria-hidden decorations remain real', () => {
    const f = scannerFixture(), box = f.rectangle;
    const hidden = new f.Element('div', box(30, 300, 500, 100)); hidden.style.display = 'none';
    hidden.append(new f.Element('button', box(40, 320, 100, 40)).append(f.text('hidden', box(50, 330, 60, 20))));
    const transparent = new f.Element('button', box(200, 320, 100, 40)); transparent.style.opacity = '0';
    const visual = new f.Element('h2', box(400, 300, 200, 40), { 'aria-hidden': 'true', inert: '' })
        .append(f.text('Visible heading', box(405, 305, 180, 30)));
    const background = new f.Element('div', box(0, 0, 900, 700), { class: 'canvas-container' })
        .append(new f.Element('canvas', box(0, 0, 900, 700)));
    f.body.append(hidden, transparent, visual, background);
    const { surfaces, zones } = f.world.scan(100);
    assert.deepEqual(plain(surfaces.map(surface => surface.kind)), ['heading']);
    assert.deepEqual(plain(zones.map(zone => [zone.left, zone.top])), [[405, 305]]);
});

test('live geometry follows moving elements and scrolling, then drops disconnected support', () => {
    const f = scannerFixture(), box = f.rectangle;
    const control = new f.Element('button', box(100, 300, 160, 44));
    f.body.append(control);
    const initial = f.world.scan(100).surfaces[0], count = f.queryCount();
    control.box = box(140, 350, 160, 44);
    const moved = f.world.scan(116).surfaces[0];
    assert.deepEqual([moved.left, moved.top], [140, 350]);
    assert.equal(f.queryCount(), count, 'geometry refresh does not rediscover the whole DOM each frame');
    control.box = box(140, -60, 160, 44);
    assert.equal(f.world.scan(132).surfaces.length, 0);
    assert.equal(f.world.readSurface(initial).top, -60, 'support survives a viewport exit while scrolling');
    control.isConnected = false;
    assert.equal(f.world.refresh(control), null);
});

test('DOM changes rescan new elements and text, while pet rendering cannot invalidate the world every frame', () => {
    const f = scannerFixture(), box = f.rectangle;
    f.world.scan(100); const count = f.queryCount();
    f.mutation({ target: f.root });
    f.world.scan(116); assert.equal(f.queryCount(), count);
    const link = new f.Element('a', box(80, 410, 180, 40), { href: '#contact' });
    f.body.append(link); f.mutation({ target: f.body });
    assert.equal(f.world.scan(132).surfaces[0].element, link);
    const label = f.text('Get in touch', box(90, 420, 140, 20));
    link.append(label); f.mutation({ target: label });
    assert.equal(f.world.scan(148).interests[0].name, 'Get in touch');
});

test('a pet can touch its own ledge while unrelated text above still blocks a landing', () => {
    const f = scannerFixture(), box = f.rectangle;
    const button = new f.Element('button', box(100, 300, 300, 44)); f.body.append(button);
    const world = f.world.scan(100), ledge = world.surfaces[0];
    const feetBody = { ...body, bottom: 5 };
    assert.deepEqual(plain(safeIntervals(ledge, feetBody, world.zones, limits)), [[106, 394]]);
    const contentAbove = { left: 100, right: 400, top: 230, bottom: 290, element: new f.Element('p') };
    assert.equal(safeIntervals(ledge, feetBody, [...world.zones, contentAbove], limits).length, 0);
});

test('text clipped by a scrolling terminal protects only its visible glyphs', () => {
    const f = scannerFixture(), box = f.rectangle;
    const log = new f.Element('div', box(50, 200, 400, 120)); log.style.overflowY = 'auto';
    const output = new f.Element('div', box(50, 150, 400, 230)).append(
        f.text('old output above', box(60, 160, 200, 20)),
        f.text('partly visible', box(60, 190, 200, 25)),
        f.text('current output', box(60, 260, 200, 20)),
        f.text('below clipped window', box(60, 350, 200, 20))
    );
    log.append(output); f.body.append(log);
    const { zones } = f.world.scan(100);
    assert.deepEqual(plain(zones.map(zone => [zone.top, zone.bottom])), [[200, 215], [260, 280]]);
});
