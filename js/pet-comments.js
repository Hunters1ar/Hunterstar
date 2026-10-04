/* Small, local reactions: no requests, chat history, or movement commands. */
(() => {
    'use strict';
    const ORDINARY_COOLDOWN = 35000;
    const REACTION_COOLDOWN = 10000;
    const SCROLL_QUIET = 1800;
    const SECTIONS = ['hero', 'terminal', 'expertise', 'stats', 'emblem', 'server-room', 'stack', 'game-menu', 'contact'];
    const LINES = {
        "welcome": [
            "Hey, I’m Little Hunterstar. I’ll keep you company while you explore.",
            "Welcome. Have a look around—and try not to drop the welcoming committee.",
            "Take your time. Double-tap me whenever you want to chat.",
            "A visitor. Good. I was running out of things to pretend to supervise."
        ],
        "drag": [
            "Easy. My cloak is not a carry handle.",
            "I can walk. You’ve selected the less dignified option.",
            "This portfolio has drag-and-drop. Apparently, I’m the feature.",
            "I had that spot exactly how I liked it."
        ],
        "hold": [
            "I’m still here. Gravity and I are waiting for your decision.",
            "Are we travelling, or have I become a bookmark?",
            "I’d like to reopen negotiations with the floor.",
            "Take your time. My feet have filed a formal complaint."
        ],
        "throw": [
            "Right. We’re doing airborne deployment.",
            "I requested a change of scenery. The velocity was optional.",
            "Fast travel. Very little travel planning.",
            "Next time, just point. I understand directions."
        ],
        "landing": [
            "Back on solid ground. Give my dignity a second.",
            "That was a firm introduction to the floor.",
            "Landing complete. The pose was improvised.",
            "I meant to look composed. This is close enough."
        ],
        "heading": [
            "Top of the headline. Modest position, excellent view.",
            "I’m the smallest thing here with a title.",
            "The headline does the talking. I’m here for scale.",
            "Found the high ground. It comes with typography."
        ],
        "technology": [
            "The stack holds up. Literally, in my case.",
            "Architecture review: this is a very good place to sit.",
            "I’m testing the stack’s support for small visitors.",
            "All these technologies, and I’ve found somewhere to stand."
        ],
        "control": [
            "I’ll watch the button. You decide what happens next.",
            "On button duty. A position of unreasonable importance.",
            "Click when you’re ready. I’m just enjoying the view.",
            "A tiny lookout post. I take the responsibility moderately seriously."
        ],
        "perch": [
            "This spot will do. Good view, minimal falling.",
            "I’ll settle here while you look around.",
            "Found a quiet corner. I’m making myself comfortable.",
            "A successful move. I’ll take the small victories."
        ],
        "idle": [
            "No rush. I’m very good at waiting in a dramatic pose.",
            "Still here. The silence is part of my charm.",
            "If something caught your eye, take your time with it.",
            "Double-tap me if you feel like talking. I’ll be here."
        ]
    };
    const SECTION_LINES = {
        "hero": [
            "Back at the entrance. I’ll try to make a composed first impression.",
            "Hunterstar’s portfolio starts here. I’m the small welcoming detail.",
            "Good place to begin. The headline is doing most of the work."
        ],
        "terminal": [
            "A terminal. Try “help” for the available commands.",
            "Blinking cursor. Very dramatic for something waiting for instructions.",
            "Your turn at the terminal. I’ll provide quiet moral support."
        ],
        "expertise": [
            "Hunterstar handles the engineering. I contribute balance and commentary.",
            "These are Hunterstar’s skills. My own list is mostly balance.",
            "Skills on display. I’m keeping my claims limited to staying upright."
        ],
        "stats": [
            "Numbers. Useful when confidence needs a little evidence.",
            "The stats can speak for themselves. I’m giving them the floor.",
            "I’d add a landing counter, but it might damage my reputation."
        ],
        "emblem": [
            "The emblem opens more of Hunterstar’s world. Have a look.",
            "There’s more through that emblem. I’ll keep your place here.",
            "A small emblem, a whole other place to explore."
        ],
        "server-room": [
            "The archive is through here. Follow your curiosity.",
            "A server room. Finally, somewhere that appreciates quiet company.",
            "Go explore the archive. I’ll look after this little corner."
        ],
        "stack": [
            "Here’s the stack. A closer look at what Hunterstar builds with.",
            "A lot of technology. I’m resisting the urge to climb all of it.",
            "Pick a technology that interests you. I’ve picked a place to sit."
        ],
        "game-menu": [
            "A game break. Sensible. Even portfolios need breathing room.",
            "You play. I’ll be the unusually small spectator.",
            "Take a break here. I promise no unsolicited coaching."
        ],
        "contact": [
            "Want to talk to Hunterstar? The contact form is right here.",
            "I’ll give you a little quiet while you write.",
            "A good place to turn a curious visit into a conversation."
        ]
    };
    let pet = null, enabled = false, chatting = false, dragging = false, welcomed = false, gestureComment = false;
    let welcomeTimer = 0, holdTimer = 0, sectionTimer = 0, idleTimer = 0;
    let welcomeUntil = 0;
    let lastCommentAt = -Infinity, lastReactionAt = -Infinity;
    let lastScrollAt = -Infinity;
    const previousLines = new Map(), visitedSections = new Set(), visitedPerches = new WeakSet();
    const now = () => performance.now();
    const editing = () => Boolean(document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]'));
    const controlsOpen = () => pet?.querySelector('.pet-panel')?.hidden === false;
    const available = () => Boolean(pet && !pet.hidden && !document.hidden && !chatting && !controlsOpen() && !editing());

    function clearPending() {
        clearTimeout(welcomeTimer); clearTimeout(holdTimer); clearTimeout(sectionTimer); clearTimeout(idleTimer);
        welcomeTimer = holdTimer = sectionTimer = idleTimer = 0;
        dragging = false; gestureComment = false;
    }

    function say(kind, pool, { reaction = false, gesture = false, followup = false, duration = 8000 } = {}) {
        if (!available() || (!gesture && dragging)) return false;
        const at = now();
        if (reaction) {
            if (!followup && at - lastReactionAt < REACTION_COOLDOWN) return false;
        } else if (at - lastCommentAt < ORDINARY_COOLDOWN) return false;
        const choices = pool.filter(line => line !== previousLines.get(kind));
        const candidates = choices.length ? choices : pool;
        const text = candidates[Math.min(candidates.length - 1, Math.floor(Math.random() * candidates.length))];
        if (!text) return false;
        const detail = { pet, text, kind, duration, accepted: false };
        document.dispatchEvent(new CustomEvent('hunterstar:pet-comment', { detail }));
        // The bubble acknowledges synchronously. Suppressed reactions never spend
        // a cooldown, record a visit, or queue themselves for later replay.
        if (!detail.accepted) return false;
        previousLines.set(kind, text);
        lastCommentAt = at;
        if (kind === 'welcome') welcomeUntil = at + duration;
        if (reaction) lastReactionAt = at;
        return true;
    }

    function scheduleIdle() {
        clearTimeout(idleTimer);
        idleTimer = 0;
        if (!pet || pet.hidden || !enabled || document.hidden || chatting || controlsOpen()) return;
        idleTimer = setTimeout(() => {
            idleTimer = 0;
            if (now() - lastScrollAt >= SCROLL_QUIET) say('idle', LINES.idle);
            scheduleIdle();
        }, 60000 + Math.random() * 30000);
    }

    function scheduleWelcome() {
        if (welcomed || welcomeTimer || !available()) return;
        welcomeTimer = setTimeout(() => {
            welcomeTimer = 0;
            if (say('welcome', LINES.welcome, { duration: 10000 })) welcomed = true;
        }, 1000);
    }

    function currentSection() {
        const center = innerHeight / 2;
        let best = null, bestScore = Infinity;
        for (const id of SECTIONS) {
            const element = document.getElementById(id);
            if (!element || element.hidden) continue;
            const rect = element.getBoundingClientRect();
            if (rect.bottom <= 96 || rect.top >= innerHeight || rect.width <= 0 || rect.height <= 0) continue;
            const distance = center < rect.top ? rect.top - center : center > rect.bottom ? center - rect.bottom : 0;
            // A nested game section should win over its larger stack container.
            const score = distance + rect.height * .001;
            if (score < bestScore) { bestScore = score; best = id; }
        }
        return best;
    }

    document.addEventListener('hunterstar:pet-life', event => {
        const detail = event.detail;
        if (!detail?.pet || (pet && detail.pet !== pet)) return;
        pet = detail.pet;
        if (typeof detail.enabled === 'boolean') enabled = detail.enabled;
        if (detail.kind === 'ready' || detail.kind === 'show') {
            scheduleWelcome(); scheduleIdle();
        } else if (detail.kind === 'pause') {
            clearPending();
            if (enabled) scheduleIdle();
        } else if (detail.kind === 'controls-close') {
            scheduleIdle();
        } else if (detail.kind === 'drag-start') {
            if (dragging || !available()) return;
            clearTimeout(welcomeTimer); welcomeTimer = 0;
            clearTimeout(sectionTimer); sectionTimer = 0;
            dragging = true;
            gestureComment = say('drag', LINES.drag, { reaction: true, gesture: true });
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
                holdTimer = 0;
                if (dragging) gestureComment = say('hold', LINES.hold,
                    { reaction: true, gesture: true, followup: gestureComment }) || gestureComment;
            }, 3000);
        } else if (detail.kind === 'drag-end') {
            const wasDragging = dragging;
            dragging = false; clearTimeout(holdTimer); holdTimer = 0;
            if (wasDragging && !detail.cancelled && Number(detail.speed) > 350) {
                say('throw', LINES.throw, { reaction: true, gesture: true, followup: gestureComment });
            }
            gestureComment = false;
        } else if (detail.kind === 'land') {
            // Restoring a scrolled page can launch an immediate placement jump.
            // Let the first greeting have its turn before automatic reactions.
            if (!enabled || welcomeTimer || now() < welcomeUntil) return;
            if (Number(detail.impact) > 700) {
                say('landing', LINES.landing, { reaction: true });
            } else {
                const surface = detail.surface;
                if (!surface || surface.name === 'floor' || !surface.element || visitedPerches.has(surface.element)) return;
                const kind = ['heading', 'technology', 'control'].includes(surface.kind) ? surface.kind : 'perch';
                if (say(kind, LINES[kind])) visitedPerches.add(surface.element);
            }
        }
    });
    document.addEventListener('hunterstar:pet-hidden', clearPending);
    document.addEventListener('hunterstar:pet-controls', clearPending);
    document.addEventListener('hunterstar:chat-state', event => {
        chatting = Boolean(event.detail?.active || event.detail?.thinking);
        if (chatting) clearPending();
        else scheduleIdle();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearPending();
        else scheduleIdle();
    });
    window.addEventListener('scroll', () => {
        lastScrollAt = now();
        clearTimeout(sectionTimer); sectionTimer = 0;
        if (!enabled || !available() || dragging) return;
        sectionTimer = setTimeout(() => {
            sectionTimer = 0;
            if (!enabled || !available() || dragging) return;
            const id = currentSection();
            if (id && !visitedSections.has(id) && say('section', SECTION_LINES[id])) visitedSections.add(id);
        }, SCROLL_QUIET);
    }, { passive: true, capture: true });
})();