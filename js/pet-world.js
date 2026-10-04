/* DOM surfaces and protected content; geometry is sampled outside physics steps. */
(() => {
    'use strict';
    const SEMANTIC = 'h1,h2,h3,h4,[role="heading"],button,a[href],input,textarea,select,[role="button"],.tech-cloud > span,.portfolio-terminal,.terminal-topbar,.terminal-sidecar-panel,.terminal-command-row,.game-menu-bar,.game-frame-shell,.emblem-stage,.server-room-stage,iframe,form,.redline-contact-panel,footer,.footer,.index-card,.stat-card,.project-card,.skill-card';
    const PROTECTED = 'h1,h2,h3,h4,p,li,span,label,a,button,input,textarea,select,strong,em,code,kbd,pre,div,[data-pet-protect],img,svg,canvas,video,iframe,.card-tab,.card-icon,.proficiency-label';
    const SOLID_CONTENT = 'a,button,input,textarea,select,[role="button"],[data-pet-protect],img,svg,canvas,video,iframe';
    const EXCLUDED = '.web-pet,.pet-speech,.pet-talk-dialog,.pet-panel,.pet-restore,[data-pet-ignore],script,style,template,noscript';
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    function safeIntervals(surface, body, zones, limits, margin = 6) {
        if (surface.top + body.top < 8 || surface.top + body.bottom > limits.height - 8) return [];
        let intervals = [[Math.max(surface.left + 6, limits.left), Math.min(surface.right - 6, limits.right)]];
        if (intervals[0][0] > intervals[0][1]) return [];
        for (const zone of zones) {
            // The sole may touch its own ledge. Do not turn the text or button
            // that provides a perch into an obstacle to that same perch.
            const ownContent = surface.element && zone.element
                && (surface.element === zone.element || surface.element.contains?.(zone.element));
            if (ownContent && body.bottom <= 8 && zone.top >= surface.top - .5
                && surface.top + body.bottom <= zone.top + 8) continue;
            if (surface.top + body.bottom <= zone.top - margin || surface.top + body.top >= zone.bottom + margin) continue;
            const forbiddenLeft = zone.left - body.right - margin;
            const forbiddenRight = zone.right - body.left + margin;
            intervals = intervals.flatMap(([left, right]) => {
                if (forbiddenRight <= left || forbiddenLeft >= right) return [[left, right]];
                const kept = [];
                if (forbiddenLeft > left) kept.push([left, Math.min(right, forbiddenLeft)]);
                if (forbiddenRight < right) kept.push([Math.max(left, forbiddenRight), right]);
                return kept;
            });
        }
        return intervals;
    }

    function closestSpot(intervals, anchor) {
        let best = null;
        for (const [left, right] of intervals) {
            const spot = Math.max(left, Math.min(right, anchor));
            if (best === null || Math.abs(spot - anchor) < Math.abs(best - anchor)) best = spot;
        }
        return best;
    }

    function jumpPlan(start, target, speed, gravity, drag, maxVx = 420) {
        // Use the same fixed-step integration as the pet, including air resistance.
        let y = start.y, vy = -speed, travel = 0, unitVx = 1;
        const dt = 1 / 120, damping = Math.exp(-drag * dt);
        for (let time = dt; time <= 3; time += dt) {
            const previous = y;
            unitVx *= damping; travel += unitVx * dt;
            y += vy * dt + gravity * dt * dt / 2;
            vy = (vy + gravity * dt) * damping;
            if (vy > 0 && previous <= target.y && y >= target.y) {
                const vx = (target.x - start.x) / travel;
                return Math.abs(vx) <= maxVx ? { vx, vy: -speed, time } : null;
            }
        }
        return null;
    }

    function create(root) {
        let dirty = true, lastScan = -Infinity, candidates = [], surfaces = [], zones = [], interests = [];
        const descriptors = new WeakMap();
        let visibility = new WeakMap();
        const invalidate = () => { dirty = true; };
        window.addEventListener('scroll', invalidate, { passive: true, capture: true });
        window.addEventListener('resize', invalidate, { passive: true });
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidate) : null;
        const observed = new WeakSet();
        const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(records => {
            if (records.some(record => !root.contains(record.target)
                && !record.target.closest?.(EXCLUDED))) invalidate();
        }) : null;
        mutationObserver?.observe(document.body, { childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-pet-platform', 'data-pet-ignore'] });

        const matches = (element, selector) => Boolean(element.matches?.(selector));
        function visible(element) {
            if (!element || element.isConnected === false || root.contains(element) || element.closest?.(EXCLUDED)) return false;
            if (visibility.has(element)) return visibility.get(element);
            let result = !element.hidden;
            if (result && typeof getComputedStyle === 'function') {
                const style = getComputedStyle(element);
                result = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
                    && style.contentVisibility !== 'hidden' && Number(style.opacity || 1) > .01;
            }
            if (result && element.parentElement) result = visible(element.parentElement);
            visibility.set(element, result);
            return result;
        }
        const onScreen = rect => rect.width > 1 && rect.height > 1 && rect.bottom > 0
            && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
        function clippedRect(rect, element) {
            let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
            let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
            for (let parent = element.parentElement; parent && typeof getComputedStyle === 'function'; parent = parent.parentElement) {
                const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
                if (/^(hidden|clip|scroll|auto)$/.test(style.overflowX || style.overflow)) {
                    left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
                }
                if (/^(hidden|clip|scroll|auto)$/.test(style.overflowY || style.overflow)) {
                    top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
                }
            }
            return { left, right, top, bottom, width: right - left, height: bottom - top };
        }
        const textNodes = element => {
            if (typeof document.createTreeWalker === 'function') {
                const walker = document.createTreeWalker(element, 4);
                const nodes = [];
                while (walker.nextNode()) nodes.push(walker.currentNode);
                return nodes;
            }
            const nodes = [];
            const visit = node => {
                for (const child of node.childNodes || []) {
                    if (child.nodeType === 3) nodes.push(child);
                    else visit(child);
                }
            };
            visit(element);
            return nodes;
        };
        function textRects(element) {
            const rects = [];
            for (const node of textNodes(element)) {
                if (!node.textContent?.trim() || !visible(node.parentElement || element)) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                rects.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 1 && rect.height > 1));
            }
            return rects;
        }
        function describe(element) {
            let kind = 'card', interest = 1;
            if (matches(element, 'h1,h2,h3,h4,[role="heading"]')) { kind = 'heading'; interest = 1.35; }
            else if (matches(element, '.tech-cloud > span')) { kind = 'technology'; interest = 1.4; }
            else if (matches(element, '.portfolio-terminal,.terminal-topbar,.terminal-sidecar-panel,.terminal-command-row')) { kind = 'terminal'; interest = 1.25; }
            else if (matches(element, '.game-menu-bar,.game-frame-shell,.emblem-stage,.server-room-stage,iframe')) { kind = 'media'; interest = 1.2; }
            else if (matches(element, 'form,.redline-contact-panel')) { kind = 'form'; interest = 1.1; }
            else if (matches(element, 'footer,.footer')) { kind = 'footer'; interest = .8; }
            else if (matches(element, 'a,button,input,textarea,select,[role="button"]')) { kind = 'control'; interest = 1.5; }
            const rawName = element.dataset?.petPlatform || element.getAttribute?.('aria-label')
                || element.getAttribute?.('placeholder') || element.getAttribute?.('title') || element.textContent || kind;
            return { element, kind, interest, name: String(rawName).replace(/\s+/g, ' ').trim().slice(0, 64) || kind };
        }
        function measure(descriptor) {
            const { element } = descriptor;
            if (!visible(element)) return null;
            let rect = element.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return null;
            if (descriptor.kind === 'heading') {
                const glyphs = textRects(element);
                if (glyphs.length) {
                    const top = Math.min(...glyphs.map(glyph => glyph.top));
                    const line = glyphs.filter(glyph => glyph.top < top + 4);
                    rect = { left: Math.min(...line.map(glyph => glyph.left)), right: Math.max(...line.map(glyph => glyph.right)),
                        top, bottom: Math.max(...line.map(glyph => glyph.bottom)), height: rect.height };
                }
            }
            return { ...descriptor, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        }
        function readSurface(surfaceOrElement) {
            const element = surfaceOrElement?.element || surfaceOrElement;
            // Support follows its element even while that element leaves the viewport.
            visibility = new WeakMap();
            return element ? measure(descriptors.get(element) || describe(element)) : null;
        }
        function discover() {
            const found = new Set([...document.querySelectorAll('[data-pet-platform]'), ...document.querySelectorAll(SEMANTIC)]);
            candidates = Array.from(found, element => {
                const descriptor = describe(element);
                descriptors.set(element, descriptor);
                if (observer && !observed.has(element)) { observer.observe(element); observed.add(element); }
                return descriptor;
            });
        }
        function protect() {
            zones = [];
            const whole = [];
            for (const element of document.querySelectorAll(PROTECTED)) {
                if (!visible(element)) continue;
                const rect = element.getBoundingClientRect();
                if (!onScreen(rect) || !matches(element, SOLID_CONTENT)) continue;
                // The scene canvas is background scenery, not a form or picture
                // whose entire rectangle must remain unobstructed.
                if (matches(element, 'canvas') && element.closest?.('.canvas-container')) continue;
                if (whole.some(parent => parent.contains?.(element))) continue;
                whole.push(element);
                const clipped = clippedRect(rect, element);
                if (onScreen(clipped)) zones.push({ left: clipped.left, right: clipped.right, top: clipped.top, bottom: clipped.bottom, element });
            }
            const nodes = typeof document.createTreeWalker === 'function' ? textNodes(document.body)
                : Array.from(new Set(Array.from(document.querySelectorAll(PROTECTED)).flatMap(textNodes)));
            for (const node of nodes) {
                const element = node.parentElement;
                if (!node.textContent?.trim() || !visible(element) || whole.some(parent => parent.contains?.(element))) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                for (const rect of Array.from(range.getClientRects()).filter(onScreen)) {
                    const clipped = clippedRect(rect, element);
                    if (onScreen(clipped)) zones.push({ left: clipped.left, right: clipped.right, top: clipped.top, bottom: clipped.bottom, element });
                }
            }
        }
        function scan(now, force = false) {
            visibility = new WeakMap();
            if (force || dirty || now - lastScan >= 300) {
                dirty = false; lastScan = now;
                discover(); protect();
            }
            // Rectangles refresh every frame: hover transforms and animated layouts
            // must not leave yesterday's collision surface beneath the pet's feet.
            interests = candidates.map(measure).filter(target => target && target.right > 0 && target.left < innerWidth
                && target.bottom > 0 && target.top < innerHeight);
            surfaces = interests.filter(target => target.right - target.left >= 32 && target.top >= 8 && target.top <= innerHeight - 8)
                .filter((target, index, all) => !all.slice(0, index).some(other => Math.abs(other.top - target.top) < 1
                    && Math.abs(other.left - target.left) < 1 && Math.abs(other.right - target.right) < 1));
            return { surfaces, zones, interests };
        }
        return { scan, invalidate, readSurface, refresh: readSurface };
    }
    window.HunterstarPetWorld = { create, safeIntervals, closestSpot, jumpPlan, overlap };
})();
