(function() {
    'use strict';

    const stage = document.getElementById('serverRoomStage');
    const container = document.getElementById('serverRoomCanvas');
    const status = document.getElementById('serverRoomStatus');

    if (!stage || !container || typeof THREE === 'undefined') return;

    const MODEL_SOURCES = (container.getAttribute('data-model-sources') || container.getAttribute('data-model-src') || 'assets/server/scene.fast.gltf, assets/server/scene.fast.gtlf, assets/server/scene.gltf')
        .split(',')
        .map((source) => source.trim())
        .filter(Boolean);
    const OPEN_TEXTURE_SRC = container.getAttribute('data-open-texture-src') || 'assets/server/textures/open-texture.png';
    const ARCHIVE_URL = '/archives';
    const MODEL_VIEW_SCALE = 2.85;
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.025, 90);
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const clock = new THREE.Clock();
    const roomGroup = new THREE.Group();
    const clickableMeshes = [];
    const animatedMaterials = [];
    const archiveAffordances = [];
    const textureLoader = new THREE.TextureLoader();
    let archiveOpenButton = null;
    let archiveOpenTexture = null;

    scene.add(roomGroup);

    const skyLight = new THREE.HemisphereLight(0xdfefff, 0x040405, 1.25);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    const redLight = new THREE.PointLight(0xff2a2a, 2.1, 9);
    const cyanLight = new THREE.PointLight(0x12beae, 1.15, 8);
    const amberLight = new THREE.PointLight(0xffb84d, 0.65, 7);

    keyLight.position.set(-3.8, 5.6, 4.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    redLight.position.set(-2.2, 1.3, 1.8);
    cyanLight.position.set(2.4, 1.2, -1.8);
    amberLight.position.set(0, 2.8, 2.5);
    scene.add(skyLight, keyLight, redLight, cyanLight, amberLight);

    camera.position.set(2.9, 1.45, 5.6);

    let controls = null;
    if (typeof THREE.OrbitControls === 'function') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.enablePan = true;
        controls.screenSpacePanning = true;
        controls.minDistance = 1.35;
        controls.maxDistance = 8.6;
        controls.maxPolarAngle = Math.PI * 0.92;
        controls.target.set(0, 0.02, 0);
        controls.autoRotate = !prefersReducedMotion;
        controls.autoRotateSpeed = 0.18;
    } else {
        camera.lookAt(0, 0.18, 0);
    }

    const pointer = new THREE.Vector2();
    const picker = new THREE.Raycaster();
    const state = {
        isPointerDown: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        startTime: 0,
        moved: false,
        dragYaw: -0.2,
        targetDragYaw: -0.2,
        dragPitch: 0,
        targetDragPitch: 0,
        zoom: 5.6,
        targetZoom: 5.6,
        lastWheelAt: 0,
        pulse: 0,
        hoveringClickable: false
    };

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function isLightTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    function setStatus(message) {
        if (status) {
            status.textContent = message;
        }
    }

    function markLoaded() {
        setStatus('Room ready.');
        window.setTimeout(() => stage.classList.add('is-loaded'), prefersReducedMotion ? 80 : 260);
    }

    function makeMaterial(options) {
        const material = new THREE.MeshStandardMaterial(options);
        material.roughness = options.roughness ?? 0.54;
        material.metalness = options.metalness ?? 0.16;
        return material;
    }

    function addClickableMesh(mesh) {
        if (mesh && (mesh.isMesh || mesh.isSprite)) {
            clickableMeshes.push(mesh);
        }
    }

    function removeClickableObject(object) {
        const index = clickableMeshes.indexOf(object);

        if (index > -1) {
            clickableMeshes.splice(index, 1);
        }
    }

    function loadArchiveOpenTexture() {
        if (archiveOpenTexture) return archiveOpenTexture;

        archiveOpenTexture = textureLoader.load(OPEN_TEXTURE_SRC, (texture) => {
            texture.encoding = THREE.sRGBEncoding;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.repeat.set(0.42, 0.28);
            texture.offset.set(0.29, 0.36);
            texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
            texture.needsUpdate = true;
        });

        return archiveOpenTexture;
    }

    function clearArchiveOpenButton() {
        if (archiveOpenButton) {
            archiveOpenButton.traverse((child) => {
                removeClickableObject(child);

                const oldIndex = archiveAffordances.indexOf(child);

                if (oldIndex > -1) {
                    archiveAffordances.splice(oldIndex, 1);
                }
            });

            archiveOpenButton = null;
        }
    }

    function addArchiveOpenButton(fittedSize) {
        clearArchiveOpenButton();

        const textureAspect = (612 * 0.42) / (408 * 0.28);
        const texture = loadArchiveOpenTexture();
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.94,
            alphaTest: 0.05,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
            side: THREE.DoubleSide
        });
        const group = new THREE.Group();
        const panelWidth = clamp(fittedSize.z * 0.58, 0.34, 0.56);
        const panelHeight = panelWidth / textureAspect;
        const panelGeometry = new THREE.PlaneGeometry(panelWidth, panelHeight);
        const panelY = fittedSize.y * 0.24;
        const panelXOffset = fittedSize.x * 0.5 + 0.025;
        const sidePanels = [
            {
                name: 'Archive_Open_Left_Rack_Mount',
                x: -panelXOffset,
                rotationY: -Math.PI / 2
            },
            {
                name: 'Archive_Open_Right_Rack_Mount',
                x: panelXOffset,
                rotationY: Math.PI / 2
            }
        ];

        group.name = 'Archive_Open_Texture_Rack_Mounts';

        sidePanels.forEach((side, index) => {
            const panel = new THREE.Mesh(panelGeometry, material);

            panel.name = side.name;
            panel.position.set(side.x, panelY, 0);
            panel.rotation.y = side.rotationY;
            panel.renderOrder = 8;
            panel.userData.phase = index * 0.45;

            group.add(panel);
            addClickableMesh(panel);
            archiveAffordances.push(panel);
        });

        roomGroup.add(group);
        archiveOpenButton = group;
    }

    function createFallbackRoom() {
        const group = new THREE.Group();
        const darkMetal = makeMaterial({ color: 0x111417, roughness: 0.46, metalness: 0.62 });
        const black = makeMaterial({ color: 0x030405, roughness: 0.7, metalness: 0.22 });
        const glass = makeMaterial({
            color: 0x0c1e23,
            roughness: 0.24,
            metalness: 0.1,
            transparent: true,
            opacity: 0.72
        });
        const redGlow = makeMaterial({
            color: 0xff2a2a,
            emissive: 0xff2a2a,
            emissiveIntensity: 1.4,
            roughness: 0.32,
            metalness: 0.1
        });
        const cyanGlow = makeMaterial({
            color: 0x12beae,
            emissive: 0x12beae,
            emissiveIntensity: 0.9,
            roughness: 0.32,
            metalness: 0.1
        });

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 6; col++) {
                const rack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 2.55, 0.55), darkMetal);
                rack.position.set(-1.7 + col * 0.68, -0.1, row ? -0.82 : 0.78);
                rack.castShadow = true;
                rack.receiveShadow = true;
                group.add(rack);
                addClickableMesh(rack);

                const door = new THREE.Mesh(new THREE.BoxGeometry(0.41, 2.32, 0.035), glass);
                door.position.set(rack.position.x, rack.position.y, rack.position.z + (row ? -0.29 : 0.29));
                group.add(door);
                addClickableMesh(door);

                for (let light = 0; light < 7; light++) {
                    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.05), (light + col + row) % 3 === 0 ? cyanGlow : redGlow);
                    led.position.set(rack.position.x - 0.17, 0.88 - light * 0.28, door.position.z + (row ? -0.03 : 0.03));
                    led.userData.phase = light * 0.38 + col * 0.2 + row;
                    group.add(led);
                    animatedMaterials.push(led.material);
                    addClickableMesh(led);
                }
            }
        }

        const doorway = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.7, 0.12), black);
        doorway.position.set(0.38, -0.03, -1.72);
        group.add(doorway);
        addClickableMesh(doorway);

        const portal = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.85, 0.04), redGlow);
        portal.position.set(0.38, -0.05, -1.64);
        portal.userData.phase = 1.7;
        group.add(portal);
        animatedMaterials.push(portal.material);
        addClickableMesh(portal);

        group.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        return group;
    }

    function centerAndScale(root) {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3();
        const meshBox = new THREE.Box3();
        let visibleMeshCount = 0;

        root.traverse((child) => {
            if (!child.isMesh || child.visible === false) return;

            meshBox.setFromObject(child);
            box.union(meshBox);
            visibleMeshCount++;
        });

        if (!visibleMeshCount || box.isEmpty()) {
            box.setFromObject(root);
        }

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z, 1);
        const holder = new THREE.Group();

        root.position.sub(center);
        holder.add(root);
        const fittedScale = MODEL_VIEW_SCALE / maxAxis;
        const fittedSize = size.clone().multiplyScalar(fittedScale);

        holder.scale.setScalar(fittedScale);

        while (roomGroup.children.length) {
            roomGroup.remove(roomGroup.children[0]);
        }

        roomGroup.add(holder);
        addArchiveOpenButton(fittedSize);
    }

    function prepareLoadedModel(root) {
        clickableMeshes.length = 0;
        animatedMaterials.length = 0;

        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;

            child.castShadow = true;
            child.receiveShadow = true;
            addClickableMesh(child);

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                material.side = THREE.DoubleSide;
                material.needsUpdate = true;

                if (material.map) {
                    material.map.encoding = THREE.sRGBEncoding;
                    material.map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
                }

                if (material.emissive) {
                    const materialName = String(material.name || child.name || '').toLowerCase();
                    if (materialName.includes('light') || materialName.includes('lamp') || materialName.includes('screen')) {
                        material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 0.7);
                        animatedMaterials.push(material);
                    }
                }
            });
        });

        centerAndScale(root);
        markLoaded();
    }

    function loadModel() {
        if (typeof THREE.GLTFLoader !== 'function') {
            const fallback = createFallbackRoom();
            centerAndScale(fallback);
            markLoaded();
            return;
        }

        const loader = new THREE.GLTFLoader();
        function loadSource(index) {
            const source = MODEL_SOURCES[index];

            if (!source) {
                setStatus('Fallback room online.');
                const fallback = createFallbackRoom();
                centerAndScale(fallback);
                markLoaded();
                return;
            }

            loader.load(
                source,
                (gltf) => prepareLoadedModel(gltf.scene),
                undefined,
                () => loadSource(index + 1)
            );
        }

        loadSource(0);
    }

    function updateTheme() {
        const light = isLightTheme();
        scene.fog = new THREE.FogExp2(light ? 0xe8f0ec : 0x020405, light ? 0.028 : 0.055);
        skyLight.color.setHex(light ? 0xffffff : 0xdfefff);
        skyLight.groundColor.setHex(light ? 0xbac8c1 : 0x040405);
        skyLight.intensity = light ? 1.35 : 1.25;
        keyLight.intensity = light ? 2.35 : 2.1;
        redLight.intensity = light ? 1.4 : 2.4;
        cyanLight.intensity = light ? 0.95 : 1.35;
    }

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(Math.floor(rect.width), 1);
        const height = Math.max(Math.floor(rect.height), 1);

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function getPointerInCanvas(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pointerHitsRoom(event) {
        if (!clickableMeshes.length) return false;

        getPointerInCanvas(event);
        picker.setFromCamera(pointer, camera);
        return picker.intersectObjects(clickableMeshes, true).length > 0;
    }

    function setClickableHover(isHovering) {
        if (state.hoveringClickable === isHovering) return;

        state.hoveringClickable = isHovering;
        stage.classList.toggle('is-clickable', isHovering);

        if (isHovering) {
            state.pulse = Math.max(state.pulse, 0.75);
        }
    }

    function enterArchives() {
        window.location.href = ARCHIVE_URL;
    }

    function handlePointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;

        state.isPointerDown = true;
        state.startX = event.clientX;
        state.startY = event.clientY;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        state.startTime = performance.now();
        state.moved = false;
        state.pulse = 1;
        stage.classList.add('is-dragging');
    }

    function handlePointerMove(event) {
        if (!state.isPointerDown) {
            setClickableHover(pointerHitsRoom(event));
            return;
        }

        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;

        if (Math.hypot(dx, dy) > 6) {
            state.moved = true;
        }

        if (!controls) {
            state.targetDragYaw += (event.clientX - state.lastX) * 0.009;
            state.targetDragPitch = clamp(state.targetDragPitch + (event.clientY - state.lastY) * 0.004, -0.38, 0.32);
            state.lastX = event.clientX;
            state.lastY = event.clientY;
        }
    }

    function handlePointerUp(event) {
        if (!state.isPointerDown) return;

        const elapsed = performance.now() - state.startTime;
        const cleanClick = !state.moved && elapsed < 360 && performance.now() - state.lastWheelAt > 420;

        state.isPointerDown = false;
        stage.classList.remove('is-dragging');

        if (cleanClick && pointerHitsRoom(event)) {
            enterArchives();
        } else {
            setClickableHover(pointerHitsRoom(event));
        }
    }

    function handleWheel(event) {
        state.lastWheelAt = performance.now();
        state.pulse = 1;

        if (!controls) {
            state.targetZoom = clamp(state.targetZoom + event.deltaY * 0.003, 1.35, 8.6);
        }
    }

    function handleKeyDown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        enterArchives();
    }

    function handleClick(event) {
        event.preventDefault();
    }

    function animate() {
        requestAnimationFrame(animate);

        const elapsed = clock.getElapsedTime();
        state.pulse *= 0.92;

        if (controls) {
            controls.update();
        } else {
            state.dragYaw += (state.targetDragYaw - state.dragYaw) * 0.12;
            state.dragPitch += (state.targetDragPitch - state.dragPitch) * 0.12;
            state.zoom += (state.targetZoom - state.zoom) * 0.12;
            roomGroup.rotation.y = state.dragYaw + (prefersReducedMotion ? 0 : Math.sin(elapsed * 0.18) * 0.08);
            roomGroup.rotation.x = state.dragPitch;
            camera.position.set(0, 0.18, state.zoom);
            camera.lookAt(0, 0.02, 0);
        }

        animatedMaterials.forEach((material, index) => {
            if (material.emissive) {
                material.emissiveIntensity = 0.72 + Math.sin(elapsed * 1.8 + index * 0.6) * 0.22 + state.pulse * 0.3;
            }
        });

        archiveAffordances.forEach((object, index) => {
            if (object.material) {
                object.material.opacity = state.hoveringClickable ? 1 : 0.9 + (prefersReducedMotion ? 0 : Math.sin(elapsed * 1.6 + index + object.userData.phase) * 0.035);
            }
        });

        redLight.intensity = (isLightTheme() ? 1.35 : 2.25) + Math.sin(elapsed * 1.3) * 0.22 + state.pulse * 0.55;
        cyanLight.intensity = (isLightTheme() ? 0.95 : 1.28) + Math.cos(elapsed * 1.1) * 0.16 + state.pulse * 0.32;
        amberLight.intensity = 0.7 + Math.sin(elapsed * 0.8) * 0.12;

        renderer.render(scene, camera);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                updateTheme();
            }
        });
    });
    themeObserver.observe(document.documentElement, { attributes: true });

    stage.addEventListener('pointerdown', handlePointerDown, { passive: true });
    stage.addEventListener('pointermove', handlePointerMove, { passive: true });
    stage.addEventListener('pointerup', handlePointerUp, { passive: true });
    stage.addEventListener('pointercancel', () => {
        state.isPointerDown = false;
        stage.classList.remove('is-dragging');
        setClickableHover(false);
    }, { passive: true });
    stage.addEventListener('pointerleave', () => setClickableHover(false), { passive: true });
    stage.addEventListener('wheel', handleWheel, { passive: true });
    stage.addEventListener('keydown', handleKeyDown);
    stage.addEventListener('click', handleClick);

    updateTheme();
    resize();
    loadModel();
    animate();
})();
