# Contributing to Zoidium

Zoidium is an extension layer around Clipmaker Gen3 (CM3). The repository does
not contain a copy of the CM3 runtime. The build and local server fetch it into
the ignored `.zoidium-resources/` cache or a temporary stage.

## Environment

Use Node.js 22.12 or newer and pnpm 11. The repository records the package
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
pnpm run desktop:start         # stage CM3 and run the Electron app
pnpm run desktop:dev           # alias for the Electron development app
pnpm run verify                # run schema, bundle, syntax, and unit checks
pnpm run build                 # build the ignored dist/web deployment tree
pnpm run desktop:build         # fetch CM3 and build the desktop installer
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
New material types belong in Material+ and use its shared UV layout
(`plugins/material-plus/uv-layout.js`) for every texture read through mesh UVs,
so text and extruded shapes get evenly spaced UVs instead of CM3's sheared
native ones. See the material-pack section of `docs/plugin-api.md`.

Bump only the manifest `version` when a plugin asset changes; the bundle builder
rewrites embedded asset URLs to that version. Never hand-edit per-file cache-busting
queries.

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

For a pinned build without a valid cache, set `ZOIDIUM_CM3_SNAPSHOT` to a local
snapshot file, `r2://bucket/key`, or HTTPS URL. Export a valid cache with
`pnpm run cm3:export --output=<file|r2://bucket/key>` and restore it with
`pnpm run cm3:restore --from=<source>`, or
`node tools/runtime-resources.js --setup --from-snapshot=<source>`.
Snapshots contain only CM3 cache files, never Zoidium project files. Keep them
in private storage outside the repository and GitHub.

Explicit `pnpm run setup` and `--refresh` still fetch upstream. To import pages
saved through a browser, run `node tools/runtime-resources.js --setup
--page-html=<clipmaker-file> --video-editor-html=<videoeditor-file>`. Other
resources are fetched normally. Challenge pages are rejected; do not bypass
the browser check. See `docs/cm3-resources.md` for recovery, R2 credentials,
and optional `ZOIDIUM_CM3_SNAPSHOT_TOKEN` authentication for HTTPS snapshots.

Do not commit CM3 HTML, JavaScript bundles, effects, materials, workers, WASM,
shaders, textures, icons, favicons, or CM3 fonts. The separately licensed
Source Code Pro font under `fonts/` is a Zoidium UI dependency and is allowed.

## Preview cache approvals

The preview cache stores finished frames only for plugin versions that passed
the browser oracle. `pnpm run verify` fails when plugin, runtime, or font
sources changed after the last oracle run. To refresh the approvals, run the
oracle, then rebuild the bundles:

```bash
pnpm run test:preview-cache -- --profile=<directory> --report=<file> --write
pnpm run build:plugin-bundles
```

The oracle compares cached frames with live renders byte for byte. It takes a
few minutes and uses one Chromium instance. It also honors
`ZOIDIUM_BROWSER_LOCK`.

On a work branch, you can set `ZOIDIUM_PREVIEW_CACHE_APPROVALS=defer` to turn
the stale-approval failure into a warning. Until someone reruns the oracle,
changed plugins render live in the editor. Rerun the oracle before you merge.

## Before opening a pull request

Run `pnpm run verify`. If the change affects runtime staging and network access
is available, also run `pnpm run build:web` and inspect `dist/web/`. Generated
deployment output is ignored and should not be committed.

## Test isolated community packages

To pack the isolated filter example into a separate output folder, run:

```bash
pnpm run pack:community examples/community-filter /tmp/zoidium-community-example
```

Use an empty output folder. The packer refuses to overwrite a package.
Keep the immutable `community-<32 hexadecimal UUID digits>` ID when you update
an existing package. For a new package, generate a new UUID and change its
effect IDs to match. Use one synchronous `guest-script-v1` entry file.
Do not use imports, async functions, package scripts, or remote resources.
Use `identity-v1` or `gain-v1` host templates. Arbitrary GLSL is unavailable.

To rebuild the embedded interpreter after a reviewed dependency change, run:

```bash
pnpm run build:community-interpreter
node tools/build-community-interpreter.js --check
```

Commit the generated bundle, build hashes, lockfile, and third-party notices.
Do not add runtime CDN or WASM fetches.

To run the Chromium containment tests, install the pinned browser and run:

```bash
pnpm exec playwright install chromium
pnpm run test:community-network
```

The browser suite fails if Chromium is missing. To serialize browser runs
with other local tools, set `ZOIDIUM_BROWSER_LOCK` to a lock directory path.
The suite then waits for that lock before it starts local servers or a
browser, and releases it after cleanup. To save detailed measurements, set
`ZOIDIUM_COMMUNITY_NETWORK_REPORT` to an output JSON file path.

To test desktop persistence and the dedicated runner session, run:

```bash
pnpm run test:community-desktop
```

The desktop suite uses the installed Electron version and a disposable runtime stage.
Set `ZOIDIUM_COMMUNITY_DESKTOP_EXECUTABLE` to test a packaged application executable instead.
Set `ZOIDIUM_COMMUNITY_DESKTOP_REPORT` to save its results outside the repository.
The suite honors `ZOIDIUM_BROWSER_LOCK` and uses a separate application profile.
It checks approved package execution, denied requests, broker validation, restart persistence, and launch safe mode.

To show the plugin manager's **Community** developer preview, run
`localStorage.setItem("zoidium.community-preview", "1")` in the editor's
console and reload.

Import the local package file, expand its card, and click **Approve**.
Review the exact hash in the confirmation window, then click **Approve**.
Expand the card again and click **Select for preview**.
Add the registered **Community Gain** effect to a layer.
Use **Open community setup** to change its controls.
The native picker adds an identifier suffix to each community effect name.

Preview controls use static CM3 properties and native undo and redo.
Keyframes, expressions, and arbitrary GLSL are unavailable.
A guest can return `temporal: { offsets: [...], weights: [...] }` alongside its uniforms.
A plan accepts 1 to 8 frame offsets in `[-120, 120]` and nonnegative weights that sum to one.
Offsets can contain fractional values. The host captures the effect input before its own pass.
The guest receives no image pixels, asset URLs, or decoder access.

The preview awaits exact-frame preparation for top-level layers and resident Composite and Precomp children.
Captures use attached local video files, resident images and shaders, and audited numeric content paths.
Text, fonts, custom shader inputs, expressions, and other unsupported content paths fail with `LOCAL_DEPENDENCY_UNAVAILABLE`.
Remote-backed video also fails with this error before the host creates a decoder or assigns a media URL.
Attach local media separately. The preview never fetches a missing dependency.
If a receipt is missing or stale, the effect renders as identity with a named pending status.
If the host cannot prove that a content path is local-only, Render once reports the failure and does not draw that frame.
Finished-frame caching and prefetch remain unavailable for projects with community effects.
Video and image export with community effects are refused.
To export, remove community effects from the project.
Missing or disabled packages render as identity and preserve their effect data.
After disabling a package, reload the editor before selecting it again.

On desktop, packages and exact-hash approvals persist under `userData`.
The editor keeps its existing session. Each community runner uses a separate nonpersistent session.
To open desktop management controls without running community code, launch with `--community-safe-mode`.
The preview flag still controls whether the Community panel is available.

Before changing the runner, run `pnpm run verify` and both containment suites.
`verify` runs package, protocol, and interpreter tests without a browser.
Do not pass community packages to the first-party plugin evaluator.
