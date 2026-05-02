/**
 * ============================================================================
 * THREE.JS LOGO SCENE
 * ============================================================================
 * Uses the portfolio logo as the animated hero object.
 * Pure JavaScript - no React/frameworks required.
 * ============================================================================
 */

(function() {
    'use strict';

    const container = document.getElementById('canvas-container');
    const heroSection = document.getElementById('hero');
    if (!container || typeof THREE === 'undefined') return;

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    camera.position.set(0, 1.45, 5.2);
    camera.lookAt(0, 0.95, 0);

    const logoGroup = new THREE.Group();
    const auraGroup = new THREE.Group();
    const particleGroup = new THREE.Group();
    scene.add(auraGroup);
    scene.add(logoGroup);
    scene.add(particleGroup);

    let pageScrollProgress = 0;
    let heroScrollProgress = 0;
    let logoPlane = null;
    let logoGlowPlane = null;
    let particles = null;
    let particlePositions = null;
    let particleSeeds = [];
    let ringPrimary = null;
    let ringSecondary = null;
    let glowSprite = null;
    let time = 0;
    const pointer = {
        x: 0,
        y: 0,
        targetProximity: 0,
        proximity: 0,
        pulse: 0,
        hasMoved: false
    };

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function isLightTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    function getResponsiveLayout() {
        const isMobile = window.innerWidth < 760;
        const isTablet = window.innerWidth < 1100;

        return {
            x: isMobile ? 0.1 : (isTablet ? 1.42 : 2.08),
            y: isMobile ? 0.96 : 1.08,
            z: isMobile ? -0.18 : -0.08,
            size: isMobile ? 1.22 : (isTablet ? 1.48 : 1.78)
        };
    }

    function createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 31, 31, 0.46)');
        gradient.addColorStop(0.38, 'rgba(204, 17, 17, 0.20)');
        gradient.addColorStop(1, 'rgba(204, 17, 17, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(canvas);
    }

    function createFallbackLogoTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');

        context.clearRect(0, 0, 512, 512);
        context.strokeStyle = '#cc1111';
        context.lineWidth = 34;
        context.lineJoin = 'round';
        context.beginPath();
        context.moveTo(256, 52);
        context.lineTo(426, 154);
        context.lineTo(426, 444);
        context.lineTo(256, 330);
        context.lineTo(86, 444);
        context.lineTo(86, 154);
        context.closePath();
        context.stroke();

        context.strokeStyle = '#ffffff';
        context.lineWidth = 24;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(186, 174);
        context.lineTo(186, 340);
        context.moveTo(326, 174);
        context.lineTo(326, 340);
        context.moveTo(186, 256);
        context.lineTo(326, 256);
        context.stroke();

        return new THREE.CanvasTexture(canvas);
    }

    function positionLogoPlane(mesh, texture, scaleMultiplier) {
        const layout = getResponsiveLayout();
        const image = texture.image || {};
        const aspect = image.width && image.height ? image.width / image.height : 1;
        const height = layout.size * scaleMultiplier;
        const width = height * aspect;

        mesh.scale.set(width, height, 1);
        logoGroup.position.set(layout.x, layout.y, layout.z);
    }

    function createLogoMesh(texture) {
        texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
        texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

        const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
        const logoMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.96,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const glowMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xcc1111,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });

        logoPlane = new THREE.Mesh(geometry, logoMaterial);
        logoGlowPlane = new THREE.Mesh(geometry.clone(), glowMaterial);
        logoGlowPlane.position.z = -0.045;

        positionLogoPlane(logoPlane, texture, 1);
        positionLogoPlane(logoGlowPlane, texture, 1.08);

        logoGroup.clear();
        logoGroup.add(logoGlowPlane);
        logoGroup.add(logoPlane);
    }

    function createRings() {
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0xcc1111,
            transparent: true,
            opacity: 0.36,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });

        const softRingMaterial = ringMaterial.clone();
        softRingMaterial.opacity = 0.18;

        ringPrimary = new THREE.Mesh(new THREE.RingGeometry(1.03, 1.045, 128), ringMaterial);
        ringSecondary = new THREE.Mesh(new THREE.RingGeometry(1.32, 1.335, 128), softRingMaterial);
        ringPrimary.position.z = -0.08;
        ringSecondary.position.z = -0.1;

        const glowTexture = createGlowTexture();
        glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture,
            color: 0xff1f1f,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));

        auraGroup.add(glowSprite);
        auraGroup.add(ringSecondary);
        auraGroup.add(ringPrimary);
    }

    function createParticles() {
        const particleCount = 74;
        const geometry = new THREE.BufferGeometry();
        particlePositions = new Float32Array(particleCount * 3);
        particleSeeds = [];

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const radius = 1.45 + Math.random() * 1.35;
            const height = (Math.random() - 0.5) * 1.85;

            particleSeeds.push({
                angle,
                radius,
                height,
                speed: 0.012 + Math.random() * 0.022,
                phase: Math.random() * Math.PI * 2
            });

            particlePositions[i * 3] = Math.cos(angle) * radius;
            particlePositions[i * 3 + 1] = height;
            particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

        particles = new THREE.Points(geometry, new THREE.PointsMaterial({
            color: isLightTheme() ? 0x7a0909 : 0xcc1111,
            size: 0.023,
            transparent: true,
            opacity: 0.42,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        }));

        particleGroup.add(particles);
    }

    function updateSceneColors() {
        const lightTheme = isLightTheme();
        const accent = lightTheme ? 0x7a0909 : 0xcc1111;
        const hotAccent = lightTheme ? 0x7a0909 : 0xff1f1f;

        if (logoGlowPlane && logoGlowPlane.material) logoGlowPlane.material.color.setHex(accent);
        if (particles && particles.material) particles.material.color.setHex(accent);
        if (ringPrimary && ringPrimary.material) ringPrimary.material.color.setHex(accent);
        if (ringSecondary && ringSecondary.material) ringSecondary.material.color.setHex(accent);
        if (glowSprite && glowSprite.material) glowSprite.material.color.setHex(hotAccent);
    }

    function updateScrollProgress() {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        pageScrollProgress = clamp(docHeight > 0 ? scrollTop / docHeight : 0, 0, 1);

        if (heroSection) {
            const heroRect = heroSection.getBoundingClientRect();
            const heroRange = Math.max(heroRect.height, window.innerHeight);
            heroScrollProgress = clamp((-heroRect.top) / heroRange, 0, 1);
        } else {
            heroScrollProgress = pageScrollProgress;
        }
    }

    function updateResponsiveLayout() {
        const layout = getResponsiveLayout();
        logoGroup.position.set(layout.x, layout.y, layout.z);
        auraGroup.position.copy(logoGroup.position);
        particleGroup.position.copy(logoGroup.position);

        if (logoPlane && logoPlane.material && logoPlane.material.map) {
            positionLogoPlane(logoPlane, logoPlane.material.map, 1);
        }

        if (logoGlowPlane && logoGlowPlane.material && logoGlowPlane.material.map) {
            positionLogoPlane(logoGlowPlane, logoGlowPlane.material.map, 1.08);
        }

        const auraScale = layout.size * 0.68;
        if (ringPrimary) ringPrimary.scale.setScalar(auraScale);
        if (ringSecondary) ringSecondary.scale.setScalar(auraScale);
        if (glowSprite) glowSprite.scale.set(layout.size * 1.65, layout.size * 1.65, 1);
    }

    function updatePointerProximity(clientX, clientY) {
        pointer.x = (clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(clientY / window.innerHeight) * 2 + 1;
        pointer.hasMoved = true;

        const logoScreenPosition = logoGroup.position.clone().project(camera);
        const dx = pointer.x - logoScreenPosition.x;
        const dy = pointer.y - logoScreenPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        pointer.targetProximity = clamp(1 - distance / 0.54, 0, 1);
    }

    function wakeLogo(clientX, clientY) {
        updatePointerProximity(clientX, clientY);

        if (pointer.targetProximity > 0.12) {
            pointer.pulse = 1;
        }
    }

    function loadLogo() {
        const loader = new THREE.TextureLoader();
        loader.load(
            'logo.png',
            (texture) => {
                createLogoMesh(texture);
                updateResponsiveLayout();
            },
            undefined,
            () => {
                createLogoMesh(createFallbackLogoTexture());
                updateResponsiveLayout();
            }
        );
    }

    function init() {
        createRings();
        createParticles();
        loadLogo();
        updateSceneColors();
        updateResponsiveLayout();
        updateScrollProgress();
    }

    function animate() {
        requestAnimationFrame(animate);

        if (!prefersReducedMotion) {
            time += 0.016;
        }

        const layout = getResponsiveLayout();
        const scrollFade = 1 - (heroScrollProgress * 0.18);
        pointer.proximity += (pointer.targetProximity - pointer.proximity) * 0.075;
        pointer.pulse *= 0.93;

        const heartbeat = Math.pow(Math.max(0, Math.sin(time * 1.65)), 10) * 0.045;
        const breathe = 1 + Math.sin(time * 0.75) * 0.018 + heartbeat + (pointer.proximity * 0.04) + (pointer.pulse * 0.08);
        const floatY = Math.sin(time * 0.62) * 0.04;
        const lookX = pointer.hasMoved ? pointer.x * pointer.proximity : Math.sin(time * 0.2) * 0.25;
        const lookY = pointer.hasMoved ? pointer.y * pointer.proximity : Math.cos(time * 0.18) * 0.18;

        logoGroup.position.set(
            layout.x + Math.sin(time * 0.28) * 0.018 + (lookX * 0.045),
            layout.y + floatY - heroScrollProgress * 0.08 + (lookY * 0.025),
            layout.z
        );
        logoGroup.rotation.x = -lookY * 0.07;
        logoGroup.rotation.y = Math.sin(time * 0.32) * 0.08 + (lookX * 0.16);
        logoGroup.rotation.z = Math.sin(time * 0.24) * 0.025 + (lookX * 0.035);
        logoGroup.scale.setScalar(breathe);

        auraGroup.position.copy(logoGroup.position);
        auraGroup.rotation.z = time * (0.055 + pointer.proximity * 0.08 + pointer.pulse * 0.12);
        auraGroup.scale.setScalar(1 + Math.sin(time * 0.5) * 0.018 + pointer.proximity * 0.045 + pointer.pulse * 0.08);

        particleGroup.position.copy(logoGroup.position);
        particleGroup.rotation.y = time * (0.018 + pointer.proximity * 0.035);

        if (ringPrimary) {
            ringPrimary.rotation.z = -time * (0.18 + pointer.proximity * 0.18);
            ringPrimary.material.opacity = (0.24 + pointer.proximity * 0.16 + pointer.pulse * 0.22) * scrollFade;
        }

        if (ringSecondary) {
            ringSecondary.rotation.z = time * (0.11 + pointer.proximity * 0.12);
            ringSecondary.material.opacity = (0.12 + pointer.proximity * 0.12 + pointer.pulse * 0.12) * scrollFade;
        }

        if (logoPlane && logoPlane.material) logoPlane.material.opacity = 0.94 * scrollFade;
        if (logoGlowPlane && logoGlowPlane.material) {
            logoGlowPlane.material.opacity = (0.18 + pointer.proximity * 0.18 + pointer.pulse * 0.24) * scrollFade;
        }

        if (glowSprite && glowSprite.material) {
            glowSprite.material.opacity = (0.30 + pointer.proximity * 0.22 + pointer.pulse * 0.26) * scrollFade;
        }

        if (particles && particlePositions) {
            particleSeeds.forEach((seed, index) => {
                const angle = seed.angle + time * (seed.speed + pointer.proximity * 0.018);
                const pulseWave = Math.sin(time * 2.4 + seed.phase) * pointer.pulse * 0.16;
                const radius = seed.radius + Math.sin(time * 0.35 + seed.phase) * 0.035 - (pointer.proximity * 0.13) + pulseWave;

                particlePositions[index * 3] = Math.cos(angle) * radius;
                particlePositions[index * 3 + 1] = seed.height + Math.sin(time * 0.45 + seed.phase) * (0.045 + pointer.proximity * 0.045);
                particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
            });

            particles.geometry.attributes.position.needsUpdate = true;
            particles.material.opacity = 0.28 + (scrollFade * 0.12) + pointer.proximity * 0.16 + pointer.pulse * 0.16;
            particles.material.size = 0.023 + pointer.proximity * 0.008 + pointer.pulse * 0.012;
        }

        camera.position.z = 5.2 - heroScrollProgress * 0.12;
        camera.position.y = 1.45 - heroScrollProgress * 0.04;
        camera.lookAt(0, 0.95 - heroScrollProgress * 0.04, 0);

        if (container) {
            const containerScale = 1 + heroScrollProgress * 0.015;
            container.style.transform = `translate3d(0, ${(-heroScrollProgress * 0.45).toFixed(2)}%, 0) scale(${containerScale.toFixed(3)})`;
            container.style.opacity = String(1 - heroScrollProgress * 0.08);
        }

        renderer.render(scene, camera);
    }

    const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                updateSceneColors();
            }
        });
    });

    window.addEventListener('scroll', updateScrollProgress, { passive: true });
    window.addEventListener('pointermove', (event) => {
        updatePointerProximity(event.clientX, event.clientY);
    }, { passive: true });
    window.addEventListener('pointerleave', () => {
        pointer.targetProximity = 0;
        pointer.hasMoved = false;
    }, { passive: true });
    window.addEventListener('pointerdown', (event) => {
        wakeLogo(event.clientX, event.clientY);
    }, { passive: true });
    window.addEventListener('touchstart', (event) => {
        const touch = event.touches && event.touches[0];
        if (touch) wakeLogo(touch.clientX, touch.clientY);
    }, { passive: true });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        updateResponsiveLayout();
    });

    themeObserver.observe(document.documentElement, { attributes: true });

    init();
    animate();
})();
