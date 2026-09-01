/**
 * ============================================================================
 * HUNTERSTAR SERVICE WORKER
 * ============================================================================
 * Speeds up the portfolio by precaching the app shell, proactively downloading
 * the heavy 3D models, and serving static assets from cache.
 *
 * Strategies:
 *   - Navigations / HTML .......... network-first  (fresh content, offline fallback)
 *   - CSS / JS .................... stale-while-revalidate (instant + self-updating)
 *   - Models / textures / images /
 *     fonts / .bin / .glb / .gltf . cache-first    (download once, instant forever)
 *
 * Anything dynamic (Firebase, Cloud Functions, the playlist API, the game
 * iframe, analytics) is cross-origin and NOT in the cacheable allowlist, so it
 * passes straight through to the network and is never cached.
 *
 * Bump CACHE_VERSION to invalidate old caches on the next deploy.
 * ============================================================================
 */

'use strict';

const CACHE_VERSION = 'v1.0.3';
const CORE_CACHE = `hs-core-${CACHE_VERSION}`;
const ASSET_CACHE = `hs-assets-${CACHE_VERSION}`;

// Skip caching anything bigger than this (protects the cache quota from stray
// huge files, e.g. the unused 30 MB gif). All real model textures are < 3 MB.
const MAX_CACHEABLE_BYTES = 20 * 1024 * 1024;

// App shell — must all exist; cached atomically on install for instant repeat
// loads and basic offline support.
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/css/chat-widget.css',
    '/js/main.js',
    '/js/chat-widget.js',
    '/js/three-scene.js',
    '/js/server-room-scene.js',
    '/js/emblem-scene.js',
    '/js/firebase-config.js',
    '/assets/logo.png',
    '/site.webmanifest',
    '/favicon.svg'
];

// Self-contained model binaries + standalone model textures to pre-download.
const MODEL_BINARIES = [
    '/assets/Hunter3d/base.glb',
    '/assets/server/textures/open-texture.png'
];

// glTF models whose external buffers (.bin) and images (textures) are
// discovered and pre-downloaded at runtime, so we never hardcode 50+ paths.
const MODEL_GLTFS = [
    '/assets/gaming_desktop_pc%20for%20model/scene.gltf',
    '/assets/server/scene.fast.gltf'
];

// Cross-origin hosts that are safe to cache (libraries, fonts, image CDNs).
const CACHEABLE_ORIGINS = [
    'https://cdnjs.cloudflare.com',
    'https://cdn.jsdelivr.net',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://unpkg.com',
    'https://cdn.tailwindcss.com',
    'https://ik.imagekit.io'
];

// ---------------------------------------------------------------------------
// Install: precache the shell, then take over as soon as possible.
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CORE_CACHE);
        await cache.addAll(CORE_ASSETS);
        await self.skipWaiting();
    })());
});

// ---------------------------------------------------------------------------
// Activate: drop old caches, claim clients, then download the models in the
// background so the next paint/visit is instant.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(
            names
                .filter((name) => name !== CORE_CACHE && name !== ASSET_CACHE)
                .map((name) => caches.delete(name))
        );
        await self.clients.claim();
        await prefetchModels();
    })());
});

// Allow the page to trigger a model prefetch on demand (e.g. after first paint).
self.addEventListener('message', (event) => {
    if (event.data === 'prefetch-models') {
        event.waitUntil(prefetchModels());
    }
});

// ---------------------------------------------------------------------------
// Fetch routing.
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') return; // never cache writes (forms, APIs)

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;
    const cdnCacheable = CACHEABLE_ORIGINS.includes(url.origin);

    // Let the browser handle everything we don't explicitly own: Firebase,
    // Cloud Functions, the playlist API, the game iframe, analytics, etc.
    if (!sameOrigin && !cdnCacheable) return;

    // HTML / navigations -> network-first so content stays fresh.
    if (request.mode === 'navigate' || (sameOrigin && request.destination === 'document')) {
        event.respondWith(networkFirst(request));
        return;
    }

    // CSS / JS -> stale-while-revalidate: instant from cache, refreshed in bg.
    if (request.destination === 'style' || request.destination === 'script') {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // Everything else static (models, textures, images, fonts, .bin) -> cache-first.
    event.respondWith(cacheFirst(request));
});

// ---------------------------------------------------------------------------
// Strategies.
// ---------------------------------------------------------------------------
async function networkFirst(request) {
    const cache = await caches.open(CORE_CACHE);
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = (await cache.match(request)) || (await caches.match(request));
        if (cached) return cached;

        const shell = (await caches.match('/index.html')) || (await caches.match('/'));
        if (shell) return shell;

        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);

    const network = fetch(request)
        .then((response) => {
            if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
}

async function cacheFirst(request) {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        await putIfCacheable(cache, request, response);
        return response;
    } catch (error) {
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
async function putIfCacheable(cache, request, response) {
    if (!response) return;

    // Opaque CDN responses can't be size-checked; allow them (libs are small).
    if (response.type === 'opaque') {
        await cache.put(request, response.clone());
        return;
    }

    if (!response.ok) return;

    const length = Number(response.headers.get('content-length') || 0);
    if (length && length > MAX_CACHEABLE_BYTES) return;

    await cache.put(request, response.clone());
}

async function bestEffortCache(cache, urls) {
    await Promise.allSettled(urls.map(async (rawUrl) => {
        try {
            const url = typeof rawUrl === 'string' ? rawUrl : rawUrl.href;
            if (await cache.match(url)) return; // already cached
            const response = await fetch(url, { credentials: 'same-origin' });
            await putIfCacheable(cache, new Request(url), response);
        } catch (error) {
            /* best effort — ignore individual failures */
        }
    }));
}

// Download a glTF plus its referenced buffers (.bin) and images (textures).
async function prefetchGltfWithDeps(cache, gltfUrl) {
    try {
        if (!(await cache.match(gltfUrl))) {
            const head = await fetch(gltfUrl);
            await putIfCacheable(cache, new Request(gltfUrl), head.clone());
        }

        const response = await fetch(gltfUrl);
        if (!response.ok) return;

        const gltf = await response.json();
        const base = new URL(gltfUrl, self.location.origin);
        const deps = [];

        (gltf.buffers || []).forEach((buffer) => {
            if (buffer.uri && !buffer.uri.startsWith('data:')) deps.push(buffer.uri);
        });
        (gltf.images || []).forEach((image) => {
            if (image.uri && !image.uri.startsWith('data:')) deps.push(image.uri);
        });

        const urls = deps.map((uri) => new URL(uri, base).href);
        await bestEffortCache(cache, urls);
    } catch (error) {
        /* model prefetch is best effort */
    }
}

// Proactively download every model so they load instantly when needed.
async function prefetchModels() {
    const cache = await caches.open(ASSET_CACHE);
    await bestEffortCache(cache, MODEL_BINARIES);
    for (const gltfUrl of MODEL_GLTFS) {
        await prefetchGltfWithDeps(cache, gltfUrl);
    }
}
