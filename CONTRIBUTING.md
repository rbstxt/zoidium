# Contributing to Zoidium

Zoidium is an extension layer around Clipmaker Gen3 (CM3). The repository does
not contain a copy of the CM3 runtime. The build and local server fetch it into
the ignored `.zoidium-resources/` cache or a temporary stage.

## Environment

Use Node.js 18 or newer and pnpm 11. The repository records the package
manager in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
```

Do not create a second package lock. Commit changes to `pnpm-lock.yaml` when
dependency versions change.

## Common commands

```bash
pnpm run setup                 # fetch or refresh the CM3 resource cache
pnpm run dev                   # serve the staged app and open a browser
pnpm start                     # run the Electron app
pnpm run verify                # run schema, bundle, syntax, and unit checks
pnpm run build                 # build the ignored dist/web deployment tree
pnpm run dist                  # build desktop installers
```

The repository `index.html` is a placeholder. Test the app through the local
HTTP server. Do not open it with `file://`.

## Plugin changes

Edit the plugin manifest and its source assets, then run:

```bash
pnpm run build:plugin-bundles
pnpm run verify
```

The generated `bundle.json` is the normal runtime package. Keep its contents
in sync with the source manifest. Keep plugin IDs and serialized object types
stable after publication.

For generated packs, use the named scripts and pass the source directory after
`--`:

```bash
pnpm run generate:afterclip -- "/path/to/AfterClip/src"
pnpm run generate:alipfx -- "/path/to/Afterzoid Shader Pack 4"
pnpm run build:sprites
```

## Runtime resource rules

`tools/runtime-resources.js` owns the CM3 fetch path. It discovers resources
from the configured source page, preserves the paths expected by CM3, patches
the staged HTML, and copies Zoidium-owned files into the stage.

Do not commit CM3 HTML, JavaScript bundles, effects, materials, workers, WASM,
shaders, textures, icons, favicons, or CM3 fonts. The separately licensed
Source Code Pro font under `fonts/` is a Zoidium UI dependency and is allowed.

## Before opening a pull request

Run `pnpm run verify`. If the change affects runtime staging and network access
is available, also run `pnpm run build:web` and inspect `dist/web/`. Generated
deployment output is ignored and should not be committed.
