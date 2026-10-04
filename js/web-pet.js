/* Optional companion: no source frames, startup preloads, or site dependencies. */
(() => {
    'use strict';
    const ASSETS = '/assets/pet/manifest.json?v=4';
    const PHYSICS = {
        step: 1 / 120,
        gravity: 1100,
        airResistance: .35,
        groundFriction: 900,
        wallBounce: .36,
        ceilingBounce: .15,
        landingBounce: .12,
        maxThrowSpeed: 1100,
        throwWindowMs: 120,
        walkSpeed: 46,
        walkAcceleration: 170,
        jumpSpeed: 1000
    };
    const ONE_SHOT_STATES = new Set(['jump', 'land', 'dizzy']);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection;
    const constrained = Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType)));
    const readPreference = () => {
        try { return localStorage.getItem('hunterstar-pet') || 'play'; } catch { return 'play'; }
    };
    const storePreference = value => {
        try { localStorage.setItem('hunterstar-pet', value); } catch { /* Storage is optional. */ }
    };

    async function fetchAsset(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(url, { signal: controller.signal, priority: 'low' });
            if (!response.ok) throw new Error('Companion asset unavailable');
            return url.split('?')[0].endsWith('.json') ? await response.json() : await response.blob();
        } finally { clearTimeout(timer); }
    }

    async function decodeAsset(url) {
        const blob = await fetchAsset(url);
        if ('createImageBitmap' in window) return createImageBitmap(blob);
        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = objectUrl;
            await image.decode();
            return image;
        } finally { URL.revokeObjectURL(objectUrl); }
    }

    async function mount() {
        const restore = document.createElement('button');
        restore.className = 'pet-restore';
        restore.type = 'button';
        restore.textContent = 'Show companion';
        restore.hidden = readPreference() !== 'hidden';
        document.body.append(restore);
        let pet;
        let starting = false;
        let showRequested = false;

        async function show() {
            showRequested = true;
            storePreference('play');
            if (pet) { pet.show(); restore.hidden = true; return; }
            if (starting) return;
            starting = true;
            restore.disabled = true;
            try {
                const manifest = await fetchAsset(ASSETS);
                const boot = await decodeAsset(manifest.boot.src);
                pet = createPet(manifest, boot, restore);
                restore.hidden = true;
            } catch {
                // Failed pet assets never interrupt the portfolio or spin in a retry loop.
                restore.hidden = false;
                restore.textContent = 'Retry companion';
            } finally { starting = false; restore.disabled = false; }
        }
        restore.addEventListener('click', show);
        if (readPreference() !== 'hidden') {
            starting = true;
            try {
                const manifest = await fetchAsset(ASSETS);
                const boot = await decodeAsset(manifest.boot.src);
                pet = createPet(manifest, boot, restore);
                if (showRequested) pet.show();
            } catch { restore.hidden = false; restore.textContent = 'Retry companion'; }
            finally { starting = false; restore.disabled = false; }
        }
    }

    function createPet(manifest, boot, restore) {
        const root = document.createElement('div');
        root.className = 'web-pet';
        root.innerHTML = `
            <canvas width="192" height="224" aria-hidden="true"></canvas>
            <button type="button" class="pet-character" aria-label="Hunterstar companion. Double tap to talk, drag to move. Right-click or hold for controls." title="Double-tap to talk · Right-click or hold for controls" aria-controls="petTalkDialog" aria-haspopup="dialog"></button>
            <span class="pet-contact-shadow" aria-hidden="true"></span>
            <div class="pet-panel" id="petPanel" hidden>
                <p><strong>Little Hunterstar</strong>Double-tap to talk. Drag me around or give me a little toss.</p>
                <div class="pet-actions">
                    <button type="button" data-action="talk">Talk</button>
                    <button type="button" data-action="jump">Jump</button>
                    <button type="button" data-action="sit">Sit</button>
                    <button type="button" data-action="pause">Pause</button>
                    <button type="button" data-action="hide">Hide</button>
                </div>
            </div>`;
        document.body.append(root);
        const character = root.querySelector('.pet-character');
        const canvas = root.querySelector('canvas');
        canvas.width = manifest.frameWidth;
        canvas.height = manifest.frameHeight;
        const ctx = canvas.getContext('2d');
        const panel = root.querySelector('.pet-panel');
        const pause = root.querySelector('[data-action="pause"]');
        const shadow = root.querySelector('.pet-contact-shadow');
        if (!ctx) { root.remove(); boot.close?.(); throw new Error('Canvas unavailable'); }

        // At most three decoded atlases plus boot; release evicted bitmap memory.
        const cache = new Map();
        const pending = new Map();
        const failed = new Set();
        let loadQueue = Promise.resolve();
        let state = 'idle';
        let stateAt = performance.now();
        let nextAction = stateAt + 7000;
        let lastTime = 0;
        let accumulator = 0;
        let raf = 0;
        let enabled = !reducedMotion.matches && !constrained && readPreference() !== 'pause';
        let x = 22, y = 0, vx = 0, vy = 0;
        let facing = 1;
        let airborne = false;
        let landingBounce = false;
        let pointer = null;
        let suppressClick = false;
        let holdTimer = 0;
        let holdOpened = false;
        let lastTap = null;
        let chatActive = false;
        let chatThinking = false;
        let walkUntil = 0;
        let walkDirection = 1;
        let lastDraw = '';
        let lastPosition = '';
        let support = null;
        let walkTarget = null;
        let previousPlatform = null;
        let sitAfterLanding = false;
        let landingTarget = null;
        let interactionUntil = 0;
        const externalPointers = new Set();
        let interest = null;
        let cursor = null;
        let nextCursorResponse = 0;
        const visits = new WeakMap();
        let spriteWidth = root.offsetWidth, spriteHeight = root.offsetHeight;
        const bodyCache = new Map();
        const terrain = window.HunterstarPetWorld;
        const world = terrain?.create(root);
        let scenery = { surfaces: [], zones: [], interests: [] };
        root.dataset.state = state;
        root.dataset.mode = 'free';

        function bounds() {
            // Keep every pose inside the viewport, including outstretched airborne
            // arms. The canvas's transparent padding is allowed beyond the edge.
            const foot = anchor(), body = restingBody(Object.keys(manifest.animations));
            const left = 8 - foot.x - body.left;
            return { left, right: Math.max(left, innerWidth - 8 - foot.x - body.right),
                floor: Math.max(8, innerHeight - spriteHeight - 16) };
        }
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const approach = (value, target, amount) => value + clamp(target - value, -amount, amount);
        function measureSize() {
            const width = root.offsetWidth, height = root.offsetHeight;
            if (spriteWidth !== width || spriteHeight !== height) {
                spriteWidth = width; spriteHeight = height; bodyCache.clear(); lastDraw = '';
            }
        }
        function anchor() {
            const foot = manifest.animations.idle.geometry?.[0] || { footX: .5, footY: 1 };
            return { x: foot.footX * spriteWidth, y: foot.footY * spriteHeight };
        }
        function frameBody(geometry, direction) {
            const footX = direction < 0 ? 1 - geometry.footX : geometry.footX;
            const [left, top, right, bottom] = geometry.body;
            return { left: ((direction < 0 ? 1 - right : left) - footX) * spriteWidth,
                right: ((direction < 0 ? 1 - left : right) - footX) * spriteWidth,
                top: (top - geometry.footY) * spriteHeight,
                bottom: (bottom - geometry.footY) * spriteHeight };
        }
        function restingBody(names = ['idle', 'walk', 'sit']) {
            const key = names.join(':');
            if (bodyCache.has(key)) return bodyCache.get(key);
            const bodies = names.flatMap(name => (manifest.animations[name].geometry ||
                [{ footX: .5, footY: 1, body: [.2, .1, .8, 1] }])
                .flatMap(geometry => [1, -1].map(direction => frameBody(geometry, direction))));
            const body = { left: Math.min(...bodies.map(b => b.left)), right: Math.max(...bodies.map(b => b.right)),
                top: Math.min(...bodies.map(b => b.top)), bottom: Math.max(...bodies.map(b => b.bottom)) };
            bodyCache.set(key, body);
            return body;
        }
        function protectedBody() {
            return state === 'sit' ? restingBody(['sit']) : state === 'think'
                ? restingBody(['idle', 'walk', 'think']) : restingBody();
        }
        function floorSurface() {
            const foot = anchor();
            return { element: null, name: 'floor', left: 0, right: innerWidth, top: bounds().floor + foot.y };
        }
        function intervals(surface, body = restingBody()) {
            const foot = anchor();
            return terrain?.safeIntervals(surface, body, scenery.zones,
                { left: foot.x + bounds().left, right: foot.x + bounds().right, height: innerHeight }) ||
                [[foot.x + bounds().left, foot.x + bounds().right]];
        }
        function detach() {
            support = null; airborne = true; landingBounce = false;
            walkTarget = null; root.dataset.surface = 'air';
        }
        function releaseWorld(now = performance.now(), quietMs = 1400) {
            const wasSupported = Boolean(support);
            landingTarget = null; interest = null; walkTarget = null;
            support = null;
            interactionUntil = Math.max(interactionUntil, now + quietMs);
            nextAction = Math.max(nextAction, interactionUntil + 800);
            root.dataset.mode = 'free';
            delete root.dataset.destination;
            delete root.dataset.attention;
            world?.invalidate();
            if (wasSupported) {
                vy = 0; detach(); changeState('fall', now);
            } else if (!airborne && state === 'walk') {
                vx = 0; changeState('idle', now);
            }
        }
        function attach(surface) {
            const foot = anchor();
            y = surface.top - foot.y;
            support = surface.element ? { element: surface.element,
                fraction: (x + foot.x - surface.left) / (surface.right - surface.left), surface } : null;
            if (surface.element) visits.set(surface.element, performance.now());
            root.dataset.surface = surface.name;
            root.dataset.mode = surface.element ? 'perched' : 'free';
            if (!surface.element) landingTarget = null;
        }
        function followSurface() {
            if (!support || pointer || airborne) return;
            // An attached surface can leave the discovery viewport without ceasing to exist.
            const surface = world?.readSurface?.(support.element)
                || scenery.surfaces.find(s => s.element === support.element);
            if (!surface) { closePanel(); vy = 0; detach(); return; }
            const foot = anchor();
            const nextX = surface.left + support.fraction * (surface.right - surface.left) - foot.x;
            const nextY = surface.top - foot.y, body = protectedBody();
            // When scrolling would carry the character outside the viewport, leave
            // the element from the last visible position rather than following it away.
            if (nextX < bounds().left || nextX > bounds().right
                || surface.top + body.top < 8 || surface.top + body.bottom > innerHeight - 8) {
                closePanel(); vy = 0; detach(); changeState('fall'); return;
            }
            x = nextX; y = nextY;
            support.surface = surface;
        }
        function groundSurface() {
            return support?.surface || scenery.surfaces.find(s => s.element === support?.element) || floorSurface();
        }
        function protectContent(now) {
            if (now < interactionUntil || pointer || airborne || chatActive || !panel.hidden || !terrain) return;
            const surface = groundSurface(), foot = anchor();
            let safe = intervals(surface, protectedBody());
            if (!safe.length) {
                safe = intervals(surface, restingBody(['sit']));
                if (safe.length && state !== 'walk') { vx = 0; walkTarget = null; changeState('sit', now); }
            }
            const target = terrain.closestSpot(safe, x + foot.x);
            root.dataset.sheltered = 'false';
            if (target === null) {
                if (enabled && explore(now)) return;
                if (support) { vy = 0; detach(); }
                else restInClearArea(now);
                return;
            }
            if (Math.abs(target - x - foot.x) > 1) {
                walkTarget = target - foot.x;
                walkDirection = walkTarget > x ? 1 : -1;
                facing = walkDirection < 0 ? 1 : -1;
                if (enabled) changeState('walk', now);
                else { x = walkTarget; walkTarget = null; }
            }
        }
        function restInClearArea(now) {
            // Keep the entire pet visible even when no perfect gap exists. Prefer
            // blank space over text and controls; media is the last-resort backdrop.
            const body = restingBody(['sit']), foot = anchor();
            const limits = bounds(), feetY = floorSurface().top;
            let target = clamp(x, limits.left, limits.right), cost = Infinity;
            for (let candidate = limits.left; candidate <= limits.right + 1; candidate += 12) {
                const left = candidate + foot.x + body.left, right = candidate + foot.x + body.right;
                let obstruction = Math.abs(candidate - x) * .05;
                for (const zone of scenery.zones) {
                    const width = Math.min(right, zone.right) - Math.max(left, zone.left);
                    const height = Math.min(feetY + body.bottom, zone.bottom) - Math.max(feetY + body.top, zone.top);
                    if (width <= 0 || height <= 0) continue;
                    const media = /^(IFRAME|CANVAS|VIDEO|IMG)$/.test(zone.element?.tagName || '');
                    const control = zone.element?.matches?.('a,button,input,textarea,select,[role="button"]');
                    obstruction += width * height * (media ? .01 : control ? 100 : 10);
                }
                if (obstruction < cost) { cost = obstruction; target = candidate; }
            }
            x = clamp(target, limits.left, limits.right);
            vx = 0; walkTarget = null;
            root.dataset.sheltered = 'false';
            changeState('sit', now);
        }
        function explore(now, avoidCursor = false) {
            if (now < interactionUntil || !terrain || !scenery.surfaces.length) return false;
            const foot = anchor(), launchX = clamp(x, bounds().left, bounds().right);
            const start = { x: launchX + foot.x, y: y + foot.y };
            // Respect headroom instead of planning a jump through the viewport ceiling.
            const speed = Math.min(PHYSICS.jumpSpeed, Math.sqrt(2 * PHYSICS.gravity * Math.max(0, y - 12)));
            if (speed < 180) return false;
            const candidates = [];
            for (const surface of scenery.surfaces) {
                if (surface.element === support?.element || surface.top > floorSurface().top) continue;
                for (const [left, right] of intervals(surface)) {
                    const inset = Math.min(20, (right - left) / 2);
                    let spot = clamp(start.x, left + inset, right - inset), plan = null;
                    // Reserve braking room inside the safe interval. Landing at its
                    // nearest boundary with full momentum used to immediately slide off.
                    for (let attempt = 0; attempt < 4; attempt++) {
                        plan = terrain.jumpPlan(start, { x: spot, y: surface.top }, speed,
                            PHYSICS.gravity, PHYSICS.airResistance);
                        if (!plan) break;
                        const arrivalVx = plan.vx * Math.exp(-PHYSICS.airResistance * plan.time);
                        const stopping = arrivalVx * Math.abs(arrivalVx) / (2 * PHYSICS.groundFriction);
                        if (spot + stopping >= left + 2 && spot + stopping <= right - 2) break;
                        spot = clamp(spot - stopping, left + inset, right - inset);
                        if (attempt === 3) plan = null;
                    }
                    const distance = Math.hypot(spot - start.x, surface.top - start.y);
                    if (!plan || distance < 35) continue;
                    const recent = visits.get(surface.element);
                    const novelty = recent === undefined ? -100 : Math.max(0, 180 - (now - recent) / 100);
                    const attention = interest?.until > now && surface.element === interest.element ? -1500 : 0;
                    const cursorPenalty = avoidCursor && cursor ? Math.max(0, 220 - Math.abs(spot - cursor.x)) * 3 : 0;
                    candidates.push({ surface, plan, score: distance * .4 + novelty + attention + cursorPenalty
                        - (surface.interest || 0) * 12 + (surface.element === previousPlatform ? 220 : 0) });
                }
            }
            candidates.sort((a, b) => a.score - b.score);
            const target = candidates[0];
            if (!target) return false;
            previousPlatform = support?.element || null;
            x = launchX;
            root.dataset.sheltered = 'false';
            vx = target.plan.vx; vy = target.plan.vy;
            if (Math.abs(vx) > 1) facing = vx < 0 ? 1 : -1;
            detach(); accumulator = 0; changeState('jump', now);
            landingTarget = target.surface;
            root.dataset.mode = 'exploring';
            nextAction = now + 7000;
            root.dataset.destination = target.surface.name;
            return true;
        }
        function updateShadow() {
            if (!shadow) return;
            const foot = anchor(), feetY = y + foot.y, feetX = x + foot.x;
            const underneath = scenery.surfaces.filter(s => s.element === landingTarget?.element
                && feetX >= s.left && feetX <= s.right && s.top >= feetY - 1);
            const plane = airborne ? Math.min(floorSurface().top, ...underneath.map(s => s.top)) : feetY;
            const distance = Math.max(0, plane - feetY);
            shadow.style.left = `${foot.x}px`; shadow.style.top = `${plane - y}px`;
            shadow.style.opacity = pointer || root.dataset.sheltered === 'true' ? '0' : String(.25 * clamp(1 - distance / 140, 0, 1));
            shadow.style.transform = `translate(-50%, -50%) scale(${1 + Math.min(distance, 140) / 180})`;
        }
        function place() {
            updateShadow();
            const position = `translate3d(${x}px, ${y}px, 0)`;
            if (position !== lastPosition) {
                root.style.transform = position;
                lastPosition = position;
                document.dispatchEvent(new CustomEvent('hunterstar:pet-move', { detail: { pet: root } }));
            }
            if (panel.hidden) return;
            panel.style.left = `${clamp(x, 12, Math.max(12, innerWidth - panel.offsetWidth - 12)) - x}px`;
            panel.style.bottom = y < panel.offsetHeight + 20 ? 'auto' : 'calc(100% + 10px)';
            panel.style.top = y < panel.offsetHeight + 20 ? 'calc(100% + 10px)' : 'auto';
        }
        function closePanel() { panel.hidden = true; }
        function trimCache() {
            for (const [name, bitmap] of cache) {
                if (cache.size <= 3) break;
                if (name === 'idle' || name === state) continue;
                bitmap.close?.();
                cache.delete(name);
            }
        }
        function load(name) {
            if (cache.has(name)) {
                const image = cache.get(name);
                cache.delete(name); cache.set(name, image);
                return Promise.resolve(image);
            }
            if (failed.has(name)) return Promise.resolve(null);
            if (pending.has(name)) return pending.get(name);
            const task = loadQueue.then(async () => {
                if (root.hidden || document.hidden || !enabled) return null;
                try {
                    const image = await decodeAsset(manifest.animations[name].src);
                    cache.set(name, image);
                    trimCache();
                    if (name === state) stateAt = performance.now();
                    lastDraw = '';
                    return image;
                } catch { failed.add(name); return null; }
            }).finally(() => pending.delete(name));
            pending.set(name, task);
            loadQueue = task.catch(() => null);
            return task;
        }
        function changeState(name, now = performance.now()) {
            if (name === 'think' && !airborne && !pointer) {
                const foot = anchor(), body = restingBody(['think']);
                if (y + foot.y + body.top < 8 || (!chatActive && terrain
                    && !intervals(groundSurface(), body).some(([left, right]) => x + foot.x >= left && x + foot.x <= right))) name = 'idle';
            }
            if (state === name) return;
            state = name; stateAt = now; lastDraw = '';
            root.dataset.state = name;
            trimCache();
            if (enabled) void load(name);
        }
        function draw(now) {
            const active = enabled && cache.has(state) ? state : 'idle';
            const image = cache.get(active) || boot;
            const entry = manifest.animations[active];
            const elapsedFrame = Math.max(0, Math.floor((now - stateAt) / entry.frameMs));
            const frame = image === boot || !enabled ? 0 : ONE_SHOT_STATES.has(active)
                ? Math.min(elapsedFrame, entry.frames - 1) : elapsedFrame % entry.frames;
            const geometry = entry.geometry?.[frame];
            if (geometry) {
                const foot = anchor();
                canvas.style.transform = `translate(${foot.x - (facing < 0 ? 1 - geometry.footX : geometry.footX) * spriteWidth}px, ${foot.y - geometry.footY * spriteHeight}px)`;
                const body = frameBody(geometry, facing);
                character.style.left = `${foot.x + body.left}px`;
                character.style.top = `${foot.y + body.top}px`;
                character.style.width = `${body.right - body.left}px`;
                character.style.height = `${body.bottom - body.top}px`;
            }
            const key = `${active}:${frame}:${facing}:${image === boot}`;
            if (key === lastDraw) return;
            lastDraw = key;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            if (facing < 0) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
            const width = manifest.frameWidth, height = manifest.frameHeight;
            ctx.drawImage(image, image === boot ? 0 : (frame % entry.columns) * width,
                image === boot ? 0 : Math.floor(frame / entry.columns) * height,
                width, height, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
        function stepBody(dt, now, { left, right, floor }) {
            if (airborne) {
                const foot = anchor(), previousFeet = y + foot.y, previousY = y;
                const damping = Math.exp(-PHYSICS.airResistance * dt);
                vx *= damping;
                x += vx * dt;
                y += vy * dt + PHYSICS.gravity * dt * dt / 2;
                vy = (vy + PHYSICS.gravity * dt) * damping;
                if (x < left || x > right) { x = clamp(x, left, right); vx *= -PHYSICS.wallBounce; }
                if (y < 8 && (previousY >= 8 || vy < 0)) { y = 8; vy = Math.abs(vy) * PHYSICS.ceilingBounce; }
                if (vy >= 0 && !landingBounce) changeState('fall', now);
                const feetX = x + foot.x, feetY = y + foot.y;
                // Only a destination the pet chose becomes solid. Manual movement
                // ignores incidental DOM rectangles while keeping viewport physics.
                const selected = landingTarget && now >= interactionUntil
                    ? scenery.surfaces.find(s => s.element === landingTarget.element) : null;
                const surface = vy >= 0 ? [...(selected ? [selected] : []), floorSurface()]
                    .filter(s => previousFeet <= s.top + .5 && feetY >= s.top
                        && feetX >= s.left + 6 && feetX <= s.right - 6
                        && (!s.element || intervals(s).some(([left, right]) => feetX >= left && feetX <= right)))
                    .sort((a, b) => a.top - b.top)[0] : null;
                if (surface || y >= floor) {
                    const landing = surface || floorSurface();
                    const impact = Math.abs(vy);
                    y = landing.top - foot.y;
                    if (!landingBounce) {
                        changeState(impact > 950 || Math.abs(vx) > 850 ? 'dizzy' : 'land', now);
                        nextAction = now + 5000;
                    }
                    // Only a hard drop rebounds, once and just a few pixels.
                    if (!landingBounce && impact > 700) {
                        vy = -impact * PHYSICS.landingBounce;
                        landingBounce = true;
                    } else {
                        vy = 0; airborne = false; landingBounce = false;
                        attach(landing);
                        if (chatActive) changeState(chatThinking ? 'think' : 'idle', now);
                        delete root.dataset.destination;
                    }
                }
            } else if (state === 'walk') {
                const foot = anchor(), surface = groundSurface();
                const safe = intervals(surface);
                const current = safe.find(([left, right]) => x + foot.x >= left - 1 && x + foot.x <= right + 1);
                const end = walkTarget ?? (walkDirection < 0 ? (current?.[0] ?? surface.left + 6) - foot.x
                    : (current?.[1] ?? surface.right - 6) - foot.x);
                const distance = Math.abs(end - x), direction = Math.sign(end - x);
                const target = now < walkUntil ? walkDirection * PHYSICS.walkSpeed * clamp(distance / 28, 0, 1) : 0;
                const desired = walkTarget !== null ? direction * Math.min(70, distance * 4) : target;
                vx = approach(vx, desired, PHYSICS.walkAcceleration * dt);
                x = clamp(x + vx * dt, left, right);
                if ((Math.abs(vx) < 1 && (now >= walkUntil || distance < 1)) || (walkTarget !== null && distance < .6)) {
                    walkTarget = null;
                    vx = 0; changeState('idle', now);
                    nextAction = now + 6000 + Math.random() * 6000;
                }
            } else if (vx !== 0) {
                // Keep horizontal momentum on landing, then slow to a stop.
                const previousVx = vx;
                vx = approach(vx, 0, PHYSICS.groundFriction * dt);
                x += (previousVx + vx) * dt / 2;
                if (x < left || x > right) { x = clamp(x, left, right); vx *= -PHYSICS.wallBounce; }
            }
            if (!airborne && support) {
                const surface = groundSurface(), foot = anchor();
                if (x + foot.x < surface.left + 6 || x + foot.x > surface.right - 6) {
                    vy = 0; detach(); changeState('fall', now);
                } else support.fraction = (x + foot.x - surface.left) / (surface.right - surface.left);
            }
        }
        function run(now) {
            raf = 0;
            if (!enabled || root.hidden || document.hidden) return;
            if (externalPointers.size) interactionUntil = Math.max(interactionUntil, now + 1400);
            const dt = clamp((now - (lastTime || now)) / 1000, 0, .1);
            lastTime = now;
            measureSize();
            if (now >= interactionUntil) scenery = world?.scan(now) || scenery;
            followSurface();
            if (!pointer && !chatActive && panel.hidden && !airborne && now >= interactionUntil
                && now >= nextAction && interest?.until > now) explore(now);
            protectContent(now);
            const edges = bounds();
            if (!pointer && panel.hidden) {
                // Fixed steps give the same throw at 30, 60, and 144 Hz.
                accumulator += dt;
                while (accumulator + 1e-9 >= PHYSICS.step) {
                    stepBody(PHYSICS.step, now, edges);
                    accumulator = Math.max(0, accumulator - PHYSICS.step);
                }
                if (!chatActive && !airborne && Math.abs(vx) < 1) {
                    const recovery = manifest.animations[state].frameMs * manifest.animations[state].frames
                        + (state === 'dizzy' ? 600 : 180);
                    if (['land', 'dizzy'].includes(state) && now - stateAt > recovery) {
                        vx = 0; changeState(sitAfterLanding ? 'sit' : 'idle', now);
                        if (sitAfterLanding) nextAction = now + 12000;
                        sitAfterLanding = false;
                    } else if (now >= interactionUntil && state !== 'walk' && now >= nextAction) {
                        if (explore(now)) {
                            // The ballistic trajectory chooses the landing; no snapping to a goal.
                        } else if (state === 'sit' && !intervals(groundSurface()).length) {
                            nextAction = now + 6000;
                        } else if (Math.random() < .65 && edges.right > 80) {
                            const looking = interest?.until > now ? interest : null;
                            const center = looking?.element.getBoundingClientRect?.();
                            walkDirection = center ? (center.left + center.width / 2 > x + anchor().x ? 1 : -1)
                                : x > edges.right / 2 ? -1 : 1;
                            facing = walkDirection < 0 ? 1 : -1; // Source walking frames face left.
                            walkUntil = now + 2500 + Math.random() * 3500;
                            changeState('walk', now);
                        } else {
                            changeState(state === 'sit' || state === 'think' ? 'idle' : (Math.random() < .5 ? 'sit' : 'think'), now);
                            nextAction = now + 8000;
                        }
                    }
                }
                respondToCursor(now);
            } else accumulator = 0;
            place(); draw(now);
            raf = requestAnimationFrame(run);
        }
        function startLoop() {
            if (enabled && !root.hidden && !document.hidden && !raf) {
                lastTime = 0;
                nextAction = performance.now() + 7000;
                void load(state);
                raf = requestAnimationFrame(run);
            }
        }
        function stopLoop() { cancelAnimationFrame(raf); raf = 0; lastTime = 0; accumulator = 0; }
        function updatePause() {
            pause.textContent = enabled ? 'Pause' : 'Animate';
            root.querySelector('[data-action="jump"]').disabled = !enabled;
            root.querySelector('[data-action="sit"]').disabled = !enabled;
        }
        function settle() {
            measureSize();
            airborne = false; landingBounce = false; vx = 0; vy = 0; accumulator = 0;
            walkTarget = null;
            scenery = world?.scan(performance.now(), true) || scenery;
            x = clamp(x, bounds().left, bounds().right);
            if (support) followSurface();
            else {
                const foot = anchor(), feetX = x + foot.x, feetY = y + foot.y;
                const selected = landingTarget ? scenery.surfaces.filter(s => s.element === landingTarget.element) : [];
                const landing = [...selected, floorSurface()].filter(s => s.top >= feetY - 1
                    && feetX >= s.left + 6 && feetX <= s.right - 6
                    && (!s.element || intervals(s).some(([left, right]) => feetX >= left && feetX <= right)))
                    .sort((a, b) => a.top - b.top)[0] || floorSurface();
                attach(landing);
            }
            changeState('idle'); lastDraw = ''; place(); draw(performance.now());
            protectContent(performance.now());
        }
        function noticeElement(event) {
            if (!event.target || root.contains(event.target) || pointer || chatActive) return;
            const now = performance.now();
            if (event.type === 'focusin' || event.type === 'click') releaseWorld(now);
            scenery = world?.scan(now) || scenery;
            const targets = [...(scenery.interests || []), ...scenery.surfaces];
            const noticed = targets.filter(t => t.element === event.target || t.element.contains?.(event.target))
                .sort((a, b) => (a.right - a.left) - (b.right - b.left))[0];
            if (!noticed) return;
            interest = { element: noticed.element, name: noticed.name, until: now + 8000 };
            root.dataset.attention = noticed.name;
            const rect = noticed.element.getBoundingClientRect();
            facing = rect.left + rect.width / 2 < x + anchor().x ? 1 : -1;
            nextAction = Math.max(interactionUntil, Math.min(nextAction, now + 900));
            if (!enabled) draw(now);
        }
        function respondToCursor(now) {
            if (now < interactionUntil || !cursor || now < nextCursorResponse || chatActive || pointer || airborne) return;
            const foot = anchor(), body = restingBody(['idle']);
            const centerX = x + foot.x, centerY = y + foot.y + body.top / 2;
            if (Math.hypot(cursor.x - centerX, cursor.y - centerY) > 110) return;
            facing = cursor.x < centerX ? 1 : -1;
            if (now - cursor.at > 2000) return;
            nextCursorResponse = now + 7000;
            if (Math.abs(cursor.x - centerX) < 55 && explore(now, true)) return;
            const safe = intervals(groundSurface()).find(([left, right]) => centerX >= left && centerX <= right);
            if (!safe) return;
            walkTarget = clamp(centerX + (cursor.x < centerX ? 45 : -45), safe[0], safe[1]) - foot.x;
            if (Math.abs(walkTarget - x) > 8) {
                walkDirection = Math.sign(walkTarget - x); changeState('walk', now);
            } else walkTarget = null;
        }
        document.addEventListener('pointerover', noticeElement);
        document.addEventListener('focusin', noticeElement);
        document.addEventListener('click', noticeElement);
        document.addEventListener('pointermove', event => {
            if (event.pointerType === 'touch' || root.contains(event.target)) return;
            if (event.buttons) {
                externalPointers.add(event.pointerId ?? 0);
                releaseWorld(performance.now());
            } else if (event.buttons === 0 && externalPointers.size) {
                externalPointers.clear(); releaseWorld(performance.now());
            }
            cursor = { x: event.clientX, y: event.clientY, at: performance.now() };
        }, { passive: true });

        character.addEventListener('pointerdown', event => {
            if (!event.isPrimary) return;
            holdOpened = false;
            if (event.button !== 0) return;
            closePanel();
            releaseWorld(performance.now());
            clearTimeout(holdTimer);
            suppressClick = false;
            character.setPointerCapture(event.pointerId);
            pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
                offsetX: event.clientX - x, offsetY: event.clientY - y, moved: false,
                samples: [{ x, y, time: event.timeStamp }] };
            walkTarget = null;
            accumulator = 0;
            holdTimer = setTimeout(() => {
                if (!pointer || pointer.moved) return;
                holdOpened = true;
                pointer.held = true; suppressClick = true; lastTap = null;
                togglePanel();
            }, 550);
        });
        function samplePointer(time) {
            pointer.samples.push({ x, y, time });
            const cutoff = time - PHYSICS.throwWindowMs;
            while (pointer.samples.length > 2 && pointer.samples[1].time <= cutoff) pointer.samples.shift();
        }
        character.addEventListener('pointermove', event => {
            if (!pointer || pointer.id !== event.pointerId) return;
            if (pointer.held) return;
            if (!pointer.moved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5) return;
            clearTimeout(holdTimer); lastTap = null;
            pointer.moved = true;
            support = null;
            root.dataset.sheltered = 'false';
            x = clamp(event.clientX - pointer.offsetX, bounds().left, bounds().right);
            y = clamp(event.clientY - pointer.offsetY, 8, bounds().floor);
            samplePointer(event.timeStamp);
            vx = 0; vy = 0; landingBounce = false;
            changeState('drag'); place(); draw(performance.now());
        });
        function release(event) {
            if (!pointer || pointer.id !== event.pointerId) return;
            clearTimeout(holdTimer);
            const moved = pointer.moved;
            if (moved && enabled && event.type === 'pointerup') {
                samplePointer(event.timeStamp);
                const samples = pointer.samples;
                let first = samples[0];
                const last = samples[samples.length - 1];
                const cutoff = last.time - PHYSICS.throwWindowMs;
                if (first.time < cutoff && samples[1].time > first.time) {
                    const ratio = clamp((cutoff - first.time) / (samples[1].time - first.time), 0, 1);
                    first = { x: first.x + (samples[1].x - first.x) * ratio,
                        y: first.y + (samples[1].y - first.y) * ratio, time: cutoff };
                }
                const elapsed = Math.max(16, last.time - first.time) / 1000;
                vx = (last.x - first.x) / elapsed * .9;
                vy = (last.y - first.y) / elapsed * .9;
                const speed = Math.hypot(vx, vy);
                if (speed > PHYSICS.maxThrowSpeed) {
                    vx *= PHYSICS.maxThrowSpeed / speed; vy *= PHYSICS.maxThrowSpeed / speed;
                }
            } else if (moved) { vx = 0; vy = 0; }
            pointer = null;
            if (moved) {
                suppressClick = true;
                setTimeout(() => { suppressClick = false; }, 0);
                if (enabled) {
                    releaseWorld(performance.now());
                    detach(); accumulator = 0;
                    nextAction = performance.now() + 5000;
                    changeState(vy < -80 ? 'jump' : 'fall');
                }
                else settle();
            }
        }
        character.addEventListener('pointerup', release);
        character.addEventListener('pointercancel', release);
        character.addEventListener('lostpointercapture', release);
        function togglePanel() {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) {
                releaseWorld(performance.now());
                document.dispatchEvent(new CustomEvent('hunterstar:pet-controls'));
            }
            place();
            if (!panel.hidden) panel.querySelector('button').focus();
        }
        function talk() {
            closePanel(); lastTap = null;
            releaseWorld(performance.now());
            document.dispatchEvent(new CustomEvent('hunterstar:pet-talk', { detail: { pet: root } }));
        }
        character.addEventListener('click', event => {
            // Keyboard activation talks immediately; pointer activation needs two close taps.
            if (event.detail === 0) { talk(); return; }
            if (suppressClick) { lastTap = null; return; }
            const now = performance.now();
            if (lastTap && now - lastTap.time <= 380
                && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 30) talk();
            else lastTap = { time: now, x: event.clientX, y: event.clientY };
        });
        character.addEventListener('contextmenu', event => {
            event.preventDefault(); clearTimeout(holdTimer); lastTap = null;
            if (holdOpened) return;
            if (pointer) pointer.held = true;
            suppressClick = true; togglePanel();
        });
        document.addEventListener('hunterstar:chat-state', event => {
            chatActive = event.detail.active;
            chatThinking = Boolean(event.detail.thinking);
            if (!pointer && !airborne) {
                vx = 0;
                changeState(event.detail.thinking ? 'think' : 'idle');
                draw(performance.now());
            }
            nextAction = performance.now() + 7000;
        });
        document.addEventListener('pointerdown', event => {
            if (!root.contains(event.target)) {
                externalPointers.add(event.pointerId ?? 0);
                closePanel(); releaseWorld(performance.now());
            }
        });
        const finishExternalInput = event => {
            if (externalPointers.delete(event.pointerId ?? 0)) releaseWorld(performance.now());
        };
        document.addEventListener('pointerup', finishExternalInput);
        document.addEventListener('pointercancel', finishExternalInput);
        document.addEventListener('keydown', event => {
            if (!root.contains(event.target) && event.target?.matches?.('input,textarea,select,button,a[href],[role="button"],[contenteditable="true"]')) {
                releaseWorld(performance.now());
            }
        });
        root.addEventListener('keydown', event => {
            if (event.key === 'Escape') { closePanel(); character.focus(); }
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault(); togglePanel();
            }
        });
        panel.addEventListener('click', event => {
            const action = event.target.dataset.action;
            if (!action) return;
            if (action === 'hide') {
                root.hidden = true; stopLoop(); closePanel();
                document.dispatchEvent(new CustomEvent('hunterstar:pet-hidden'));
                storePreference('hidden'); restore.hidden = false; restore.textContent = 'Show companion'; restore.focus();
            } else if (action === 'talk') {
                talk();
            } else if (action === 'pause') {
                enabled = !enabled;
                storePreference(enabled ? 'play' : 'pause');
                updatePause(); accumulator = 0; lastDraw = ''; draw(performance.now());
                if (enabled) startLoop(); else stopLoop();
            } else if (enabled) {
                closePanel(); character.focus();
                if (action === 'jump') {
                    sitAfterLanding = false;
                    releaseWorld(performance.now());
                    vy = -PHYSICS.jumpSpeed; detach();
                    accumulator = 0; changeState('jump');
                }
                if (action === 'sit') {
                    if (airborne) sitAfterLanding = true;
                    else { vx = 0; walkTarget = null; changeState('sit'); nextAction = performance.now() + 12000; }
                }
            }
        });
        function resize() {
            measureSize();
            scenery = world?.scan(performance.now(), true) || scenery;
            if (!airborne && !pointer && support) followSurface();
            else {
                x = clamp(x, bounds().left, bounds().right);
                if (!airborne && !pointer) y = bounds().floor;
                else y = Math.min(y, bounds().floor);
            }
            if (airborne) {
                const foot = anchor(), body = protectedBody(), edges = bounds();
                x = clamp(x, edges.left, edges.right);
                y = clamp(y, 8 - foot.y - body.top, edges.floor);
            }
            protectContent(performance.now());
            place();
        }
        window.addEventListener('resize', resize);
        window.addEventListener('scroll', () => {
            // Input owns the scene. Release old support before reading new bounds;
            // discover fresh destinations after the scrolling cooldown.
            releaseWorld(performance.now());
            place();
        }, { passive: true, capture: true });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                externalPointers.clear();
                stopLoop();
                if (pointer?.moved) { pointer = null; detach(); changeState('fall'); }
                else pointer = null;
            } else startLoop();
        });
        reducedMotion.addEventListener('change', () => {
            if (reducedMotion.matches) { enabled = false; stopLoop(); updatePause(); draw(performance.now()); }
        });
        y = bounds().floor;
        scenery = world?.scan(performance.now(), true) || scenery;
        root.dataset.surface = 'floor';
        const firstSpot = terrain?.closestSpot(intervals(floorSurface()), x + anchor().x);
        if (firstSpot !== null && firstSpot !== undefined) x = firstSpot - anchor().x;
        protectContent(performance.now());
        place(); draw(performance.now()); updatePause(); startLoop();
        return { show() {
            root.hidden = false;
            enabled = !reducedMotion.matches && !constrained;
            updatePause(); settle(); startLoop();
        } };
    }

    // Pet work begins after the page load, outside the critical rendering path.
    function schedule() {
        const begin = () => { void mount().catch(() => {}); };
        if ('requestIdleCallback' in window) requestIdleCallback(begin, { timeout: 3000 });
        else setTimeout(begin, 1000);
    }
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
})();
