(function() {
    'use strict';

    const stage = document.getElementById('emblemStage');
    const container = document.getElementById('emblemCanvas');
    const status = document.getElementById('emblemStatus');

    if (!stage || !container || typeof THREE === 'undefined') return;

    const MODEL_SRC = container.getAttribute('data-model-src') || 'assets/Hunter3d/hunter3d.glb';
    const TEXTURE_SRC = container.getAttribute('data-texture-src') || '';
    const MODEL_VIEW_SCALE = 2.3;
    const MODEL_FRONT_YAW = Math.PI / 2;
    const FRONT_FACE_NORMAL_THRESHOLD = 0.88;
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.025, 90);
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    const clock = new THREE.Clock();
    const emblemGroup = new THREE.Group();
    emblemGroup.rotation.y = MODEL_FRONT_YAW;
    scene.add(emblemGroup);

    const skyLight = new THREE.HemisphereLight(0x8cb6e6, 0x020305, 0.15); // Dark blue night sky
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4); // Dim moonlight
    const redLight = new THREE.PointLight(0xff2a2a, 0.8, 12);
    const cyanRim = new THREE.PointLight(0x38c6ff, 0.9, 12);

    keyLight.position.set(-2.4, 3.4, 4.2);
    redLight.position.set(2.6, 0.6, 2.4);
    cyanRim.position.set(-2.4, 0.8, -3.2);
    scene.add(skyLight, keyLight, redLight, cyanRim);

    camera.position.set(0, 0.1, 4.4);
    camera.lookAt(0, 0, 0);

    let controls = null;
    if (typeof THREE.OrbitControls === 'function') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = false;
        controls.minDistance = 2.6;
        controls.maxDistance = 7.5;
        controls.target.set(0, 0, 0);
        controls.autoRotate = false; // changed from !prefersReducedMotion
    }

    const state = {
        dragYaw: 0,
        targetDragYaw: 0,
        dragPitch: 0,
        targetDragPitch: 0,
        zoom: 4.4,
        targetZoom: 4.4,
        isPointerDown: false,
        lastX: 0,
        lastY: 0
    };

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function isLightTheme() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function markLoaded() {
        setStatus('Emblem ready.');
        window.setTimeout(() => stage.classList.add('is-loaded'), prefersReducedMotion ? 80 : 240);
    }

    function prepareTextureMaterial(material) {
        material.side = THREE.DoubleSide;
        material.alphaTest = Math.max(material.alphaTest || 0, 0.04);
        material.transparent = false;
        material.depthWrite = true;
        
        // Only override color and properties if there is a texture map to display
        if (material.map) {
            if (material.color) material.color.setHex(0xffffff);
            material.metalness = 0.4;
            material.roughness = 0.7;
        }
        
        material.needsUpdate = true;

        if (material.map) {
            material.emissiveMap = material.map;
            material.emissive = new THREE.Color(0x222222); // Gives the star a very subtle self-glow in the dark
            material.map.encoding = THREE.sRGBEncoding;
            material.map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
            material.map.needsUpdate = true;
        }
    }

    function createEdgeMaterial(sourceMaterial) {
        return new THREE.MeshStandardMaterial({
            name: `${sourceMaterial.name || 'emblem'} edge`,
            color: 0x3a4247, // Darker base color
            metalness: 0.6, // Increase metalness
            roughness: 0.75, // Increase roughness to diffuse sharp speculars
            side: THREE.DoubleSide
        });
    }

    function buildGeometryWithIndex(sourceGeometry, indices) {
        const geometry = sourceGeometry.clone();
        const IndexArray = sourceGeometry.attributes.position.count > 65535 ? Uint32Array : Uint16Array;

        geometry.clearGroups();
        geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        return geometry;
    }

    function projectLogoTextureUvs(geometry) {
        const position = geometry.attributes.position;
        const bounds = new THREE.Box3().setFromBufferAttribute(position);
        const width = Math.max(bounds.max.z - bounds.min.z, 0.0001);
        const height = Math.max(bounds.max.y - bounds.min.y, 0.0001);
        const uvs = new Float32Array(position.count * 2);

        for (let i = 0; i < position.count; i += 1) {
            uvs[i * 2] = (position.getZ(i) - bounds.min.z) / width;
            uvs[i * 2 + 1] = 1 - ((position.getY(i) - bounds.min.y) / height);
        }

        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }

    function splitTexturedLogoMesh(mesh, sourceMaterial, logoTexture) {
        const geometry = mesh.geometry;
        const index = geometry && geometry.getIndex && geometry.getIndex();
        const position = geometry && geometry.attributes && geometry.attributes.position;

        if (!index || !position || !logoTexture) return null;

        const faceIndices = [];
        const edgeIndices = [];
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const ac = new THREE.Vector3();
        const normal = new THREE.Vector3();

        for (let i = 0; i < index.count; i += 3) {
            const ia = index.getX(i);
            const ib = index.getX(i + 1);
            const ic = index.getX(i + 2);

            a.fromBufferAttribute(position, ia);
            b.fromBufferAttribute(position, ib);
            c.fromBufferAttribute(position, ic);
            ab.subVectors(b, a);
            ac.subVectors(c, a);
            normal.crossVectors(ab, ac).normalize();

            const target = Math.abs(normal.x) >= FRONT_FACE_NORMAL_THRESHOLD ? faceIndices : edgeIndices;
            target.push(ia, ib, ic);
        }

        if (!faceIndices.length || !edgeIndices.length) return null;

        const faceMaterial = sourceMaterial.clone();
        const edgeMaterial = createEdgeMaterial(sourceMaterial);
        const faceGeometry = buildGeometryWithIndex(geometry, faceIndices);
        const edgeMesh = new THREE.Mesh(buildGeometryWithIndex(geometry, edgeIndices), edgeMaterial);
        const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
        const group = new THREE.Group();

        if (logoTexture) faceMaterial.map = logoTexture;
        projectLogoTextureUvs(faceGeometry);
        prepareTextureMaterial(faceMaterial);
        group.name = `${mesh.name || 'emblem'} split`;
        group.position.copy(mesh.position);
        group.quaternion.copy(mesh.quaternion);
        group.scale.copy(mesh.scale);
        group.visible = mesh.visible;
        group.renderOrder = mesh.renderOrder;

        [edgeMesh, faceMesh].forEach((part) => {
            part.castShadow = mesh.castShadow;
            part.receiveShadow = mesh.receiveShadow;
            part.frustumCulled = mesh.frustumCulled;
        });

        edgeMesh.name = `${mesh.name || 'emblem'} edges`;
        faceMesh.name = `${mesh.name || 'emblem'} textured faces`;
        group.add(edgeMesh, faceMesh);

        return group;
    }

    function centerAndScale(root) {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z, 1);

        root.position.sub(center);

        const holder = new THREE.Group();
        holder.add(root);
        holder.scale.setScalar(MODEL_VIEW_SCALE / maxAxis);

        while (emblemGroup.children.length) {
            emblemGroup.remove(emblemGroup.children[0]);
        }
        emblemGroup.add(holder);
    }

    function prepareLoadedModel(root, logoTexture) {
        const replacements = [];

        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const replacement = materials.length === 1 ? splitTexturedLogoMesh(child, materials[0], logoTexture) : null;

            if (replacement) {
                replacements.push({ child, replacement });
                return;
            }

            materials.forEach(prepareTextureMaterial);
        });

        replacements.forEach(({ child, replacement }) => {
            if (!child.parent) return;
            child.parent.add(replacement);
            child.parent.remove(child);
        });

        centerAndScale(root);
        markLoaded();
    }

    function loadLogoTexture() {
        return new Promise((resolve) => {
            if (!TEXTURE_SRC || typeof THREE.TextureLoader !== 'function') {
                resolve(null);
                return;
            }

            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                TEXTURE_SRC,
                (texture) => {
                    texture.flipY = false;
                    texture.wrapS = THREE.ClampToEdgeWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    texture.encoding = THREE.sRGBEncoding;
                    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
                    texture.needsUpdate = true;
                    resolve(texture);
                },
                undefined,
                () => resolve(null)
            );
        });
    }

    function loadModel() {
        if (typeof THREE.GLTFLoader !== 'function') {
            setStatus('3D loader unavailable.');
            return;
        }

        const loader = new THREE.GLTFLoader();
        const texturePromise = loadLogoTexture();

        loader.load(
            MODEL_SRC,
            (gltf) => texturePromise.then((texture) => prepareLoadedModel(gltf.scene, texture)),
            undefined,
            () => setStatus('Emblem failed to load.')
        );
    }

    function updateTheme() {
        const light = isLightTheme();
        skyLight.color.setHex(light ? 0xffffff : 0x8cb6e6);
        skyLight.groundColor.setHex(light ? 0xc4d2cb : 0x020305);
        skyLight.intensity = light ? 1.0 : 0.15;
        keyLight.intensity = light ? 1.8 : 0.4;
        redLight.intensity = light ? 0.7 : 0.8;
        cyanRim.intensity = light ? 0.8 : 0.9;
    }

    function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(Math.floor(rect.width), 1);
        const height = Math.max(Math.floor(rect.height), 1);

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function handlePointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        state.isPointerDown = true;
        state.lastX = event.clientX;
        state.lastY = event.clientY;
        stage.classList.add('is-dragging');
    }

    function handlePointerMove(event) {
        if (controls) return;
        
        if (state.isPointerDown) {
            state.targetDragYaw += (event.clientX - state.lastX) * 0.009;
            state.targetDragPitch = clamp(state.targetDragPitch + (event.clientY - state.lastY) * 0.005, -0.5, 0.5);
        } else {
            const rect = container.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width * 2 - 1;
            const y = -(event.clientY - rect.top) / rect.height * 2 + 1;
            state.targetDragYaw = x * 0.4;
            state.targetDragPitch = clamp(y * 0.2, -0.5, 0.5);
        }
        
        state.lastX = event.clientX;
        state.lastY = event.clientY;
    }

    function endPointer() {
        state.isPointerDown = false;
        stage.classList.remove('is-dragging');
    }

    function handleWheel(event) {
        if (controls) return;
        state.targetZoom = clamp(state.targetZoom + event.deltaY * 0.003, 2.6, 7.5);
    }

    function animate() {
        requestAnimationFrame(animate);

        const elapsed = clock.getElapsedTime();

        if (controls) {
            controls.update();
        } else {
            state.dragYaw += (state.targetDragYaw - state.dragYaw) * 0.12;
            state.dragPitch += (state.targetDragPitch - state.dragPitch) * 0.12;
            state.zoom += (state.targetZoom - state.zoom) * 0.12;
            emblemGroup.rotation.y = MODEL_FRONT_YAW + state.dragYaw; // removed automatic elapsed * 0.35
            emblemGroup.rotation.x = state.dragPitch;
            camera.position.set(0, 0.1, state.zoom);
            camera.lookAt(0, 0, 0);
        }

        const pulse = prefersReducedMotion ? 0 : Math.sin(elapsed * 1.4);
        redLight.intensity = (isLightTheme() ? 0.7 : 0.8) + pulse * 0.18;
        cyanRim.intensity = (isLightTheme() ? 0.8 : 0.9) + Math.cos(elapsed * 1.1) * 0.2;

        renderer.render(scene, camera);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') updateTheme();
        });
    });
    themeObserver.observe(document.documentElement, { attributes: true });

    stage.addEventListener('pointerdown', handlePointerDown, { passive: true });
    stage.addEventListener('pointermove', handlePointerMove, { passive: true });
    stage.addEventListener('pointerup', endPointer, { passive: true });
    stage.addEventListener('pointercancel', endPointer, { passive: true });
    stage.addEventListener('pointerleave', endPointer, { passive: true });
    stage.addEventListener('wheel', handleWheel, { passive: true });

    updateTheme();
    resize();
    loadModel();
    animate();
})();
