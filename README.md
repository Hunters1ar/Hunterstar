# 🎭 Poetic Retro Portfolio - Static Version

A stunning, completely static portfolio website featuring a 3D chess piece hero, dark academia aesthetic, and a contact form backed by your own PostgreSQL API.

![Portfolio Preview](preview.png)

---

## ✨ Features

### 🎨 Design
- **Dark Academia Aesthetic** - Deep charcoals, faded gold accents, vintage paper textures
- **Light/Dark Mode** - Smooth theme toggle with localStorage persistence
- **Responsive** - Works perfectly on all devices
- **Vintage Effects** - Grain texture overlay + vignette

### 🎮 3D Hero Element
- **Procedural Chess King** - Built with Three.js, no external models needed
- **Dynamic Materials** - Obsidian (dark mode) / Ivory (light mode)
- **Orbiting Particles** - 150 glowing data nodes
- **Scroll Animation** - Chess piece disassembles as you scroll

### Self-hosted data
- **Contact Form** - Messages stored in PostgreSQL on your VPS
- **File Storage** - Attachments stored in `/opt/portfolio-api/bucket`
- **Authentication** - Local password verification and authenticator codes

---

## 📁 File Structure

```
portfolio-static/
├── index.html              # Main HTML file
├── css/
│   └── styles.css          # All styles (pure CSS)
├── js/
│   ├── main.js             # Theme toggle, animations, form handler
│   ├── three-scene.js      # Three.js 3D chess piece
│   └── portfolio-api.js   # VPS API client
├── assets/                 # Images, fonts (optional)
└── README.md
```

---

## 🚀 Quick Start

### 1. Download & Extract

Download the project files and extract them to your desired location.

### 2. Open Locally

Simply open `index.html` in your browser:
- Double-click the file, or
- Use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

### 3. Configure the API

See [the self-hosted data guide](api/SELF_HOSTED.md) for PostgreSQL, file storage,
deployment, backups, and migration details. The static pages use
`https://api.hunterstar.uz`.

---
**Made with ❤️ and a passion for elegant code**

## Portfolio companion

The home page includes a canvas companion built from the original animations in
`frames/`. Double-tap the character to open a message dialog; Enter or Space also
opens it when the companion has keyboard focus. Replies appear in an anchored
speech bubble, with previous/next reply buttons and Ask again. It follows
the pet and hides automatically 20 seconds after a reply finishes. Viewing another
reply restarts that timer; opening the message dialog clears it. The bubble stays
within the viewport when the pet is dragged. Dismissing a pending reply
cancels the request and upstream generation. Tokens appear as they arrive from
the dedicated pet API. The pet thinks while a reply is streaming and stops
wandering while the dialog or reply is open.

Right-click or hold the character for Talk, Jump, Sit, Pause, and Hide controls;
drag and release to throw it. Shift + F10 opens controls from the keyboard.
Hidden and paused preferences persist in local storage.

The pet uses a dedicated Hermes 3 instance on Hunterella's port 8090 through
`https://image.hunterstar.uz/api/pet/chat`, including in local previews.
Casual replies are capped at 60 tokens. Port 8080 retains the CLI's Q4_K_M model.
Deployment, limits, and API checks are
documented in [api/pet/README.md](api/pet/README.md).

Idle, thinking, and sitting hold each frame for 1.0, 1.1, and 1.2 seconds.
Throws average recent drag motion and use air resistance, ground friction, and
soft boundary rebounds. Hard landings have one small bounce; jump, landing, and
dizzy animations play once. Walking accelerates and slows near the edges.
Physics uses fixed steps so movement stays consistent across display refresh rates.

The companion welcomes visitors once per page, playfully complains about being
dragged, reacts to fast throws and hard landings, and remarks on the section being
explored after scrolling settles. Quiet idle comments occur at most every 60–90
seconds. These short lines are local personality text, so they add no AI requests.
Ordinary remarks have a 35-second cooldown; drag reactions have a separate
cooldown and one complaint per gesture. Comments follow the pet and disappear
after 8–10 seconds without stopping its movement or changing keyboard focus.
Opening a conversation takes priority, and comments never enter chat history.
Hiding the pet, opening its controls, typing, and backgrounding the tab suppress
automatic chatter. The welcome and manual drag reactions also work when animation
is paused; autonomous remarks wait until animation is enabled.

The companion discovers headings, buttons and links, technology labels, terminal
parts, forms, media shells, footer edges, and cards from the DOM. Custom surfaces
can also expose their top borders with `data-pet-platform`. Headings use their
visible first line of text rather than the full-width heading container.
An element becomes solid only when the pet chooses it as a destination. The pet
can stay on that chosen perch and follow its hover transforms. Other elements
remain ordinary page content rather than universal collision barriers.
Scrolling, dragging, site clicks, and typing cancel the old destination and
release its support immediately, preserving the pet's viewport position and
momentum. Manual throws fall freely through DOM elements to the viewport floor.
After input settles for 1.4 seconds, the pet scans fresh bounds and can choose
another platform. Fast scrolling cannot drag it away on an old card or heading.
All animation outlines stay within the viewport; transparent canvas padding can
extend beyond its edges. A missed or unsafe autonomous landing falls to the floor.
The companion plans reachable hops using gravity and air resistance, preserves
horizontal momentum, reserves room to brake, and favors places it has not visited
recently. Hovering or focusing a site element draws its attention; nearby cursor
movement can make it step away or jump to another reachable ledge. It never
activates a site control itself. Pause and tab suspension freeze an airborne
trajectory; Sit requested in midair takes effect after a natural landing.

Text glyphs and controls are protected zones. Resting intervals account for the
opaque sprite body in both facing directions and across the current resting poses.
Thinking uses its taller outline; sitting can fit a smaller gap. Visible text,
including decorative labels, and full control
and media rectangles are protected. New content sends the pet toward a clear edge
or another reachable perch. When every gap is occupied, the pet sits fully on
screen in the least obstructed spot, giving text and controls priority over media.
Only the visible character bounds accept pointer input, so transparent sprite
padding cannot intercept site clicks. Dragging
and airborne movement may briefly cross content. The displayed size is unchanged.

`scripts/pet-contacts.json` records measured contact points in the packed 384×448
tiles. The packer adds normalized per-frame foot anchors and opaque body bounds
to the manifest. Each pose is translated around a shared physical contact point,
so transparent padding and landing effects cannot determine the standing height.
A small contact shadow fades as the pet rises. Candidate geometry refreshes each
animation frame. Text protection and DOM discovery refresh on page changes,
scroll, resize, and at most every 300 ms while stationary.

To rebuild its assets after changing frames:

```bash
python -m pip install Pillow
npm run pack:pet
npm run test:pet
```

The packer writes content-hashed WebP atlases and a manifest to `assets/pet/`.
Commit these generated assets with the controller; no Python dependency is needed
in production. Raw `frames/` and build scripts are excluded from Vercel uploads.
The runtime uses the generated images listed in `assets/pet/manifest.json`.

Character scale is calibrated by head width, not the changing body outline of
each pose. `scripts/pet-heads.json` stores those measurements in source pixels;
update them when adding or replacing frames. All frames share a ground baseline.
The packer rejects poses that would clip instead of silently shrinking them.
The desktop canvas is 228 × 266 CSS pixels (168 × 196 on mobile), with a
384 × 448 backing canvas for crisp rendering.

Loading starts after the page load. The static pose is about 20 KB; boot plus idle
is about 61 KB, and the current nine-state library totals about 547 KB. Other states load on
demand, one request at a time, with at most three decoded atlases retained.
Data Saver, 2G, and reduced-motion visitors get the static pose until they choose
Animate. Animation stops while the tab or companion is hidden. Failed requests
leave the portfolio usable and keep the static pose, or offer a retry if the boot
image could not load. The existing service worker caches requested atlases only.
