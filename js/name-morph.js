/**
 * HUNTERSTAR // CINEMATIC NAME-MORPHING ENGINE
 * ------------------------------------------------------------
 * Transforms "HUNTERSTAR" (Alias) into "KHURSHID" (Real Name)
 * by preserving and dynamically translating shared letters (H, U, R, S),
 * dissolving non-matching letters with glowing embers, sweeping a baseline
 * laser flare, and triggering a particle shockwave.
 *
 * Inspired by:
 * - "name changing animatino.mp4" (Shared H-U-R-S transition, flare sweep, particle explosion)
 * - "zimi.uz" (Dual-identity narrative, real name vs. moniker storytelling)
 */
(function() {
    'use strict';

    // Configuration
    const NAME_A = 'HUNTERSTAR';
    const NAME_B = 'KHURSHID';
    const HOLD_TIME_A = 4600; // ms to display HUNTERSTAR
    const HOLD_TIME_B = 3800; // ms to display KHURSHID
    const TRANSITION_DURATION = 1100; // ms for the morph

    // Shared sequence mapping
    // HUNTERSTAR: [0:H] [1:U]  2:N  3:T  4:E [5:R] [6:S]  7:T  8:A  9:R
    // KHURSHID:    0:K  [1:H] [2:U] [3:R] [4:S]  5:H  6:I  7:D
    const SHARED_LETTERS = [
        { char: 'H', aIndex: 0, bIndex: 1, id: 'h' },
        { char: 'U', aIndex: 1, bIndex: 2, id: 'u' },
        { char: 'R', aIndex: 5, bIndex: 3, id: 'r' },
        { char: 'S', aIndex: 6, bIndex: 4, id: 's' }
    ];

    const EXCLUSIVE_A = [
        { char: 'N', index: 2, id: 'a_n' },
        { char: 'T', index: 3, id: 'a_t1' },
        { char: 'E', index: 4, id: 'a_e' },
        { char: 'T', index: 7, id: 'a_t2' },
        { char: 'A', index: 8, id: 'a_a' },
        { char: 'R', index: 9, id: 'a_r2' }
    ];

    const EXCLUSIVE_B = [
        { char: 'K', index: 0, id: 'b_k' },
        { char: 'H', index: 5, id: 'b_h' },
        { char: 'I', index: 6, id: 'b_i' },
        { char: 'D', index: 7, id: 'b_d' }
    ];

    // State
    let currentState = 'A'; // 'A' = HUNTERSTAR, 'B' = KHURSHID
    let isAnimating = false;
    let autoTimer = null;
    let isPaused = false;
    let positionsA = [];
    let positionsB = [];
    let widthA = 0;
    let widthB = 0;

    // Elements
    let container = null;
    let stage = null;
    let track = null;
    let flare = null;
    let canvas = null;
    let ctx = null;
    let identityChip = null;
    let identityRole = null;
    let identityName = null;

    // Audio context (instantiated on first user interaction)
    let audioCtx = null;

    // Particle system
    let particles = [];
    let animFrameId = null;

    function playCyberSound(type) {
        try {
            if (!audioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                audioCtx = new AudioContext();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const filter = audioCtx.createBiquadFilter();

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(audioCtx.destination);

            if (type === 'to_b') {
                // Futuristic deep bass sweep with shimmer
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(140, now);
                osc.frequency.exponentialRampToValueAtTime(70, now + 0.35);

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(800, now);
                filter.frequency.exponentialRampToValueAtTime(250, now + 0.35);

                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

                osc.start(now);
                osc.stop(now + 0.4);
            } else {
                // High-energy particle snap
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
                osc.frequency.exponentialRampToValueAtTime(180, now + 0.3);

                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1200, now);
                filter.Q.setValueAtTime(3, now);

                gain.gain.setValueAtTime(0.09, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

                osc.start(now);
                osc.stop(now + 0.35);
            }
        } catch (e) {
            // Silently ignore audio playback restrictions
        }
    }

    // Initialize Canvas Particles
    function initCanvas() {
        if (!canvas || !container) return;
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(300, rect.width * 1.5) * dpr;
        canvas.height = Math.max(100, rect.height * 2.5) * dpr;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    function emitShockwave(xCenter, yCenter, count, colors) {
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = canvas.width / dpr;
        const ch = canvas.height / dpr;

        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
            const speed = 1.8 + Math.random() * 5.2;
            const size = 1.5 + Math.random() * 2.8;
            const color = colors[Math.floor(Math.random() * colors.length)];

            particles.push({
                x: xCenter,
                y: yCenter,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed * 0.65 - 0.8, // slight upward float
                size: size,
                alpha: 1,
                decay: 0.015 + Math.random() * 0.025,
                color: color
            });
        }

        if (!animFrameId) {
            animFrameId = requestAnimationFrame(renderParticles);
        }
    }

    function emitLetterEmbers(letterEl, count) {
        if (!ctx || !letterEl || !canvas) return;
        const rect = letterEl.getBoundingClientRect();
        const contRect = canvas.getBoundingClientRect();
        const x = rect.left - contRect.left + rect.width / 2;
        const y = rect.top - contRect.top + rect.height / 2;

        const colors = ['#ff1f1f', '#ff5a36', '#ffffff', '#ff9999'];
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4; // upward spray
            const speed = 1.0 + Math.random() * 3.5;
            particles.push({
                x: x + (Math.random() - 0.5) * rect.width,
                y: y + (Math.random() - 0.5) * (rect.height * 0.4),
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.2 + Math.random() * 2.2,
                alpha: 1,
                decay: 0.02 + Math.random() * 0.03,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }

        if (!animFrameId) {
            animFrameId = requestAnimationFrame(renderParticles);
        }
    }

    function renderParticles() {
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = canvas.width / dpr;
        const ch = canvas.height / dpr;

        ctx.clearRect(0, 0, cw, ch);

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.alpha -= p.decay;

            if (p.alpha <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        if (particles.length > 0) {
            animFrameId = requestAnimationFrame(renderParticles);
        } else {
            animFrameId = null;
        }
    }

    // Layout measurement using hidden templates
    function measureLayout() {
        if (!stage) return;

        const measureA = stage.querySelector('.morph-measure-a');
        const measureB = stage.querySelector('.morph-measure-b');
        if (!measureA || !measureB) return;

        const stageRect = stage.getBoundingClientRect();

        const spansA = Array.from(measureA.querySelectorAll('span'));
        positionsA = spansA.map((s) => {
            const r = s.getBoundingClientRect();
            return {
                left: r.left - stageRect.left,
                width: r.width
            };
        });
        widthA = measureA.offsetWidth;

        const spansB = Array.from(measureB.querySelectorAll('span'));
        positionsB = spansB.map((s) => {
            const r = s.getBoundingClientRect();
            return {
                left: r.left - stageRect.left,
                width: r.width
            };
        });
        widthB = measureB.offsetWidth;

        initCanvas();

        // Update current layout to prevent distortion on resize
        applyStateImmediate(currentState);
    }

    function applyStateImmediate(state) {
        if (!stage || positionsA.length === 0 || positionsB.length === 0) return;

        const isA = state === 'A';
        stage.style.width = (isA ? widthA : widthB) + 'px';

        // Shared letters
        SHARED_LETTERS.forEach((item) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            const pos = isA ? positionsA[item.aIndex] : positionsB[item.bIndex];
            el.style.transform = `translate3d(${pos.left}px, 0, 0)`;
            el.style.opacity = '1';
            el.style.filter = 'none';
        });

        // Exclusive A
        EXCLUSIVE_A.forEach((item) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            const pos = positionsA[item.index];
            el.style.transform = `translate3d(${pos.left}px, 0, 0)`;
            el.style.opacity = isA ? '1' : '0';
            el.style.filter = isA ? 'none' : 'blur(5px)';
            el.style.pointerEvents = isA ? 'auto' : 'none';
        });

        // Exclusive B
        EXCLUSIVE_B.forEach((item) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            const pos = positionsB[item.index];
            el.style.transform = `translate3d(${pos.left}px, 0, 0)`;
            el.style.opacity = isA ? '0' : '1';
            el.style.filter = isA ? 'blur(5px)' : 'none';
            el.style.pointerEvents = isA ? 'none' : 'auto';
        });
    }

    // Trigger Laser Flare Baseline Sweep
    function triggerLaserFlare() {
        if (!flare) return;
        flare.classList.remove('is-active');
        void flare.offsetWidth; // force reflow
        flare.classList.add('is-active');
    }

    // Perform Morph from A (HUNTERSTAR) to B (KHURSHID)
    function morphToB() {
        if (isAnimating || currentState === 'B') return;
        isAnimating = true;
        currentState = 'B';
        container.setAttribute('aria-label', 'Khurshid Khursandov');

        // Update identity chip text
        if (identityRole) identityRole.textContent = 'REAL NAME';
        if (identityName) identityName.textContent = 'KHURSHID KHURSANDOV';
        if (identityChip) identityChip.classList.add('is-realname');

        // Phase 1: Dissolve non-matching letters of HUNTERSTAR
        EXCLUSIVE_A.forEach((item, idx) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            setTimeout(() => {
                emitLetterEmbers(el, 7);
                el.classList.add('char-dissolve');
            }, idx * 40);
        });

        // Phase 2: Slide shared letters (H, U, R, S) into KHURSHID positions & morph width
        setTimeout(() => {
            stage.style.width = widthB + 'px';

            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posB = positionsB[item.bIndex];
                el.style.transform = `translate3d(${posB.left}px, 0, 0)`;
                el.classList.add('char-moving');
            });
        }, 320);

        // Phase 3: Laser flare baseline sweep & incoming letters (K, H, I, D)
        setTimeout(() => {
            triggerLaserFlare();

            EXCLUSIVE_B.forEach((item, idx) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posB = positionsB[item.index];
                el.style.transform = `translate3d(${posB.left}px, 0, 0)`;
                setTimeout(() => {
                    el.classList.add('char-appear');
                }, idx * 50);
            });
        }, 580);

        // Phase 4: Settle and clean up transition classes
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) el.classList.remove('char-moving');
            });
            EXCLUSIVE_A.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '0';
                    el.style.filter = 'blur(6px)';
                    el.classList.remove('char-dissolve');
                }
            });
            EXCLUSIVE_B.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '1';
                    el.style.filter = 'none';
                    el.classList.remove('char-appear');
                }
            });
            isAnimating = false;
        }, TRANSITION_DURATION);
    }

    // Perform Morph from B (KHURSHID) back to A (HUNTERSTAR)
    function morphToA() {
        if (isAnimating || currentState === 'A') return;
        isAnimating = true;
        currentState = 'A';
        container.setAttribute('aria-label', 'Hunterstar');

        // Update identity chip text
        if (identityRole) identityRole.textContent = 'ALIAS';
        if (identityName) identityName.textContent = 'HUNTERSTAR';
        if (identityChip) identityChip.classList.remove('is-realname');

        // Phase 1: Cosmic Particle Shockwave & Dissolve Exclusive B
        const stageRect = stage.getBoundingClientRect();
        const contRect = canvas.getBoundingClientRect();
        const centerX = stageRect.left - contRect.left + stageRect.width / 2;
        const centerY = stageRect.top - contRect.top + stageRect.height / 2;

        emitShockwave(centerX, centerY, 55, ['#ff1f1f', '#ff5a36', '#ffffff', '#ff9999']);
        triggerLaserFlare();

        EXCLUSIVE_B.forEach((item, idx) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            setTimeout(() => {
                el.classList.add('char-dissolve');
            }, idx * 30);
        });

        // Phase 2: Slide shared letters back and expand width
        setTimeout(() => {
            stage.style.width = widthA + 'px';

            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posA = positionsA[item.aIndex];
                el.style.transform = `translate3d(${posA.left}px, 0, 0)`;
                el.classList.add('char-moving');
            });
        }, 260);

        // Phase 3: Materialize HUNTERSTAR letters (N, T, E, T, A, R)
        setTimeout(() => {
            EXCLUSIVE_A.forEach((item, idx) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posA = positionsA[item.index];
                el.style.transform = `translate3d(${posA.left}px, 0, 0)`;
                setTimeout(() => {
                    el.classList.add('char-appear');
                }, idx * 45);
            });
        }, 480);

        // Phase 4: Settle
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) el.classList.remove('char-moving');
            });
            EXCLUSIVE_B.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '0';
                    el.style.filter = 'blur(6px)';
                    el.classList.remove('char-dissolve');
                }
            });
            EXCLUSIVE_A.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '1';
                    el.style.filter = 'none';
                    el.classList.remove('char-appear');
                }
            });
            isAnimating = false;
        }, TRANSITION_DURATION);
    }

    // Toggle between states
    function toggleIdentity(byUser = false) {
        if (isAnimating) return;
        if (byUser) {
            playCyberSound(currentState === 'A' ? 'to_b' : 'to_a');
            restartAutoTimer();
        }

        if (currentState === 'A') {
            morphToB();
        } else {
            morphToA();
        }
    }

    // Timer Loop
    function scheduleNext() {
        if (autoTimer) clearTimeout(autoTimer);
        const delay = currentState === 'A' ? HOLD_TIME_A : HOLD_TIME_B;
        autoTimer = setTimeout(() => {
            if (!isPaused && !isAnimating) {
                toggleIdentity(false);
            }
            scheduleNext();
        }, delay);
    }

    function restartAutoTimer() {
        if (autoTimer) clearTimeout(autoTimer);
        scheduleNext();
    }

    // Build DOM inside container
    function constructDOM() {
        container.innerHTML = '';
        container.classList.add('name-morph-active');

        // Measurement Template A (HUNTERSTAR)
        const measureA = document.createElement('span');
        measureA.className = 'morph-measure morph-measure-a';
        measureA.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < NAME_A.length; i++) {
            const span = document.createElement('span');
            span.textContent = NAME_A[i];
            measureA.appendChild(span);
        }

        // Measurement Template B (KHURSHID)
        const measureB = document.createElement('span');
        measureB.className = 'morph-measure morph-measure-b';
        measureB.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < NAME_B.length; i++) {
            const span = document.createElement('span');
            span.textContent = NAME_B[i];
            measureB.appendChild(span);
        }

        // Stage
        stage = document.createElement('span');
        stage.className = 'morph-stage';
        stage.id = 'morphStage';

        // Active Track
        track = document.createElement('span');
        track.className = 'morph-track';

        // Shared letter elements
        SHARED_LETTERS.forEach((item) => {
            const el = document.createElement('span');
            el.className = 'morph-char char-shared';
            el.id = 'char_' + item.id;
            el.textContent = item.char;
            el.setAttribute('data-char', item.char);
            track.appendChild(el);
        });

        // Exclusive A letter elements
        EXCLUSIVE_A.forEach((item) => {
            const el = document.createElement('span');
            el.className = 'morph-char char-exclusive-a';
            el.id = 'char_' + item.id;
            el.textContent = item.char;
            el.setAttribute('data-char', item.char);
            track.appendChild(el);
        });

        // Exclusive B letter elements
        EXCLUSIVE_B.forEach((item) => {
            const el = document.createElement('span');
            el.className = 'morph-char char-exclusive-b';
            el.id = 'char_' + item.id;
            el.textContent = item.char;
            el.setAttribute('data-char', item.char);
            track.appendChild(el);
        });

        // Laser Flare
        flare = document.createElement('span');
        flare.className = 'morph-flare';
        flare.setAttribute('aria-hidden', 'true');

        // Particle Canvas
        canvas = document.createElement('canvas');
        canvas.className = 'morph-canvas';
        canvas.setAttribute('aria-hidden', 'true');

        // Assemble stage
        stage.appendChild(measureA);
        stage.appendChild(measureB);
        stage.appendChild(track);
        stage.appendChild(flare);
        stage.appendChild(canvas);

        container.appendChild(stage);
    }

    // Init Engine
    function init() {
        container = document.getElementById('heroNameMorph');
        if (!container) return;

        identityChip = document.getElementById('identityToggle');
        identityRole = document.getElementById('identityRole');
        identityName = document.getElementById('identityName');

        // Reduced motion check
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            container.classList.add('reduced-motion-mode');
            container.innerHTML = '<span class="reduced-name">' + NAME_A + '</span>';
            const handleReducedToggle = () => {
                currentState = currentState === 'A' ? 'B' : 'A';
                container.innerHTML = '<span class="reduced-name">' + (currentState === 'A' ? NAME_A : NAME_B) + '</span>';
                if (identityRole) identityRole.textContent = currentState === 'A' ? 'ALIAS' : 'REAL NAME';
                if (identityName) identityName.textContent = currentState === 'A' ? 'HUNTERSTAR' : 'KHURSHID KHURSANDOV';
                if (identityChip) identityChip.classList.toggle('is-realname', currentState === 'B');
            };
            container.addEventListener('click', handleReducedToggle);
            if (identityChip) identityChip.addEventListener('click', handleReducedToggle);
            return;
        }

        constructDOM();

        // Wait for fonts to be ready for accurate measurement
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                measureLayout();
                scheduleNext();
            });
        } else {
            setTimeout(() => {
                measureLayout();
                scheduleNext();
            }, 100);
        }

        // Event listeners
        window.addEventListener('resize', () => {
            measureLayout();
        }, { passive: true });

        // Click / Key to toggle
        container.addEventListener('click', (e) => {
            e.preventDefault();
            toggleIdentity(true);
        });

        container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleIdentity(true);
            }
        });

        if (identityChip) {
            identityChip.addEventListener('click', (e) => {
                e.preventDefault();
                toggleIdentity(true);
            });
        }

        // Hover pause
        container.addEventListener('mouseenter', () => {
            isPaused = true;
        });

        container.addEventListener('mouseleave', () => {
            isPaused = false;
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
