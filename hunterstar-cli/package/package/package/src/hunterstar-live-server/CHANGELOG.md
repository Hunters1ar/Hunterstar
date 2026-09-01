# Change Log

All notable changes to the "hunters-live-server" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0] - 2026-05-23

First stable release. Bundles the recent reliability work — relay crash guards from 0.0.18 and the live-reload WebSocket fix from 0.0.19 — under a single stable version line. No functional changes since 0.0.19.

## [0.0.19] - 2026-05-23

### Fixed

- **Live-reload WebSocket no longer hits `wss://<host>/`.** The relay rewrote `location.pathname` to `__huntersTunnelPathname()` inside every inline script, which collapses to `"/"` for an index page. Applied to the extension's own live-reload script, this produced `new WebSocket("wss://hunterstaronline.online/")` — a bare-root URL nginx can't route to any session. The relay now leaves `<script data-hunters-live-reload>`, `<script data-hunters-backend-shim>`, and `<script data-hunters-tunnel>` alone so the extension's own shims keep working.

## [0.0.18] - 2026-05-21

### Fixed

- **Share links no longer break on every page load** — when the VPS relay hit an error while rewriting an HTML, CSS, or JavaScript response (e.g. `ReferenceError: quote is not defined`), the entire share session was torn down. The old `/s/<id>/` URL went permanently `502` and the extension reconnected under a brand-new URL. Each rewrite pass is now individually guarded, so a failure falls back to the original response and keeps the session alive.

## [0.0.17] - 2026-05-21

### Fixed

- **Share tunnel stability** — removed an aggressive client keepalive that could drop healthy VPS tunnels and cause `502`/disconnected share links.
- **Auto-reconnect** — when the tunnel drops while the local live server is still running, Hunters automatically reconnects and issues a fresh share URL.

## [0.0.16] - 2026-05-21

### Added

- **Zero-config API/WebSocket rewriting** — Hunters automatically injects a runtime shim into every served HTML page and rewrites `.js` files so `fetch('http://localhost:5000/...')`, `new WebSocket('wss://hunterstaronline.online/')`, and similar patterns work without editing project code.
- **Relay parity** — VPS tunnel responses rewrite localhost backend URLs and hardcoded public WebSocket roots the same way.

## [0.0.15] - 2026-05-21

### Added

- **VPS relay: tunneled app WebSockets** — non-HTML WebSocket upgrades (e.g. `/`, `/api`) are forwarded through the extension tunnel to your local backend instead of being treated as live-reload only.
- **Relay URL rewriting** for `new WebSocket('wss://…')` and a runtime `WebSocket` wrapper so hardcoded public URLs stay inside `/s/<session>/`.

### Fixed

- **TypeScript build** for WebSocket frame handling when relay tunnel sends binary payloads.

## [0.0.14] - 2026-05-21

### Added

- **Auto backend detection** on Open Live Server, Open Global, and Open Local. Scans common ports and reads `server.js` / `package.json` for port hints.
- **Backend watcher** attaches the proxy when `node server.js` (or similar) starts after the live server.
- **WebSocket proxy** for `/api` routes and root `/` when a backend project is detected.

## [0.0.12] - 2026-05-11

### Fixed

- **Global Server: Exact root navigations return to the shared index.** Links and redirects to `/` now resolve to `/s/<session>/index.html` from folder and route pages instead of escaping to the public domain root or landing on a 404-prone session directory.

## [0.0.11] - 2026-05-11

### Fixed

- **Production relay: Default connection uses the HTTPS domain.** New installs now connect to `wss://hunterstaronline.online/tunnel` instead of the raw VPS IP.

## [0.0.10] - 2026-05-11

### Fixed

- **Global Server: Root-index redirect apps stay inside share links.** Pages opened at `/s/<session>/index.html` now report `/` to app code that reads `window.location.pathname`, so root-normalizing scripts like EduVenture's no longer escape to the public site root.
- **Global Server: More client-side root navigations are rewritten.** The relay now catches additional `document.location`, `location.pathname`, template-literal, and `window.open("/")` forms before the browser can leave `/s/<session>/`.
- **Global Server: Escaped document navigations can recover.** If a browser still reaches a root path with an active share-link Referer, the relay redirects it back under `/s/<session>/` instead of leaving it at the public domain root.
- **Global Server: Navigation guards no longer stop early.** The injected guard now survives browsers that reject monkey-patching `location.replace()` and `location.assign()`.
- **Editor forks: Open commands are less fragile.** If a VS Code-compatible editor fires the open command while Hunters is idle, the extension now starts the server instead of only showing `not running`.

## [0.0.9] - 2026-05-11

### Fixed

- **Global Server: Nested shared files now keep their real path.** Share URLs now include the selected HTML file path, so pages like `shop/index.html` correctly resolve `script.js`, `./script.js`, `../script.js`, and nested relative assets.
- **Global Server: Root-slash assets are more resilient.** The relay rewrites quoted and unquoted root-relative attributes such as `/script.js` and `/assets/app.js`.
- **Global Server: Lost root assets can recover from the Referer header.** If a browser still requests `/style.css` without `/s/<session>/`, the relay can infer the active session from the page that requested it.

## [0.0.8] - 2026-05-11

### Fixed

- **Global Server: Route handling is fully dynamic across folders.** Verified tunnel base generation for root pages, slashless folder routes, deep nested folders, and file routes.
- **Global Server: More linked asset attributes stay inside the tunnel.** The relay now rewrites `data-*` URL attributes, `imagesrcset`, and additional manifest/link-style root paths.
- **Global Server: Inline event navigations stay inside share links.** Handlers like `onclick="location.href='/lessons'"` are rewritten before Chromium can escape the `/s/<session>/` route.

## [0.0.7] - 2026-05-11

### Fixed

- **Global Server: Nested pages now load page-local assets correctly.** The relay injects a route-aware `<base href="...">`, so pages like `/shop/` resolve `shop.css`, `shop.page.js`, and `../shared/...` through the active share URL instead of the session root.
- **Global Server: Linked CSS and JavaScript are rewritten through the tunnel.** Absolute root paths inside CSS `url()` / `@import` and common JavaScript imports or redirects are prefixed with `/s/<session>/`.
- **Global Server: Existing app `<base>` tags no longer break shared pages.** The relay replaces app-local base tags with the tunnel base for the requested route.

## [0.0.6] - 2026-05-11

### Fixed

- **Global Server: Root-route redirect apps stay inside share links.** The relay now rewrites inline scripts that inspect `window.location.pathname` or call `location.replace("/")`, fixing apps like Eduventure that redirected `/s/<session>/` back to `/` and then escaped to the main domain.
- **Global Server: Browser navigation guards are more reliable.** The relay no longer depends only on overriding native `location.assign()` / `location.replace()`, which Chromium keeps non-replaceable.

## [0.0.5] - 2026-05-11

### Fixed

- **Global Server: CSS, JS, and assets now load correctly.** The relay server automatically rewrites absolute paths in HTML responses to route through the tunnel prefix. Zero user effort required.
- **Global Server: SPA redirects no longer break the tunnel.** Injected routing-fix script intercepts `location.replace()`, `location.assign()`, `fetch()`, `XHR`, History API, and link clicks.
- **Global Server: Server-side redirects (301/302) stay inside the tunnel.**
- **Global Server: Relative URLs resolved correctly** via auto-injected `<base>` tag.

## [0.0.4] - 2026-05-11

### Fixed

- **Global Server: CSS, JS, and assets now load correctly.** The relay server automatically rewrites absolute paths (`/style.css`, `/assets/app.js`, etc.) in HTML responses to route through the tunnel prefix. Users do not need to modify their HTML files — the relay handles everything transparently.
- **Global Server: Client-side SPA redirects no longer break the tunnel.** A routing-fix script is injected automatically into HTML responses that intercepts `location.replace()`, `location.assign()`, `history.pushState/replaceState`, `fetch()`, `XMLHttpRequest`, and `<a>` link clicks — keeping all navigation within the tunnel URL.
- **Global Server: Server-side redirects (301/302) now stay inside the tunnel.** `Location` headers with absolute paths are rewritten to include the session prefix.
- **Global Server: Relative URLs (`style.css`, `./img/logo.png`) resolved correctly** via an injected `<base>` tag that points to the tunnel prefix.

### How It Works (Technical)

The relay server (`server.js`) now performs transparent HTML rewriting on every HTML response before sending it to the viewer's browser:

1. **`<base>` tag injection** — inserted after `<head>` so relative URLs resolve through the tunnel.
2. **Absolute URL rewriting** — regex rewrites `src="/..."`, `href="/..."`, `action="/..."`, `srcset`, and `url()` in inline CSS.
3. **Routing-fix script** — a small injected `<script>` that monkey-patches browser APIs to keep navigation within the tunnel.
4. **Location header rewriting** — server-side 301/302 redirect headers are prefixed with the tunnel path.

No changes are needed to user HTML files. The extension and relay handle it all in the background.

## [0.0.3] - 2026-05-10

- Add `.env` loading for the VPS relay so production configuration lives on the server.
- Document the production relay setup with an empty `RELAY_TOKEN` for install-and-use extension users.
- Improve 401 relay failures with guidance to fix the VPS `.env` instead of asking users for a token.

## [0.0.1] - 2026-05-10

- Initial release
