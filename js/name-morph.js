/**
 * HUNTERSTAR // CINEMATIC NAME-MORPHING ENGINE (ULTRA-SMOOTH & HIGH-PERFORMANCE)
 * -------------------------------------------------------------------------------
 * Transforms "HUNTERSTAR" (Alias) into "KHURSHID" (Real Name)
 * with a deliberate, cinematic pace matching "name changing animatino.mp4".
 *
 * Sequence:
 * 1. HUNTERSTAR is displayed.
 * 2. Non-matching letters (N, T, E, T, A, R) dissolve away.
 * 3. H U R S remain isolated on screen in their original positions for a clear beat.
 * 4. H U R S smoothly and slowly glide inward to merge into a contiguous block.
 * 5. K slides in from the left and H, I, D slide in from the right.
 * 6. Laser flare sweeps along the baseline, locking in KHURSHID.
 * 7. Particle shockwave fires and reverses back to HUNTERSTAR with equal grace.
 *
 * Zero-lag 120 FPS hardware acceleration with zero layout reflow.
 */
(function() {
    'use strict';

    // Configuration
    const NAME_A = 'HUNTERSTAR';
    const NAME_B = 'KHURSHID';
    const HOLD_TIME_A = 5500; // ms to display HUNTERSTAR before initiating morph
    const HOLD_TIME_B = 5000; // ms to display KHURSHID before initiating morph
    const TOTAL_MORPH_B_DURATION = 4600; // ms for the entire A -> B cinematic sequence
    const TOTAL_MORPH_A_DURATION = 3900; // ms for the entire B -> A cinematic sequence

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

    // Audio context (instantiated only on user interaction)
    let audioCtx = null;

    // Particle system (optimized without CPU shadowBlur)
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
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(120, now);
                osc.frequency.exponentialRampToValueAtTime(65, now + 0.5);

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(700, now);
                filter.frequency.exponentialRampToValueAtTime(200, now + 0.5);

                gain.gain.setValueAtTime(0.06, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

                osc.start(now);
                osc.stop(now + 0.6);
            } else {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.exponentialRampToValueAtTime(420, now + 0.2);
                osc.frequency.exponentialRampToValueAtTime(160, now + 0.45);

                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1100, now);
                filter.Q.setValueAtTime(2.5, now);

                gain.gain.setValueAtTime(0.07, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

                osc.start(now);
                osc.stop(now + 0.5);
            }
        } catch (e) {
            // Audio policy fallback
        }
    }

    // High-performance canvas initialization
    function initCanvas() {
        if (!canvas || !container) return;
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(320, rect.width * 1.5) * dpr;
        canvas.height = Math.max(120, rect.height * 2.5) * dpr;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    function emitShockwave(xCenter, yCenter, count, colors) {
        if (!ctx) return;

        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
            const speed = 1.4 + Math.random() * 4.2;
            const size = 1.2 + Math.random() * 2.4;
            const color = colors[Math.floor(Math.random() * colors.length)];

            particles.push({
                x: xCenter,
                y: yCenter,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed * 0.6 - 0.5,
                size: size,
                alpha: 1,
                decay: 0.012 + Math.random() * 0.018,
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
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
            const speed = 0.8 + Math.random() * 2.4;
            particles.push({
                x: x + (Math.random() - 0.5) * (rect.width * 0.7),
                y: y + (Math.random() - 0.5) * (rect.height * 0.4),
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.0 + Math.random() * 1.8,
                alpha: 1,
                decay: 0.015 + Math.random() * 0.022,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }

        if (!animFrameId) {
            animFrameId = requestAnimationFrame(renderParticles);
        }
    }

    // Zero-lag 120fps particle rendering loop without shadowBlur
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
            p.vx *= 0.97;
            p.vy *= 0.97;
            p.alpha -= p.decay;

            if (p.alpha <= 0) {
                particles.splice(i, 1);
                continue;
            }

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.fillStyle = p.color;
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

    // Measure exact letter slot coordinates
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

        // Set stable stage width without animating layout reflow
        stage.style.minWidth = Math.max(widthA, widthB) + 'px';
        if (flare) {
            flare.style.left = '0px';
            flare.style.width = (currentState === 'B' ? widthB : widthA) + 'px';
        }

        initCanvas();
        applyStateImmediate(currentState);
    }

    function applyStateImmediate(state) {
        if (!stage || positionsA.length === 0 || positionsB.length === 0) return;

        const isA = state === 'A';

        // Shared letters
        SHARED_LETTERS.forEach((item) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            const pos = isA ? positionsA[item.aIndex] : positionsB[item.bIndex];
            el.style.transform = `translate3d(${pos.left}px, 0, 0)`;
            el.style.opacity = '1';
        });

        // Exclusive A
        EXCLUSIVE_A.forEach((item) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            const pos = positionsA[item.index];
            el.style.transform = `translate3d(${pos.left}px, 0, 0)`;
            el.style.opacity = isA ? '1' : '0';
            el.style.pointerEvents = isA ? 'auto' : 'none';
        });

        // Exclusive B
        EXCLUSIVE_B.forEach((item) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            const pos = positionsB[item.index];
            el.style.transform = `translate3d(${pos.left}px, 0, 0)`;
            el.style.opacity = isA ? '0' : '1';
            el.style.pointerEvents = isA ? 'none' : 'auto';
        });
    }

    function triggerLaserFlare(targetState) {
        if (!flare) return;
        const targetWidth = targetState === 'B' ? widthB : widthA;
        flare.style.left = '0px';
        flare.style.width = (targetWidth || 100) + 'px';
        flare.classList.remove('is-active');
        void flare.offsetWidth;
        flare.classList.add('is-active');
    }

    /**
     * CINEMATIC TRANSITION: HUNTERSTAR -> KHURSHID
     * ------------------------------------------------------------
     * 0ms:      Dissolve non-matching letters (N, T, E, T, A, R) with gentle embers.
     * 800ms:    H U R S remain clearly isolated on screen in their original positions.
     *           Visitor has 1200ms to appreciate the shared H-U-R-S connection!
     * 2000ms:   H U R S smoothly and slowly glide inward into the contiguous KHURSHID positions (1200ms glide).
     * 3200ms:   H U R S are now joined together in the center.
     * 3700ms:   Laser flare sweeps baseline; K glides in on left, H, I, D glide in on right.
     * 4600ms:   Fully settled into KHURSHID!
     */
    function morphToB() {
        if (isAnimating || currentState === 'B') return;
        isAnimating = true;
        currentState = 'B';
        container.setAttribute('aria-label', 'Khurshid Khursandov');

        // Step 1: Dissolve exclusive letters of HUNTERSTAR over 800ms
        EXCLUSIVE_A.forEach((item, idx) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            setTimeout(() => {
                emitLetterEmbers(el, 5);
                const pos = positionsA[item.index];
                el.style.transform = `translate3d(${pos.left}px, -12px, 0)`;
                el.classList.add('char-dissolve');
            }, idx * 45);
        });

        // Step 2: Spotlight H U R S in their original positions!
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) el.classList.add('char-moving');
            });
        }, 800);

        // Step 3: Smooth, slow glide of H U R S into KHURSHID positions (over 1250ms!)
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posB = positionsB[item.bIndex];
                el.style.transform = `translate3d(${posB.left}px, 0, 0)`;
            });
        }, 2000);

        // Step 4: Incoming letters (K on left, H, I, D on right) & laser flare
        setTimeout(() => {
            triggerLaserFlare('B');

            EXCLUSIVE_B.forEach((item, idx) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posB = positionsB[item.index];
                const startOffset = item.index === 0 ? -16 : 16;
                el.style.transform = `translate3d(${posB.left + startOffset}px, 0, 0)`;

                setTimeout(() => {
                    el.style.transform = `translate3d(${posB.left}px, 0, 0)`;
                    el.classList.add('char-appear');
                }, 80 + idx * 60);
            });
        }, 3600);

        // Step 5: Settle completely
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) el.classList.remove('char-moving');
            });
            EXCLUSIVE_A.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '0';
                    el.classList.remove('char-dissolve');
                }
            });
            EXCLUSIVE_B.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '1';
                    el.classList.remove('char-appear');
                }
            });
            isAnimating = false;
        }, TOTAL_MORPH_B_DURATION);
    }

    /**
     * CINEMATIC TRANSITION: KHURSHID -> HUNTERSTAR
     * ------------------------------------------------------------
     * 0ms:      Particle shockwave & dissolve K, H, I, D outward.
     * 750ms:    H U R S remain in the center.
     * 1500ms:   H U R S smoothly expand back to original Hunterstar spacing (1250ms glide).
     * 2750ms:   Laser flare sweeps baseline; N, T, E and T, A, R materialize into place.
     * 3900ms:   Fully settled into HUNTERSTAR!
     */
    function morphToA() {
        if (isAnimating || currentState === 'A') return;
        isAnimating = true;
        currentState = 'A';
        container.setAttribute('aria-label', 'Hunterstar');

        // Step 1: Smooth shockwave & dissolve exclusive B
        const stageRect = stage.getBoundingClientRect();
        const contRect = canvas.getBoundingClientRect();
        const centerX = stageRect.left - contRect.left + stageRect.width / 2;
        const centerY = stageRect.top - contRect.top + stageRect.height / 2;

        emitShockwave(centerX, centerY, 45, ['#ff1f1f', '#ff5a36', '#ffffff']);

        EXCLUSIVE_B.forEach((item, idx) => {
            const el = stage.querySelector('#char_' + item.id);
            if (!el) return;
            setTimeout(() => {
                const posB = positionsB[item.index];
                el.style.transform = `translate3d(${posB.left}px, -12px, 0)`;
                el.classList.add('char-dissolve');
            }, idx * 35);
        });

        // Step 2: Spotlight H U R S
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) el.classList.add('char-moving');
            });
        }, 750);

        // Step 3: Smooth, slow expansion back to HUNTERSTAR positions (over 1250ms!)
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posA = positionsA[item.aIndex];
                el.style.transform = `translate3d(${posA.left}px, 0, 0)`;
            });
        }, 1500);

        // Step 4: Materialize Hunterstar letters (N, T, E, T, A, R) & laser flare
        setTimeout(() => {
            triggerLaserFlare('A');

            EXCLUSIVE_A.forEach((item, idx) => {
                const el = stage.querySelector('#char_' + item.id);
                if (!el) return;
                const posA = positionsA[item.index];
                el.style.transform = `translate3d(${posA.left}px, 14px, 0)`;

                setTimeout(() => {
                    el.style.transform = `translate3d(${posA.left}px, 0, 0)`;
                    el.classList.add('char-appear');
                }, 70 + idx * 50);
            });
        }, 2750);

        // Step 5: Settle
        setTimeout(() => {
            SHARED_LETTERS.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) el.classList.remove('char-moving');
            });
            EXCLUSIVE_B.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '0';
                    el.classList.remove('char-dissolve');
                }
            });
            EXCLUSIVE_A.forEach((item) => {
                const el = stage.querySelector('#char_' + item.id);
                if (el) {
                    el.style.opacity = '1';
                    el.classList.remove('char-appear');
                }
            });
            isAnimating = false;
        }, TOTAL_MORPH_A_DURATION);
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

    // Build DOM structure inside container
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

        // Reduced motion check
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            container.classList.add('reduced-motion-mode');
            container.innerHTML = '<span class="reduced-name">' + NAME_A + '</span>';
            const handleReducedToggle = () => {
                currentState = currentState === 'A' ? 'B' : 'A';
                container.innerHTML = '<span class="reduced-name">' + (currentState === 'A' ? NAME_A : NAME_B) + '</span>';
            };
            container.addEventListener('click', handleReducedToggle);
            return;
        }

        constructDOM();

        // Wait for fonts to be loaded for pixel-perfect slot measurement
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
