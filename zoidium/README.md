# Runtime staging notes

This directory contains Zoidium's extension layer only. It deliberately does
not contain a copy of the CM3 source page or any CM3 runtime resources.

## Bootstrap order

`tools/runtime-resources.js` fetches the configured CM3 page and discovers its
same-origin resource graph. It writes the graph into the Git-ignored
`.zoidium-resources/` cache, then copies it into a disposable output stage when
one is needed and adds the Zoidium bootstrap to that stage's `index.html` to:

1. remove the upstream page's eager initialization and advertising bootstrap;
2. load `runtime-config.js` and the local-first `runtime-policy.js`;
3. load the CM3 runtime in its original order;
4. run `runtime-loader.js` after the CM3 page exposes `initTool()`.

The checked-in `index.html` is only a no-resource placeholder. It is replaced
inside `dist/web/`, the browser development stage, and the temporary Electron
build tree. The fixed resource manifest and remote-resource bridge were removed;
the current HTML and runtime graph are the source of truth for each run.

`runtime-fonts.css` imports the locally bundled `../fonts/fonts.css` and applies
the same `Source Code Pro` family used by CM3's editor. The WOFF2 file is kept
under `fonts/` with its SIL Open Font License 1.1 notice; it is not fetched from
Panzoid and does not require a font CDN. CM3-specific font presets, if any,
remain separate fetched resources in the Git-ignored runtime cache.

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

The source page can be overridden with `ZOIDIUM_CM3_SOURCE_PAGE` for compatible
development or build environments. This is the only intended source-resource
configuration point; no fetched bytes or URL manifest should be committed.

## Extension hooks

`runtime-config.js` lists the overlay styles and pre/post initialization scripts.
`runtime-policy.js` supplies local account, API, and advertising adapters.
`direct-download.js` catches the CM3 client's legacy download-page navigation and
downloads the pending Blob in the current page. It is intentionally a small
Zoidium-owned adapter and does not copy or serve a download page.

The plugin manager and plugin bundles are staged separately from plugin source
files. See [`../plugins/README.md`](../plugins/README.md) for the bundle
contract.
