# Runtime staging notes

This directory contains Zoidium's extension layer only. It deliberately does
not contain a copy of the CM3 source page or any CM3 runtime resources.

## Bootstrap order

`tools/runtime-resources.js` fetches the configured Clipmaker 3 and Video Editor
2 pages and discovers their shared same-origin resource graph. It writes the
graph into the Git-ignored
`.zoidium-resources/` cache, then copies it into a disposable output stage when
one is needed and adds the Zoidium bootstrap to that stage's `index.html` to:

1. remove the upstream page's eager initialization and advertising bootstrap;
2. load the generated runtime profile map, `runtime-config.js`, and the
   local-first `runtime-policy.js`;
3. load the editor entry script selected in Settings;
4. expose the selected editor through the shared `CM` reference;
5. initialize the editor and load the Zoidium extension scripts.

The checked-in `index.html` is only a no-resource placeholder. It is replaced
inside `dist/web/`, the browser development stage, and the temporary Electron
build tree. The fixed resource manifest and remote-resource bridge were removed;
the current HTML and runtime graph are the source of truth for each run.

`runtime-fonts.css` imports the locally bundled `../fonts/fonts.css` and applies
the font selected in the Settings tab to the editor chrome. Source Code Pro,
Geist, Geist Mono, JetBrains Mono, IBM Plex Sans, IBM Plex Mono, Cascadia Mono,
and Fira Code are bundled under the SIL Open Font License 1.1; the generic
system monospace option is resolved only from the user's operating system. None
require a font CDN. CM3-specific font presets, if any, remain separate fetched
resources in the Git-ignored runtime cache.

## Cache and output stages

`pnpm run setup` creates or refreshes `.zoidium-resources/`. `pnpm run web` and
development Electron runs reuse that cache and leave it in place after the
process exits. `pnpm run build:web` copies the cache into the ignored
`dist/web/` deployment tree. `pnpm run dist` uses a separate temporary Electron
input tree and removes only that tree after packaging.

The generic `pnpm run build` hook delegates to `pnpm run build:web`, so a static
host's normal build step also fetches CM3 and publishes the generated stage.
Cloudflare Pages/Wrangler is configured to publish `dist/web/`; the repository
root remains a no-resource source placeholder and must not be deployed.
`pnpm run deploy` runs that build and uploads only `dist/web/` for a direct
Cloudflare Pages deployment.

The source pages can be overridden with `ZOIDIUM_CM3_SOURCE_PAGE` and
`ZOIDIUM_VIDEO_EDITOR_SOURCE_PAGE` for compatible development or build
environments. No fetched bytes or generated runtime profile map should be
committed.

## Extension hooks

`runtime-config.js` lists the overlay styles and pre/post initialization scripts.
`runtime-policy.js` supplies local account, API, and advertising adapters.
`direct-download.js` catches the CM3 client's legacy download-page navigation and
binds each completed export to its own Blob and filename in the current page.
`plugins/core/io-serialization.js` coordinates video, image, archive, and cleanup
operations. It uses an origin-wide lock for the output path shared by the CM3
workers. These are Zoidium-owned adapters; they do not copy or serve a download
page.

The plugin manager and plugin bundles are staged separately from plugin source
files. See [`../plugins/README.md`](../plugins/README.md) for the bundle
contract.
