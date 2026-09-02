(function() {
    'use strict';

    const container = document.getElementById('canvas-container');
    const heroSection = document.getElementById('hero');
    if (!container || typeof THREE === 'undefined') return;

    const MODEL_URL = 'https://developer0071.github.io/gaming_desktop_pc-model/gaming_desktop_pc%20for%20model/scene.gltf';
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });

    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const workstationGroup = new THREE.Group();
    const wireGroup = new THREE.Group();
    const particleGroup = new THREE.Group();
    const fallbackGroup = new THREE.Group();
    scene.add(wireGroup);
    scene.add(particleGroup);
    scene.add(workstationGroup);

    const accentLight = new THREE.PointLight(0xcc1111, 1.7, 9);
    const monitorGlow = new THREE.PointLight(0xff1f1f, 1.3, 5);
    const softKey = new THREE.DirectionalLight(0xffffff, 1.55);
    const rimLight = new THREE.DirectionalLight(0xcc1111, 1.2);
    const ambientLight = new THREE.HemisphereLight(0xffffff, 0x080808, 1.4);

    softKey.position.set(-2.6, 5.8, 5.4);
    softKey.castShadow = true;
    softKey.shadow.mapSize.set(1024, 1024);
    rimLight.position.set(4.8, 3.3, -3.4);
    accentLight.position.set(2.4, 0.9, 2.1);
    monitorGlow.position.set(0.7, 0.2, 1.4);

    scene.add(ambientLight, softKey, rimLight, accentLight, monitorGlow);

    const state = {
        model: null,
        activeRig: fallbackGroup,
        baseScale: 1,
        loaded: false,
        heroScrollProgress: 0,
        pageScrollProgress: 0,
        time: 0,
        dragYaw: 0,
        dragPitch: 0,
        targetDragYaw: 0,
        targetDragPitch: 0,
        interactionPulse: 0,
        pointerX: 0,
        pointerY: 0,
        targetPointerX: 0,
        targetPointerY: 0,
        hasPointer: false,
        isDragging: false
    };

    const animatedMaterials = [];
    let particles = null;
    let particlePositions = null;
    const particleSeeds = [];

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function isLightTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    function cssColorToHex(variableName, fallback) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        if (!raw) return fallback;

        const probe = document.createElement('span');
        probe.style.color = raw;
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).color;
        probe.remove();

        const match = computed.match(/\d+/g);
        if (!match || match.length < 3) return fallback;

        const [r, g, b] = match.map(Number);
        return (r << 16) + (g << 8) + b;
    }

    function getPalette() {
        return {
            accent: cssColorToHex('--color-accent-primary', isLightTheme() ? 0xb10f1a : 0xcc1111),
            hot: cssColorToHex('--color-accent-secondary', isLightTheme() ? 0xe11d2e : 0xff1f1f),
            text: cssColorToHex('--color-text-secondary', isLightTheme() ? 0x343b37 : 0xb0b8c8),
            surface: cssColorToHex('--color-bg-tertiary', isLightTheme() ? 0xdfe7e1 : 0x101010)
        };
    }

    function getLayout() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isMobile = width < 720;
        const isTablet = width >= 720 && width < 1060;

        if (isMobile) {
            const isNarrowPhone = width < 520;

            return {
                camera: new THREE.Vector3(0.2, 1.35, isNarrowPhone ? 8 : 7.25),
                target: new THREE.Vector3(0.1, 0.08, 0),
                modelPosition: new THREE.Vector3(0.16, isNarrowPhone ? -2.08 : -1.5, 0.18),
                modelScale: isNarrowPhone ? 0.64 : 0.76,
                modelRotation: -0.95,
                wireScale: 0.72,
                wirePosition: new THREE.Vector3(0.25, -0.2, -1.6)
            };
        }

        if (isTablet) {
            return {
                camera: new THREE.Vector3(0.25, 1.45, 6.8),
                target: new THREE.Vector3(0.52, 0.1, 0),
                modelPosition: new THREE.Vector3(1.22, -0.82, 0),
                modelScale: 0.94,
                modelRotation: -0.92,
                wireScale: 0.9,
                wirePosition: new THREE.Vector3(0.82, 0.05, -1.5)
            };
        }

        return {
            camera: new THREE.Vector3(0.26, 1.36 + clamp((height - 800) / 2400, -0.08, 0.18), 6.1),
            target: new THREE.Vector3(0.78, 0.12, 0),
            modelPosition: new THREE.Vector3(2.1, -0.72, 0.02),
            modelScale: 1.05,
            modelRotation: -0.95,
            wireScale: 1,
            wirePosition: new THREE.Vector3(1.15, 0.12, -1.7)
        };
    }

    function makeMaterial(options) {
        const material = new THREE.MeshStandardMaterial(options);
        material.roughness = options.roughness ?? 0.48;
        material.metalness = options.metalness ?? 0.22;
        return material;
    }

    function createFallbackWorkstation() {
        const palette = getPalette();
        const black = makeMaterial({ color: 0x070707, roughness: 0.62, metalness: 0.2 });
        const darkMetal = makeMaterial({ color: 0x141414, roughness: 0.42, metalness: 0.45 });
        const platform = makeMaterial({ color: 0x1a1a1a, roughness: 0.74, metalness: 0.08 });
        const screen = makeMaterial({
            color: 0x101010,
            emissive: 0x260606,
            emissiveIntensity: 0.46,
            roughness: 0.3,
            metalness: 0.08
        });
        const accent = makeMaterial({
            color: palette.hot,
            emissive: palette.hot,
            emissiveIntensity: 1.2,
            roughness: 0.28,
            metalness: 0.12
        });

        const desk = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.14, 2.8), platform);
        desk.position.set(0.1, -0.72, -0.05);
        desk.receiveShadow = true;
        fallbackGroup.add(desk);

        const monitor = new THREE.Mesh(new THREE.BoxGeometry(2.65, 1.48, 0.12), darkMetal);
        monitor.position.set(-0.25, 0.38, -0.12);
        monitor.castShadow = true;
        fallbackGroup.add(monitor);

        const monitorScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.42, 1.26), screen);
        monitorScreen.position.set(-0.25, 0.38, -0.055);
        fallbackGroup.add(monitorScreen);

        const screenLines = new THREE.Group();
        for (let i = 0; i < 11; i++) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(0.9 + Math.sin(i) * 0.32, 0.012, 0.01), accent);
            line.position.set(-0.72 + (i % 2) * 0.35, 0.82 - i * 0.09, -0.045);
            screenLines.add(line);
        }
        fallbackGroup.add(screenLines);

        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.14), darkMetal);
        stand.position.set(-0.25, -0.42, -0.08);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.48), darkMetal);
        foot.position.set(-0.25, -0.78, 0.05);
        fallbackGroup.add(stand, foot);

        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.1, 0.82), black);
        tower.position.set(2.45, 0.15, -0.02);
        tower.castShadow = true;
        fallbackGroup.add(tower);

        for (let i = 0; i < 2; i++) {
            const fan = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 12, 64), accent);
            fan.position.set(2.45, 0.55 - i * 0.65, 0.405);
            fallbackGroup.add(fan);

            const fanCore = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), makeMaterial({
                color: 0xffffff,
                emissive: palette.hot,
                emissiveIntensity: 0.35
            }));
            fanCore.position.copy(fan.position);
            fanCore.position.z += 0.004;
            fallbackGroup.add(fanCore);
        }

        const keyboard = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.1, 0.46), darkMetal);
        keyboard.position.set(-1.38, -0.59, 0.86);
        keyboard.rotation.y = -0.08;
        fallbackGroup.add(keyboard);

        for (let i = 0; i < 18; i++) {
            const key = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.07), i % 5 === 0 ? accent : black);
            key.position.set(-2.16 + (i % 9) * 0.17, -0.51, 0.72 + Math.floor(i / 9) * 0.13);
            fallbackGroup.add(key);
        }

        const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), makeMaterial({
            color: palette.hot,
            emissive: palette.hot,
            emissiveIntensity: 0.44,
            roughness: 0.38,
            metalness: 0.08
        }));
        mouse.scale.set(1, 0.32, 1.35);
        mouse.position.set(0.86, -0.58, 0.92);
        fallbackGroup.add(mouse);

        [-1.95, 1.15].forEach((x) => {
            const speaker = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.72, 0.34), black);
            speaker.position.set(x, -0.35, 0.18);
            fallbackGroup.add(speaker);

            const cone = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 10, 36), accent);
            cone.position.set(x, -0.28, 0.355);
            fallbackGroup.add(cone);
        });

        fallbackGroup.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        workstationGroup.add(fallbackGroup);
        state.activeRig = fallbackGroup;
        state.baseScale = 1;
    }

    function createWireField() {
        const palette = getPalette();
        const material = new THREE.LineBasicMaterial({
            color: palette.accent,
            transparent: true,
            opacity: isLightTheme() ? 0.13 : 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        for (let row = 0; row < 42; row++) {
            const points = [];
            const rowOffset = row / 41;

            for (let i = 0; i < 120; i++) {
                const t = i / 119;
                const x = (t - 0.5) * 9.8;
                const wave = Math.sin(t * Math.PI * 2.1 + rowOffset * 3.8) * (0.28 + rowOffset * 0.28);
                const y = 1.55 + rowOffset * 2.75 + wave;
                const z = -2.4 - rowOffset * 0.2 + Math.cos(t * Math.PI * 2 + rowOffset) * 0.18;
                points.push(new THREE.Vector3(x, y, z));
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material.clone());
            line.material.opacity = (isLightTheme() ? 0.05 : 0.06) + rowOffset * (isLightTheme() ? 0.08 : 0.12);
            line.position.x = row < 22 ? -2.2 : 2.5;
            line.position.y = row < 22 ? -1.6 : -1.4;
            line.rotation.z = row < 22 ? -0.18 : 0.23;
            line.userData.baseY = line.position.y;
            line.userData.baseOpacity = line.material.opacity;
            wireGroup.add(line);
        }
    }

    function createParticles() {
        const palette = getPalette();
        const count = 90;
        const geometry = new THREE.BufferGeometry();
        particlePositions = new Float32Array(count * 3);
        particleSeeds.length = 0;

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * 7.6;
            const y = Math.random() * 3.4 - 0.2;
            const z = -2.2 + Math.random() * 1.5;
            particlePositions[i * 3] = x;
            particlePositions[i * 3 + 1] = y;
            particlePositions[i * 3 + 2] = z;
            particleSeeds.push({
                x,
                y,
                z,
                phase: Math.random() * Math.PI * 2,
                speed: 0.25 + Math.random() * 0.5
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
        particles = new THREE.Points(geometry, new THREE.PointsMaterial({
            color: palette.hot,
            size: 0.022,
            transparent: true,
            opacity: isLightTheme() ? 0.12 : 0.18,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));

        particleGroup.add(particles);
    }

    function prepareLoadedModel(root) {
        root.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z, 1);

        root.position.sub(center);
        state.baseScale = 4.65 / maxAxis;

        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;

            child.castShadow = true;
            child.receiveShadow = true;

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                material.side = THREE.FrontSide;
                material.needsUpdate = true;

                if (material.map) {
                    material.map.encoding = THREE.sRGBEncoding;
                    material.map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
                }

                if (material.emissive) {
                    const name = String(material.name || child.name || '').toLowerCase();
                    if (name.includes('emissive') || name.includes('screen') || name.includes('fan') || name.includes('rgb')) {
                        material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 0.7);
                        animatedMaterials.push(material);
                    }
                }
            });
        });

        workstationGroup.remove(fallbackGroup);
        workstationGroup.add(root);
        state.model = root;
        state.activeRig = root;
        state.loaded = true;
        updateSceneColors();
        updateResponsiveLayout();
    }

    function loadWorkstationModel() {
        if (typeof THREE.GLTFLoader !== 'function') {
            return;
        }

        const loader = new THREE.GLTFLoader();
        loader.load(
            MODEL_URL,
            (gltf) => prepareLoadedModel(gltf.scene),
            undefined,
            () => {
                state.loaded = false;
                state.activeRig = fallbackGroup;
                updateResponsiveLayout();
            }
        );
    }

    function updateSceneColors() {
        const palette = getPalette();
        const lineOpacity = isLightTheme() ? 0.12 : 0.18;

        accentLight.color.setHex(palette.hot);
        monitorGlow.color.setHex(palette.hot);
        rimLight.color.setHex(palette.accent);

        wireGroup.children.forEach((line, index) => {
            if (!line.material) return;
            line.material.color.setHex(palette.accent);
            line.material.opacity = lineOpacity * (0.35 + index / Math.max(wireGroup.children.length, 1));
        });

        if (particles && particles.material) {
            particles.material.color.setHex(palette.hot);
            particles.material.opacity = isLightTheme() ? 0.12 : 0.18;
        }

        animatedMaterials.forEach((material) => {
            if (material.emissive) {
                material.emissive.setHex(palette.hot);
            }
        });
    }

    function updateScrollProgress() {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        state.pageScrollProgress = clamp(docHeight > 0 ? scrollTop / docHeight : 0, 0, 1);

        if (heroSection) {
            const heroRect = heroSection.getBoundingClientRect();
            const heroRange = Math.max(heroRect.height, window.innerHeight);
            state.heroScrollProgress = clamp((-heroRect.top) / heroRange, 0, 1);
        } else {
            state.heroScrollProgress = state.pageScrollProgress;
        }
    }

    function updateResponsiveLayout() {
        const layout = getLayout();

        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        camera.position.copy(layout.camera);
        camera.lookAt(layout.target);

        workstationGroup.position.copy(layout.modelPosition);
        workstationGroup.scale.setScalar(state.baseScale * layout.modelScale);
        workstationGroup.rotation.set(0, layout.modelRotation, 0);

        wireGroup.position.copy(layout.wirePosition);
        wireGroup.scale.setScalar(layout.wireScale);

        particleGroup.position.copy(layout.wirePosition);
        particleGroup.scale.setScalar(layout.wireScale);
    }

    function animate() {
        requestAnimationFrame(animate);

        // if (!prefersReducedMotion) {
        //     state.time += 0.016;
        // }

        const layout = getLayout();
        state.pointerX += (state.targetPointerX - state.pointerX) * 0.055;
        state.pointerY += (state.targetPointerY - state.pointerY) * 0.055;
        state.dragYaw += (state.targetDragYaw - state.dragYaw) * 0.12;
        state.dragPitch += (state.targetDragPitch - state.dragPitch) * 0.12;
        state.interactionPulse *= 0.9;

        const drift = prefersReducedMotion ? 0 : Math.sin(state.time * 0.6) * 0.035;
        const pointerTilt = state.hasPointer ? state.pointerX * 0.08 : Math.sin(state.time * 0.22) * 0.035;
        const pointerLift = state.hasPointer ? state.pointerY * 0.055 : 0;
        const interactionScale = 1 + state.interactionPulse * 0.045;
        const scrollFade = 1 - state.heroScrollProgress * 0.28;

        workstationGroup.position.set(
            layout.modelPosition.x + pointerTilt * 0.18,
            layout.modelPosition.y + drift + pointerLift - state.heroScrollProgress * 0.16,
            layout.modelPosition.z
        );
        workstationGroup.scale.setScalar(state.baseScale * layout.modelScale * interactionScale * (1 - state.heroScrollProgress * 0.025));
        workstationGroup.rotation.y = layout.modelRotation + pointerTilt + state.dragYaw;
        workstationGroup.rotation.x = -state.pointerY * 0.035 + state.dragPitch;

        wireGroup.rotation.z = state.pointerX * 0.08;
        wireGroup.position.y = layout.wirePosition.y + state.pointerY * 0.08;
        wireGroup.children.forEach((line, index) => {
            line.position.y = line.userData.baseY + state.pointerY * 0.02 * (index % 5);
            if (line.material) {
                line.material.opacity = line.userData.baseOpacity * (0.86 + Math.abs(state.pointerX) * 0.14);
            }
        });

        if (particles && particlePositions) {
            particleSeeds.forEach((seed, index) => {
                particlePositions[index * 3] = seed.x + state.pointerX * seed.speed * 0.5;
                particlePositions[index * 3 + 1] = seed.y - state.pointerY * seed.speed * 0.5;
                particlePositions[index * 3 + 2] = seed.z;
            });
            particles.geometry.attributes.position.needsUpdate = true;
        }

        animatedMaterials.forEach((material, index) => {
            material.emissiveIntensity = 0.7 + Math.sin(state.time * 1.2 + index * 0.7) * 0.18;
        });

        accentLight.intensity = 1.25 + Math.sin(state.time * 1.1) * 0.2 + state.interactionPulse * 0.9;
        monitorGlow.intensity = 1.05 + Math.sin(state.time * 1.7) * 0.25 + state.interactionPulse * 0.7;

        camera.position.set(
            layout.camera.x + state.pointerX * 0.04,
            layout.camera.y + state.pointerY * 0.03,
            layout.camera.z - state.heroScrollProgress * 0.2
        );
        camera.lookAt(layout.target.x, layout.target.y - state.heroScrollProgress * 0.05, layout.target.z);

        renderer.domElement.style.opacity = String(scrollFade);
        container.style.transform = `translate3d(0, ${(-state.heroScrollProgress * 0.65).toFixed(2)}%, 0)`;

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
    function updatePointerFromEvent(event) {
        state.targetPointerX = (event.clientX / window.innerWidth) * 2 - 1;
        state.targetPointerY = -(event.clientY / window.innerHeight) * 2 + 1;
        state.hasPointer = true;
    }

    function isInteractiveTarget(target) {
        return target && typeof target.closest === 'function' && Boolean(target.closest('a, button, input, textarea, select, label'));
    }

    function beginDrag(event) {
        if (isInteractiveTarget(event.target)) return;

        state.isDragging = true;
        state.interactionPulse = 1;
        updatePointerFromEvent(event);

        if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
    }

    window.addEventListener('pointermove', (event) => {
        updatePointerFromEvent(event);

        if (!state.isDragging) return;

        state.targetDragYaw += event.movementX * 0.012;
        state.targetDragPitch = clamp(state.targetDragPitch + event.movementY * 0.004, -0.26, 0.18);
        state.interactionPulse = Math.max(state.interactionPulse, 0.45);
    }, { passive: true });
    window.addEventListener('pointerleave', () => {
        if (state.isDragging) return;
        state.targetPointerX = 0;
        state.targetPointerY = 0;
        state.hasPointer = false;
    }, { passive: true });
    window.addEventListener('pointerup', () => {
        state.isDragging = false;
    }, { passive: true });
    window.addEventListener('resize', () => {
        renderer.setSize(container.clientWidth, container.clientHeight);
        updateResponsiveLayout();
    });

    renderer.domElement.addEventListener('pointerdown', beginDrag, { passive: true });

    if (heroSection) {
        heroSection.addEventListener('pointerdown', beginDrag, { passive: true });
    }

    renderer.domElement.addEventListener('pointerenter', () => {
        state.interactionPulse = Math.max(state.interactionPulse, 0.42);
    }, { passive: true });

    renderer.domElement.addEventListener('dblclick', () => {
        state.targetDragYaw += Math.PI * 0.5;
        state.interactionPulse = 1;
    });

    themeObserver.observe(document.documentElement, { attributes: true });

    createFallbackWorkstation();
    createWireField();
    createParticles();
    updateSceneColors();
    updateResponsiveLayout();
    updateScrollProgress();
    loadWorkstationModel();
    animate();
})();
