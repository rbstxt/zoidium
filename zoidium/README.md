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

## Cache and output stages

`npm run setup` creates or refreshes `.zoidium-resources/`. `npm run web` and
development Electron runs reuse that cache and leave it in place after the
process exits. `npm run build:web` copies the cache into the ignored
`dist/web/` deployment tree. `npm run dist` uses a separate temporary Electron
input tree and removes only that tree after packaging.

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
files. See [`../plugins/README.md`](../plugins/README.md) for their bundle and
localization contracts.
