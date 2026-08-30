# Zoidium — Agent Guide

Zoidium is an open-source collection of tools for extending the Clipmaker Gen3
(CM3) experience. The repository contains the Zoidium extension layer, not a
copy of the CM3 source page or its runtime resources.

## Quick start

```bash
npm install
npm run setup    # download/update the Git-ignored CM3 resource cache
npm run web      # reuse the cache and serve it on localhost
npm start        # Electron development mode; reuse/create the cache
npm run dist     # fetches into a temporary Electron build tree
```

`npm run web` requires network access because it obtains the configured CM3
source page when the cache is absent or refreshed. Stop it with Ctrl-C; the
cache remains available for the next run. Do not open the repository
`index.html` with `file://`.

## Non-negotiable resource boundary

Keep this checkout limited to Zoidium-owned source and build tooling. The
external CM3 runtime files belong only in the Git-ignored cache or generated
outputs. This includes the source HTML, download page, JavaScript bundles,
effects, materials, workers/WASM, shaders, textures, CM3 fonts, icons, and
favicons. Resource paths must be discovered from the configured source page,
not maintained as a second copy in the repository.

The only source-resource fetch path is `tools/runtime-resources.js`:

1. fetch the configured CM3 HTML page (Panzoid's Gen3 page by default);
2. discover same-origin CSS, JavaScript, and static references;
3. write them to the Git-ignored cache and, when needed, a temporary or
   generated build stage;
4. inject the Zoidium bootstrap into the staged `index.html`;
5. serve/package the stage and clean it up when the local process exits.

The source page and graph are intentionally fetched only by the web server,
Electron development startup, `npm run build:web`, or `npm run dist`. A build
artifact may contain the runtime required by that artifact; the Git repository
must not.

## Files and directories

Zoidium-owned runtime files that may be edited:

- `tools/runtime-resources.js` — fetch, discovery, staging, and index bootstrap;
- `tools/serve-with-resources.js` — temporary-stage browser server;
- `tools/build-web.js` and `tools/build-electron.js` — disposable builders;
- `main.js` — Electron server lifecycle and cleanup;
- `zoidium/runtime-config.js` — overlay profile;
- `zoidium/runtime-loader.js` — overlay bootstrap;
- `zoidium/runtime-policy.js` — local-first account/API/ad adapters;
- `zoidium/direct-download.js` — in-place Blob download adapter;
- `plugins/` — extension source, generated bundles, and locale catalogs;
- `README*`, `about/`, `_headers`, `_redirects`, and package configuration.

`index.html` is a no-resource placeholder. The build pipeline replaces it only
inside a stage. Do not turn it into a local copy of the CM3 page.

## Runtime staging rules

- Keep the source URL configurable through `ZOIDIUM_CM3_SOURCE_PAGE`.
- Resolve and fetch only same-origin paths below the configured source page's
  directory. Reject path traversal and never write outside the stage root.
- Preserve the paths expected by the CM3 client in the generated stage; do not
  add those paths to the repository merely to make development convenient.
- Keep the source HTML's CM3 script order. Inject Zoidium policy before the
  runtime, defer the source page's initialization, and load the extension layer
  after CM3 exposes `initTool()`.
- The policy and bootstrap layer are explicit Zoidium behavior. Describe the
  product as an external extension layer around CM3 and keep that distinction
  clear in user-facing copy.
- The local server must leave `.zoidium-resources/` in place when it shuts down;
  only disposable build trees are removed after their build.
- `npm run build:web` writes the ignored deployment tree at `dist/web/`.
- `npm run dist` builds from a separate temporary tree and removes that tree
  after Electron Builder finishes.

## Download behavior

The CM3 client may still contain legacy calls that navigate to a download page.
`zoidium/direct-download.js` intercepts only those local download-page targets,
reads the pending `PZ.downloadBlob` and `PZ.downloadFilename`, and invokes an
`<a download>` in the current document. Do not restore a copied download page,
FileSaver bundle, popup window, or a `window.open`-based download flow.

## Plugin rules

Plugins are the normal place for new Zoidium features. Keep source files and
generated artifacts consistent:

```bash
npm run build:plugin-bundles
npm run check:plugin-bundles
```

Each plugin's normal runtime path is one generated `bundle.json`; source
manifests and editable sources are not copied into the Electron application.
Locale catalogs remain separate lazy resources. Every user-visible English
message introduced by a plugin must have an exact-key Japanese translation in
`plugins/<id>/locales/ja.json`, and the manifest's versioned locale URL must be
updated when the catalog changes.

Plugin modules and native effects must use the bundle asset API provided by the
plugin manager for declared resources. Do not add runtime `fetch()` calls that
fan out into the plugin source tree when the asset can be embedded in the
bundle. Keep plugin IDs and serialized object types stable once published.

## Code quality and verification

Before handing off changes:

```bash
npm run check:plugin-bundles
node --check main.js
node --check tools/runtime-resources.js
node --check tools/serve-with-resources.js
node --check tools/build-web.js
node --check tools/build-electron.js
node --check zoidium/runtime-config.js
node --check zoidium/runtime-loader.js
node --check zoidium/runtime-policy.js
node --check zoidium/direct-download.js
```

When network access is available, run `npm run build:web`, inspect the generated
`dist/web/` tree, and remove it after inspection if it is not needed. Confirm
that the repository itself has no CM3 runtime directories or generated stage.

Do not use `file://` for browser testing. Do not upload project contents,
accounts, or editing data as part of the resource bootstrap. The bootstrap
fetch is limited to the configured CM3 source graph and is distinct from
project-data transmission.

## Legal and wording boundary

Use wording such as “an open-source collection of tools for extending CM3” and
“external extension layer.” Keep Zoidium's independent status clear and do not
imply endorsement by Panzoid. Be precise that CM3 files are fetched into a
build/runtime stage and that the Zoidium code injects an extension layer around
them. Keep attribution and rights-holder notices in
`about/acknowledgements/` current.
