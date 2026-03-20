/**
 * ============================================================================
 * THREE.JS CHESS SCENE
 * ============================================================================
 * Creates a procedural 3D chess piece with particles and scroll animation.
 * Pure JavaScript - no React/frameworks required.
 * ============================================================================
 */

(function() {
    'use strict';

    // ========================================================================
    // SCENE SETUP
    // ========================================================================

    const container = document.getElementById('canvas-container');
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 1, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // ========================================================================
    // MATERIALS
    // ========================================================================

    function getMaterial(isDark) {
        return new THREE.MeshStandardMaterial({
            color: isDark ? 0x1a1a1d : 0xd4cfc2,
            metalness: isDark ? 0.9 : 0.1,
            roughness: isDark ? 0.1 : 0.7,
            envMapIntensity: isDark ? 1.5 : 0.8,
            transparent: true,
            opacity: 1
        });
    }

    // ========================================================================
    // CHESS PIECE (KING)
    // ========================================================================

    const chessGroup = new THREE.Group();
    const shardGroup = new THREE.Group();

    // Chess piece parts
    const parts = [];

    function createChessPiece(material) {
        // Clear existing parts
        parts.forEach(part => chessGroup.remove(part));
        parts.length = 0;

        // Base
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.6, 0.7, 0.2, 32),
            material.clone()
        );
        base.position.y = 0;
        base.castShadow = true;
        chessGroup.add(base);
        parts.push(base);

        // Body
        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.55, 1, 32),
            material.clone()
        );
        body.position.y = 0.6;
        body.castShadow = true;
        chessGroup.add(body);
        parts.push(body);

        // Collar
        const collar = new THREE.Mesh(
            new THREE.TorusGeometry(0.4, 0.08, 16, 32),
            material.clone()
        );
        collar.position.y = 1.15;
        collar.rotation.x = Math.PI / 2;
        collar.castShadow = true;
        chessGroup.add(collar);
        parts.push(collar);

        // Upper body
        const upperBody = new THREE.Mesh(
            new THREE.CylinderGeometry(0.25, 0.35, 0.5, 32),
            material.clone()
        );
        upperBody.position.y = 1.5;
        upperBody.castShadow = true;
        chessGroup.add(upperBody);
        parts.push(upperBody);

        // Crown base
        const crownBase = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.25, 0.2, 32),
            material.clone()
        );
        crownBase.position.y = 1.9;
        crownBase.castShadow = true;
        chessGroup.add(crownBase);
        parts.push(crownBase);

        // Cross vertical
        const crossV = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.5, 0.08),
            material.clone()
        );
        crossV.position.y = 2.25;
        crossV.castShadow = true;
        chessGroup.add(crossV);
        parts.push(crossV);

        // Cross horizontal
        const crossH = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.08, 0.08),
            material.clone()
        );
        crossH.position.y = 2.35;
        crossH.castShadow = true;
        chessGroup.add(crossH);
        parts.push(crossH);
    }

    // ========================================================================
    // SHARDS (for disassembly effect)
    // ========================================================================

    const shards = [];
    const shardCount = 24;

    function createShards(material) {
        // Clear existing shards
        shards.forEach(shard => shardGroup.remove(shard.mesh));
        shards.length = 0;

        for (let i = 0; i < shardCount; i++) {
            const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.5;
            const radius = 2 + Math.random() * 3;
            const height = (Math.random() - 0.5) * 4;

            const shardMaterial = material.clone();
            shardMaterial.opacity = 0;

            const shard = new THREE.Mesh(
                new THREE.TetrahedronGeometry(0.1 + Math.random() * 0.2, 0),
                shardMaterial
            );
            shard.position.set(0, 1, 0);
            shard.castShadow = true;

            shards.push({
                mesh: shard,
                startPos: new THREE.Vector3(0, 1, 0),
                endPos: new THREE.Vector3(
                    Math.cos(angle) * radius,
                    1 + height,
                    Math.sin(angle) * radius
                ),
                rotation: new THREE.Euler(
                    Math.random() * Math.PI,
                    Math.random() * Math.PI,
                    Math.random() * Math.PI
                )
            });

            shardGroup.add(shard);
        }
    }

    // ========================================================================
    // PARTICLES
    // ========================================================================

    const particleCount = 150;
    let particles;
    let particlePositions;

    function createParticles() {
        if (particles) scene.remove(particles);

        const geometry = new THREE.BufferGeometry();
        particlePositions = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const radius = 1.5 + Math.random() * 2;
            const height = (Math.random() - 0.5) * 3;

            particlePositions[i * 3] = Math.cos(angle) * radius;
            particlePositions[i * 3 + 1] = height;
            particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        const material = new THREE.PointsMaterial({
            color: isDark ? 0xc9a227 : 0x8b6914,
            size: 0.03,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        });

        particles = new THREE.Points(geometry, material);
        scene.add(particles);
    }

    // ========================================================================
    // LIGHTING
    // ========================================================================

    function setupLighting() {
        // Clear existing lights
        scene.children
            .filter(child => child instanceof THREE.Light)
            .forEach(light => scene.remove(light));

        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

        // Main spotlight
        const spotLight = new THREE.SpotLight(
            isDark ? 0xffd700 : 0xfff5e6,
            isDark ? 3 : 2
        );
        spotLight.position.set(5, 8, 5);
        spotLight.angle = 0.4;
        spotLight.penumbra = 0.5;
        spotLight.castShadow = true;
        spotLight.shadow.mapSize.width = 2048;
        spotLight.shadow.mapSize.height = 2048;
        spotLight.shadow.bias = -0.0001;
        scene.add(spotLight);

        // Secondary fill light
        const fillLight = new THREE.SpotLight(
            isDark ? 0x4a3808 : 0xd4cfc2,
            isDark ? 0.5 : 0.8
        );
        fillLight.position.set(-5, 5, -5);
        fillLight.angle = 0.6;
        fillLight.penumbra = 0.8;
        scene.add(fillLight);

        // Rim light
        const rimLight = new THREE.PointLight(
            isDark ? 0xc9a227 : 0x8b6914,
            isDark ? 1 : 0.5
        );
        rimLight.position.set(0, 3, -5);
        scene.add(rimLight);

        // Ambient light
        const ambientLight = new THREE.AmbientLight(
            isDark ? 0x1a1a1d : 0xf5f0e8,
            isDark ? 0.1 : 0.3
        );
        scene.add(ambientLight);
    }

    // ========================================================================
    // SCROLL TRACKING
    // ========================================================================

    let scrollProgress = 0;

    function updateScrollProgress() {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        scrollProgress = Math.min(Math.max(scrollTop / docHeight, 0), 1);
    }

    window.addEventListener('scroll', updateScrollProgress, { passive: true });
    updateScrollProgress();

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    let currentMaterial;

    function init() {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        currentMaterial = getMaterial(isDark);

        createChessPiece(currentMaterial);
        createShards(currentMaterial);
        createParticles();
        setupLighting();

        scene.add(chessGroup);
        scene.add(shardGroup);
    }

    init();

    // ========================================================================
    // THEME CHANGE HANDLER
    // ========================================================================

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'data-theme') {
                const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
                currentMaterial = getMaterial(isDark);
                createChessPiece(currentMaterial);
                createShards(currentMaterial);
                createParticles();
                setupLighting();
            }
        });
    });

    observer.observe(document.documentElement, { attributes: true });

    // ========================================================================
    // ANIMATION LOOP
    // ========================================================================

    let time = 0;

    function animate() {
        requestAnimationFrame(animate);
        time += 0.016;

        // Rotate chess piece
        chessGroup.rotation.y = time * 0.1;

        // Floating effect
        const floatY = Math.sin(time * 1.5) * 0.1;
        chessGroup.position.y = floatY;

        // Update parts based on scroll
        parts.forEach((part, i) => {
            part.scale.setScalar(1 - scrollProgress * 0.5);
            if (part.material) {
                part.material.opacity = 1 - scrollProgress;
            }
        });
        chessGroup.visible = scrollProgress < 0.8;

        // Animate shards
        shards.forEach((shard, i) => {
            const progress = scrollProgress;
            shard.mesh.position.lerpVectors(shard.startPos, shard.endPos, progress);
            shard.mesh.rotation.x = shard.rotation.x * progress;
            shard.mesh.rotation.y = shard.rotation.y * progress;
            shard.mesh.rotation.z = shard.rotation.z * progress;
            if (shard.mesh.material) {
                shard.mesh.material.opacity = progress;
            }
        });

        // Animate particles
        if (particles && particlePositions) {
            for (let i = 0; i < particleCount; i++) {
                const angle = time * 0.1 + (i / particleCount) * Math.PI * 2;
                const baseRadius = 1.5 + (i % 5) * 0.3;

                particlePositions[i * 3] = Math.cos(angle + i * 0.1) * baseRadius;
                particlePositions[i * 3 + 2] = Math.sin(angle + i * 0.1) * baseRadius;
                particlePositions[i * 3 + 1] += Math.sin(time + i) * 0.001;
            }
            particles.geometry.attributes.position.needsUpdate = true;
            particles.rotation.y = time * 0.05;
        }

        renderer.render(scene, camera);
    }

    animate();

    // ========================================================================
    // RESIZE HANDLER
    // ========================================================================

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

})();
