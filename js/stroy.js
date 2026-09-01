/* ==============================================
   HUNTERSTAR V2.0 — CINEMATIC STORY ENGINE
   ============================================== */

(function () {
    'use strict';

    /* ──────────────────────────────────────────
       CONFIG
    ────────────────────────────────────────── */
    const BOOT_LINES = [
        { text: '> SYSTEM INIT...', delay: 400 },
        { text: '> LOADING HUNTERSTAR ARCHIVE v2.0', delay: 600 },
        { text: '> ESTABLISHING SECURE CONNECTION...', delay: 500 },
        { text: '> DECRYPTING DATA STREAMS...', delay: 700 },
        { text: '> ACCESS GRANTED', delay: 300, isTitle: false },
    ];

    const GLITCH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&';

    /* ──────────────────────────────────────────
       DOM REFERENCES
    ────────────────────────────────────────── */
    const $cinematicLayer = document.getElementById('cinematic-layer');
    const $bootSequence = document.getElementById('boot-sequence');
    const $bootTextContainer = document.getElementById('boot-text-container');
    const $bootProgressContainer = document.getElementById('boot-progress-container');
    const $bootProgressBar = document.getElementById('boot-progress-bar');
    const $bootProgressText = document.getElementById('boot-progress-text');
    const $archiveSplash = document.getElementById('archive-splash');
    const $enterArchiveBtn = document.getElementById('enter-archive-btn');
    const $storyWrapper = document.getElementById('story-wrapper');
    const $starfieldCanvas = document.getElementById('starfield-canvas');
    const $warpFlash = document.getElementById('warp-flash');

    /* ──────────────────────────────────────────
       STATE
    ────────────────────────────────────────── */
    let starfield = null;
    let warpMode = false;
    let mouseX = 0;
    let mouseY = 0;

    /* ══════════════════════════════════════════
       1. BOOT SEQUENCE
    ══════════════════════════════════════════ */
    function runBootSequence() {
        let lineIndex = 0;

        function showNextLine() {
            if (lineIndex >= BOOT_LINES.length) {
                showProgressBar();
                return;
            }

            const lineData = BOOT_LINES[lineIndex];
            const lineEl = document.createElement('div');
            lineEl.className = 'boot-line';
            lineEl.textContent = lineData.text;
            $bootTextContainer.appendChild(lineEl);

            // Trigger visibility
            requestAnimationFrame(() => {
                lineEl.classList.add('visible');
            });

            lineIndex++;
            setTimeout(showNextLine, lineData.delay);
        }

        showNextLine();
    }

    function showProgressBar() {
        $bootProgressContainer.classList.remove('hidden');
        let progress = 0;

        const interval = setInterval(() => {
            progress += Math.random() * 8 + 2;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                $bootProgressBar.style.width = '100%';
                $bootProgressText.textContent = '100%';
                setTimeout(showArchiveSplash, 400);
                return;
            }
            $bootProgressBar.style.width = progress + '%';
            $bootProgressText.textContent = Math.floor(progress) + '%';
        }, 80);
    }

    function showArchiveSplash() {
        // Fade out boot sequence
        gsap.to($bootSequence, {
            opacity: 0,
            duration: 0.6,
            onComplete: () => {
                $bootSequence.style.display = 'none';
            }
        });

        // Show archive splash
        $archiveSplash.classList.remove('hidden');
        gsap.to($archiveSplash, {
            opacity: 1,
            duration: 1,
            delay: 0.3,
        });

        // Stagger splash elements
        gsap.from('.splash-title', { y: 30, opacity: 0, duration: 0.8, delay: 0.5, ease: 'power3.out' });
        gsap.from('.splash-subtitle', { y: 20, opacity: 0, duration: 0.6, delay: 0.8, ease: 'power3.out' });
        gsap.from('.cyber-btn', { y: 20, opacity: 0, duration: 0.6, delay: 1.1, ease: 'power3.out' });
    }

    /* ══════════════════════════════════════════
       2. ENTER ARCHIVE — Transition to Story
    ══════════════════════════════════════════ */
    function enterArchive() {
        // Fade out cinematic layer
        gsap.to($cinematicLayer, {
            opacity: 0,
            duration: 1,
            ease: 'power2.inOut',
            onComplete: () => {
                $cinematicLayer.style.display = 'none';
                $cinematicLayer.classList.add('hidden');
            }
        });

        // Reveal story wrapper
        $storyWrapper.classList.remove('hidden');
        gsap.from($storyWrapper, {
            opacity: 0,
            duration: 1,
            ease: 'power2.out',
        });

        // Initialize starfield and mission timeline
        initStarfield();
        initMission01();
    }

    /* ══════════════════════════════════════════
       3. STARFIELD (Three.js)
    ══════════════════════════════════════════ */
    function initStarfield() {
        if (typeof THREE === 'undefined') {
            console.warn('Three.js not loaded — starfield disabled');
            return;
        }

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        const renderer = new THREE.WebGLRenderer({
            canvas: $starfieldCanvas,
            alpha: true,
            antialias: false,
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        camera.position.z = 5;

        // Create star texture (glowing dot)
        const starTexture = createStarTexture();

        // Create stars
        const starCount = 2500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        const crimson = new THREE.Color(0xD33A2C);
        const white = new THREE.Color(0xFFFFFF);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 600;
            positions[i3 + 1] = (Math.random() - 0.5) * 600;
            positions[i3 + 2] = (Math.random() - 0.5) * 600;

            // 15% crimson, 85% white
            const color = Math.random() < 0.15 ? crimson : white;
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = Math.random() * 2 + 0.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 1.5,
            map: starTexture,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const stars = new THREE.Points(geometry, material);
        scene.add(stars);

        // Store references for animation
        starfield = { scene, camera, renderer, stars, geometry, positions: positions.slice() };

        // Start render loop
        animateStarfield();

        // Handle resize
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    function createStarTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.15, 'rgba(255,255,255,0.8)');
        gradient.addColorStop(0.4, 'rgba(255,255,255,0.3)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(canvas);
    }

    function animateStarfield() {
        if (!starfield) return;
        requestAnimationFrame(animateStarfield);

        const { stars, camera, renderer, scene, geometry, positions } = starfield;
        const posAttr = geometry.getAttribute('position');

        if (warpMode) {
            // Warp: stars fly toward camera
            for (let i = 0; i < posAttr.count; i++) {
                const i3 = i * 3;
                let z = posAttr.getZ(i);
                z -= 8;
                if (z < -300) {
                    z = 300;
                    posAttr.setX(i, (Math.random() - 0.5) * 600);
                    posAttr.setY(i, (Math.random() - 0.5) * 600);
                }
                posAttr.setZ(i, z);
            }
            posAttr.needsUpdate = true;
        } else {
            // Slow drift + mouse parallax
            stars.rotation.y += 0.00015;
            stars.rotation.x += 0.00008;

            // Subtle mouse parallax
            const targetX = (mouseX / window.innerWidth - 0.5) * 0.3;
            const targetY = (mouseY / window.innerHeight - 0.5) * 0.3;
            camera.position.x += (targetX - camera.position.x) * 0.02;
            camera.position.y += (-targetY - camera.position.y) * 0.02;
            camera.lookAt(0, 0, 0);
        }

        renderer.render(scene, camera);
    }

    // Mouse tracking for parallax
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    /* ══════════════════════════════════════════
       4. MISSION 01 — TIMELINE
    ══════════════════════════════════════════ */
    function initMission01() {
        gsap.registerPlugin(ScrollTrigger);

        // Prepare typewriter text
        prepareTypewriter('text-bought');

        // Prepare glitch text
        prepareGlitchText('lesson-01-text');

        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: '#mission-01',
                start: 'top top',
                end: '+=5000',
                pin: true,
                scrub: 1,
                anticipatePin: 1,
            }
        });

        // ── Beat A: HUD fades in ──
        tl.to('.mission-hud', { opacity: 1, duration: 0.5 })

        // ── Beat B: Laptop appears ──
        .to('#laptop-scene', {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 1,
            ease: 'power3.out',
        })

        // ── Beat C: Typewriter text ──
        .to('#text-bought', {
            opacity: 1,
            y: 0,
            duration: 0.3,
        })
        .to('#text-bought .char', {
            opacity: 1,
            stagger: 0.015,
            duration: 0.01,
        })

        // ── Beat D: Game covers float in ──
        .to('#game-covers', {
            opacity: 1,
            duration: 0.2,
        })
        .to('.game-cover', {
            opacity: 1,
            y: 0,
            rotation: 0,
            stagger: 0.12,
            duration: 0.4,
            ease: 'back.out(1.2)',
        })

        // ── Pause: hold game covers ──
        .to({}, { duration: 0.5 })

        // ── Beat E: Wonder text ──
        .to('#text-wonder', {
            opacity: 1,
            y: 0,
            duration: 0.5,
        })

        // ── Beat E→F: Fade out game covers + text ──
        .to('#game-covers', {
            opacity: 0,
            y: -30,
            duration: 0.4,
        })
        .to('#text-bought', {
            opacity: 0,
            y: -20,
            duration: 0.3,
        }, '<')
        .to('#text-wonder', {
            opacity: 0,
            y: -20,
            duration: 0.3,
        }, '<')

        // ── Beat F: Morph — game screen → VS Code ──
        .to('#screen-game', {
            opacity: 0,
            duration: 0.8,
            ease: 'power2.inOut',
        })
        .to('#screen-vscode', {
            opacity: 1,
            duration: 0.8,
            ease: 'power2.inOut',
        }, '<0.2')

        // ── Glow intensifies ──
        .to('.laptop-glow', {
            opacity: 1,
            duration: 0.5,
        })

        // ── Pause: hold morph ──
        .to({}, { duration: 0.5 })

        // ── Beat F→G: Fade out laptop ──
        .to('#laptop-scene', {
            opacity: 0,
            scale: 0.9,
            y: -40,
            duration: 0.6,
        })

        // ── Beat G: Lesson text (glitch reveal) ──
        .to('#lesson-01', {
            opacity: 1,
            scale: 1,
            duration: 0.4,
        })
        .add(() => triggerGlitchReveal('lesson-01-text'))

        // ── Hold lesson ──
        .to({}, { duration: 0.8 })

        // ── Beat H: Warp transition ──
        .add(() => { warpMode = true; })
        .to('#lesson-01', {
            opacity: 0,
            duration: 0.3,
        })
        .to($warpFlash, {
            opacity: 0.9,
            duration: 0.6,
            ease: 'power2.in',
        })
        .add(() => { warpMode = false; })
        .to($warpFlash, {
            opacity: 0,
            duration: 0.8,
            ease: 'power2.out',
            delay: 0.2,
        });

        // ── Mission Next: fade in ──
        gsap.to('.mission-next-content', {
            scrollTrigger: {
                trigger: '#mission-next',
                start: 'top 80%',
                end: 'top 40%',
                scrub: 1,
            },
            opacity: 1,
            y: 0,
            duration: 1,
        });

        // ── Fade starfield when about-page appears ──
        gsap.to($starfieldCanvas, {
            scrollTrigger: {
                trigger: '#about-page',
                start: 'top 80%',
                end: 'top 30%',
                scrub: 1,
            },
            opacity: 0,
        });
    }

    /* ══════════════════════════════════════════
       5. TYPEWRITER EFFECT
    ══════════════════════════════════════════ */
    function prepareTypewriter(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const text = el.textContent;
        el.innerHTML = '';
        for (let i = 0; i < text.length; i++) {
            const span = document.createElement('span');
            span.className = 'char';
            if (text[i] === ' ') {
                span.innerHTML = '&nbsp;';
            } else {
                span.textContent = text[i];
            }
            el.appendChild(span);
        }
    }

    /* ══════════════════════════════════════════
       6. GLITCH-REVEAL EFFECT
    ══════════════════════════════════════════ */
    function prepareGlitchText(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const text = el.textContent;
        el.innerHTML = '';
        for (let i = 0; i < text.length; i++) {
            const span = document.createElement('span');
            span.className = 'glitch-char';
            span.textContent = text[i];
            span.dataset.final = text[i];
            span.dataset.revealed = 'false';
            el.appendChild(span);
        }
    }

    function triggerGlitchReveal(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const chars = el.querySelectorAll('.glitch-char');
        let revealIndex = 0;

        function revealNext() {
            if (revealIndex >= chars.length) return;

            const char = chars[revealIndex];
            char.dataset.revealed = 'true';
            char.textContent = char.dataset.final;

            revealIndex++;
            const delay = Math.random() * 40 + 20;
            setTimeout(revealNext, delay);
        }

        // Scramble phase
        let scrambleCount = 0;
        const scrambleInterval = setInterval(() => {
            chars.forEach((c) => {
                if (c.dataset.revealed === 'false') {
                    c.textContent = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
                }
            });
            scrambleCount++;
            if (scrambleCount > 15) {
                clearInterval(scrambleInterval);
            }
        }, 50);

        // Start revealing after a short delay
        setTimeout(revealNext, 200);
    }

    /* ══════════════════════════════════════════
       7. INIT
    ══════════════════════════════════════════ */
    function init() {
        // Boot sequence
        runBootSequence();

        // Enter archive button
        $enterArchiveBtn.addEventListener('click', enterArchive);
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();