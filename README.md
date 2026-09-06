# Zoidium

> An open-source collection of tools for extending the CM3 experience.

Zoidium is an external extension layer for Clipmaker Gen3 (CM3). It provides
plugins, local-first adapters, creator tools, and packaging for browser and
desktop use.

The Zoidium source code, plugins, documentation, and build tools are licensed
under the [MIT License](./LICENSE). The bundled Source Code Pro font has its
own [SIL Open Font License 1.1](./fonts/LICENSE.md) notice. CM3 resources
fetched at runtime or build time remain subject to their respective rights
holders' notices and terms.

The repository intentionally contains no CM3 runtime, effect, material,
worker, shader, texture, CM3 font, icon, or download-page files. It does
include the separately licensed Source Code Pro UI font under `fonts/`; it is
not a Panzoid/CM3 resource. When the app is started or a deployment is built,
`tools/runtime-resources.js` fetches the configured CM3 source page and its
same-origin resource graph into the Git-ignored `.zoidium-resources/` cache.
CM3-specific font presets remain in that cache, while the Zoidium extension
layer uses the locally bundled Source Code Pro family. No font CDN request is
needed. The cache is retained between local runs; a static
deployment keeps only the generated build output required by that deployment.

## Quick start

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run setup      # download/update the CM3 resource cache
npm run web       # ensures the cache and serves http://127.0.0.1:8123 and http://localhost:8123
npm run dev       # same, then opens the browser
npm start         # Electron development mode; ensures the cache is ready
```

Do not open the repository's `index.html` with `file://`. It is a bootstrap
placeholder; the actual CM3 page is generated into the runtime stage, and
workers/WASM require an HTTP origin.

## Build and deployment

Build a static deployment with:

```bash
npm run build
```

The generated site is written to `dist/web/` and is ignored by Git. For a
static host such as Cloudflare Pages, use `npm run build` as the build command
and `dist/web` as the output directory. `npm run build` is the deployment
entrypoint and runs the same CM3-fetching builder as `npm run build:web`.
`wrangler.jsonc` records `dist/web` as the Pages output directory for direct
Wrangler-based deployments. Network access is required in the build
environment because the CM3 source graph is fetched at build time. Do not
deploy the repository root: its `index.html` is intentionally only a source
checkout placeholder.

For a direct Cloudflare Pages deployment, run:

```bash
npm run deploy
```

This builds the fetched stage first and uploads only `dist/web/`. Wrangler
authentication and access to the `zoidium` Pages project are required.

Build desktop installers with:

```bash
npm run dist
```

The Electron builder first creates a temporary application tree containing the
fetched CM3 stage, builds the installer, and removes that temporary tree. The
installer necessarily contains the runtime needed by that particular build;
the source repository does not.

Set `ZOIDIUM_CM3_SOURCE_PAGE` to use another compatible source page during a
build or local run. The default is:

`https://panzoid.com/legacy/gen3/clipmaker.html`

## Runtime lifecycle

The staging pipeline is:

1. Fetch the configured CM3 HTML page when the cache is absent or refreshed.
2. Discover same-origin stylesheet/script links and static runtime references.
3. Fetch those files into the Git-ignored cache while preserving their URL paths.
4. Add the Zoidium bootstrap to the staged `index.html`, deferring CM3
   initialization until the extension layer is ready.
5. Serve or package the staged tree.
6. Keep the resource cache after the local server exits; remove only temporary
   build staging directories when their build process ends.

There is no checked-in resource manifest and no checked-in copy of the source
page. `npm run setup` refreshes the cache from the current HTML and runtime
graph; normal runs reuse that cache and automatically create it if necessary.

The extension layer supplies local account/API/adapters, plugin loading, and
the in-place download bridge. CM3's legacy download navigation is intercepted
by `zoidium/direct-download.js`; the generated Blob is sent to the browser's
download mechanism without opening another page.

## Repository layout

```text
Zoidium/
├── index.html                 # bootstrap placeholder; replaced in a build stage
├── LICENSE                    # MIT License for Zoidium-owned work
├── main.js                    # Electron process and disposable local server
├── package.json               # scripts and Electron build configuration
├── fonts/
│   ├── fonts.css              # local Source Code Pro face
│   ├── source-code-pro-regular.woff2
│   ├── LICENSE.md             # Source Code Pro SIL Open Font License
│   └── README.md              # source and license details
├── tools/
│   ├── runtime-resources.js   # fetch, cache, discover, patch, and stage CM3
│   ├── serve-with-resources.js# cache-backed browser server
│   ├── build-web.js           # static deployment builder
│   └── build-electron.js      # temporary-stage Electron builder
├── zoidium/
│   ├── runtime-config.js      # extension profile
│   ├── runtime-loader.js      # overlay bootstrap
│   ├── runtime-fonts.css      # applies the local Source Code Pro family
│   ├── runtime-policy.js      # local-first policy adapters
│   └── direct-download.js     # in-place Blob download bridge
├── plugins/                   # extension sources and generated plugin bundles
└── about/                     # notices and project information
```

## Plugins

Plugins are optional CM3 extension tools. Their source, manifests, presets, and
presets live under `plugins/`; the runtime normally loads each enabled plugin
through one generated `bundle.json` request.

```bash
npm run build:plugin-bundles
npm run check:plugin-bundles
```

`npm run dist` runs the bundle build automatically. See
[`plugins/README.md`](./plugins/README.md) for the bundle contract.

## Scope and attribution

Zoidium is an independent open-source tool collection, not an official CM3 or
Panzoid product. CM3 source files are obtained at runtime/build time from the
configured upstream page and remain subject to their respective rights-holder
notices and terms. Zoidium's extension code, plugins, documentation, and build
tools are licensed under the MIT License. See
[`about/acknowledgements/`](./about/acknowledgements/) for the current notices.

## Related files

- [`README.ja.md`](./README.ja.md) — Japanese README
- [`zoidium/README.md`](./zoidium/README.md) — staging implementation notes
- [`AGENTS.md`](./AGENTS.md) — repository rules for contributors and agents
