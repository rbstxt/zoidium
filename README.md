# Zoidium

> A modified version of **Panzoid Clipmaker Gen3**.

Zoidium bundles the full Panzoid Clipmaker Gen3 and runs entirely locally with **no network calls, no telemetry, and no ads**. Available as a browser app, an Electron desktop app, or a static deploy on Cloudflare Pages or any static host.

---

## Features

- 🎬 **Full Clipmaker Gen3** — Three.js r91 renderer, 43 effects, 39 shaders, 4 materials, particle system
- 🌐 **100% offline** — no API calls, no ads, no telemetry; all assets bundled
- 🪟 **Three run modes** — browser, Electron desktop app, or static web deploy
- 💾 **Project save/load** — `.pz` files work in both Zoidium and the original Panzoid
- 🔒 **Privacy-first** — no accounts, no analytics, no remote requests
- 📦 **Cross-platform builds** — macOS (`.dmg`), Windows (`.exe`), Linux (`.AppImage`)

---

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- macOS / Windows / Linux

### 1. Install

```bash
git clone https://github.com/zoidnerd/zoidium.git
cd zoidium
npm install
```

### 2. Run in your browser

```bash
npm run web
# → http://localhost:8123
```

Or auto-open the browser:

```bash
npm run dev
```

> ⚠️ **Do not open `index.html` directly via `file://`.** Web Workers and WASM modules require a proper HTTP origin.

### 3. Run as an Electron app

```bash
npm start
# → native window with built-in HTTP server
```

### 4. Build a distributable

```bash
npm run dist
```

This produces installable bundles in `dist/`:

- `dist/mac/` — macOS `.dmg` (arm64 / x64)
- `dist/win/` — Windows `.exe` (NSIS installer)
- `dist/linux/` — Linux `.AppImage`

---

## Project Structure

```
zoidium/
├── index.html              # Entry point
├── pz.all-35.css           # Main stylesheet (mirrors Panzoid's pz.all-35.css)
├── main.js                 # Electron main process
├── package.json            # npm manifest + electron-builder config
├── js/                     # Core engine & UI scripts (Panzoid minified bundles)
│   ├── core-1.0.102.js
│   ├── ui-1.0.72.js
│   ├── clipmaker-3.0.106.js
│   └── three.r91.min.js
├── effect/                 # 43 post-processing effects (vanilla JS)
├── material/               # 4 material types
├── worker/                 # WASM workers (tar, av/FFmpeg)
├── fonts/                  # Open Sans & Source Code Pro (woff2)
│   ├── fonts.css
│   ├── open-sans-regular.woff2
│   └── source-code-pro-regular.woff2
├── assets/
│   ├── fonts/2d/           # 28 bundled TTF fonts
│   ├── images/             # Icons & favicon
│   ├── shaders/            # 39 GLSL shaders
│   └── textures/particles/ # 36 particle textures
├── README.md               # English
└── README.ja.md            # 日本語
```

---

## Static Deployment (Cloudflare Pages, Vercel, Netlify, …)

Zoidium is a static site with no build step. To deploy:

1. Push the repo to your Git provider.
2. In your static host, set:
   - **Build command:** *(empty)*
   - **Build output directory:** `/` (project root)
3. Deploy.

`node_modules/` and `dist/` are excluded via `.gitignore` and `.cfignore` so deploys stay lean.

### URL structure

All assets are served from the project root, matching the original Panzoid layout:

```
/                          → index.html
/pz.all-35.css             → main stylesheet
/fonts/fonts.css           → local font face definitions
/fonts/open-sans-regular.woff2
/fonts/source-code-pro-regular.woff2
/js/core-1.0.102.js
/js/ui-1.0.72.js
/js/clipmaker-3.0.106.js
/js/three.r91.min.js
/effect/...
/material/...
/worker/...
/assets/...
```

This means you can drop the exact same `<link>` and `<script>` tags into any HTML page (e.g. a minimal "Graph editor" styleguide) and the assets resolve identically across Zoidium, AfterClip, and other Panzoid-mirror projects.

---

## Development

### Editing effects / materials

Effects in `effect/*.js` and materials in `material/*.js` are vanilla JS modules loaded by the Panzoid runtime. They export a `PZ.effect()` / `PZ.material()` factory — see the existing files for the shape of the API.

To add a new effect:

1. Create `effect/myneweffect.js` mirroring the shape of an existing one (e.g. `brightnesscontrast.js`).
2. The Panzoid runtime auto-discovers files in `effect/` and `material/`.

### Inspecting the legacy Panzoid code

The bundled `js/*.js` files are minified. Reverse-engineering notes and format specs live in a separate repository.

---

## Roadmap

Long-term strategy: port the legacy minified bundles to TypeScript + React + Vite while keeping wire-format compatibility with `.pz` files.

---

## License

This is a derivative work of the Panzoid legacy editor. All original credits belong to Panzoid. Zoidium adds only the offline-mode shims (no telemetry, no ads, no remote API calls) and packaging.

---

## See also

- [日本語版 README](./README.ja.md) — Japanese version
