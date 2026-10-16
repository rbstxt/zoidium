# Zoidium Plugin API (simplified)

Plugins have five kinds plus one hidden core kind.
Full documentation comes later; this file covers the contract and how-to.

## Kinds

| kind | Adds | Examples | JS |
| --- | --- | --- | --- |
| shader-pack | Single shaders and multi-shader groups | AlipFX, CCFX, AfterClip | No |
| native-fx | Multipass effects including time ops | Native FX, Layer Input | Yes |
| object | 3D shapes and containers | Geometry+, Effector, Text+, Light+ | Shapes yes |
| material-pack | 3D materials | Material+ | Yes |
| extension | Anything, including panels | Player+, Easing+, Particles+ | Yes |
| core | Hidden built-in extensions | Zoidium Core | Yes |

Particles+ provides sprite assets, so it is classified as extension.

## Common manifest fields

- kind: one of the table above. Required for new plugins.
- visibility: visible (default) or hidden. Core must be hidden.
- alwaysEnabled: true means always on and not disableable. Core must be true.
- phase, coreScripts: core only. They record the load order.
  The real order lives in zoidium/runtime-config.js and must match
  plugins/core/manifest.json.

Per-kind required sections are checked by tools/validate-plugin-manifests.js.
Missing sections fail pnpm run check:plugin-manifests.

## How to build each kind

Scaffold command (it never touches the registry; it prints the next steps):

```bash
node tools/new-plugin.js --kind=native-fx --id=my-filter --name="My Filter"
node tools/new-plugin.js --kind=shader-pack --id=my-pack
node tools/new-plugin.js --kind=native-fx --template=temporal --id=my-time-fx
```

### shader-pack: effects and groups

- Single effects use effects[] (one shader plus one preset).
  Groups use groups[] (one preset plus N shaders).
- Pure declarations, no JavaScript. CCFX (plugins/ccfx/) is the reference.
- Bulk importers such as tools/build-afterclip-plugin.js convert pack dumps.

### native-fx: filter and temporal

- filter (normal image effect): just call ZoidiumPluginApis.defineFilter
  with the shader URL, uniforms, properties, and update.
  See plugins/native-fx/effects/radialblurspin.js.
- A filter that needs a direct visual editor can register a renderer with
  `ZoidiumPluginApis.propertyControls.register()`. Keep a standard CM3 storage
  type on the property and set its `zoidiumControl` field to the registered id.
  The renderer stays inside CM3's property list and uses the normal history
  hooks. See plugins/native-fx/effects/colorcurves.js.
- temporal (time operation): just call ZoidiumPluginApis.defineTemporal
  with kind time-offset or posterize-time.
  The host (plugins/core/temporal-render.js) applies the operator, so authors
  never touch frames directly. See timeoffset.js and posterizetime.js.
- frame sampler (multi-frame image effect): call
  `ZoidiumPluginApis.defineFrameSampler` with properties and a deterministic
  `getRequest(effect, frame)` function. The core compositor evaluates and
  reuses the required offscreen targets. The effect only combines the returned
  textures. See plugins/native-fx/effects/echo.js.
  Each tap evaluates the effect input with the time operators before the
  sampler in serialized order. Prefix quantizers use the tap's time, rather
  than only quantizing the current image. Time offsets already included in
  the sampler's input clock are rebased before replaying the prefix, so they
  are not added twice. Temporal operators after the sampler keep their
  existing evaluation of the composed result. Adjustment prefixes use
  project time and stop their lower-track scope at the sampler input.
  Nested preparation and rendering share the same eight-level depth limit.

- Complex multipass effects (such as Drop Shadow) can stay handwritten.
- An effect that needs an API added after its first release declares it with
  `requiresApis` (for example Echo declares `defineFrameSampler`, Color
  Curves declares `propertyControls`). When the extension shell serving the
  page predates those APIs, the effect degrades to an explicit incompatible
  placeholder instead of breaking effect loading; refreshing the page
  updates the extension layer and restores the effect.

### object: objectClasses (plus objectTypes)

- New shapes declare objectClasses[] with zoidium:<id>/<shape> types and
  register the implementation from a module. See Geometry+.
- Replacing or extending existing picker entries uses objectTypes[].
  See Light+.
- Shape modules can use context.apis.objects (numeric properties, shading).

### material-pack: materialTypes

- Declare materialTypes[] and register the implementation from a module.
  See Material+.
- Add new material types to Material+. A material that samples any texture
  through mesh UVs must use the shared UV layout instead of CM3's native
  `WorldUVGenerator` UVs, which shear on curved text and extrusion walls:

  ```js
  const uvLayout = new Function(context.getAsset("text", "./plugins/material-plus/uv-layout.js"))()();
  material.update = function (frame) { uvLayout.ensureMaterial(this); /* ... */ };
  material.unload = function () { uvLayout.releaseMaterial(this); /* ... */ };
  ```

  The layout rewrites only 3D Text and extruded shapes, follows effector source
  geometry, and restores the original UVs when no layout material remains.
  Materials that never read UVs (Matcap) are exempt.

### extension: modules

- Each module exports `activate(context)`; `deactivate()` is optional. Both may
  be async. Modules receive `context.apis` and a bundle `context.getAsset`.
- Register owned DOM, watchers, timers, and prototype patches with
  `context.lifecycle.onDispose(cleanup)` before mutating the host. The manager
  owns the module before calling `activate()`, so cleanup runs even if activation
  fails halfway. Cleanup callbacks are awaited in reverse registration order,
  run once, and continue if another cleanup fails. A module's `deactivate()` runs
  first; callbacks must tolerate resources it already removed.
- Unload only patches still owned by the module. Retain the original descriptor
  or function, and restore it only if the host still references your replacement.
- `isInUse()` may return true to prevent disabling a module whose project data
  would otherwise lose its implementation. This supplements managed object and
  resource tracking.
- `ZoidiumUI.createMenubarTab({ panel: panel.el, ... })` accepts the panel DOM
  element. Retain the returned tab and pass it to `removeMenubarTab(tab)` on
  disposal. Removal also updates the elevator's panel list and active tab.
- A custom editor borrowing a viewport can call
  `ZoidiumUI.acquirePreview(viewport, close)`. The previous owner is closed
  before a new lease is returned. Release the lease when the editor closes.
  Scope temporary render properties to a preview draw and restore them in
  `finally`; do not persist designer-only state in normal rendering.

- Editors, setup dialogs and designers open as floating windows through
  `context.ui.openWindow()`. Use native property rows (`context.ui.properties`)
  for CM3 properties and `context.ui.controls` for other values. Register
  object/effect/material editors with `context.ui.registerEditor` or
  `registerAttributePanel`, sidebar pages with `context.ui.sidePanel`, and a
  product-specific look with `context.ui.registerSkin`. Everything registered
  through `context.ui` is removed when the plugin is disabled. Fullscreen
  overlays, bundled UI fonts and borrowed preview viewports are not accepted.
  See [Plugin UI](plugin-ui.md).

See Player+ and Easing+ for ordinary extension modules. A separate settings-page
API has not been added; persistent per-object settings belong in project
properties edited through a window.

### Native 3D font loading

Core makes native `PZ.asset.font.get3DFont()` and `loading3d` settle to a
`THREE.Font` on success or `null` on a read/parse failure. Failure details are
available on the shared font data as `zoidiumFont3dError` with `stage` and
`message`; `zoidiumFont3dState` is `loading`, `ready`, or `failed`. Core reports
failures through the existing notification UI. Plugins should not report the
same managed failure again. A pending read has no timeout.

An asset source, file, or remote URL change invalidates its shared parsed font
and loading state. Native Text geometry updates automatically, including Text+
character geometry. Failed Text is empty during preview and export; other
objects continue rendering. Native font property edits keep their existing
undo/redo behavior. Core retains unloaded font assets within their project
asset list so those native history operations can restore attached bytes.

### Splitting a plugin into several files

Source files stay at or below 1000 lines (`pnpm run verify` checks it). Declare
every extra file as a text asset in the manifest and load it with the shared
bundle loader instead of a hand-written `new Function` wrapper:

```js
const require = context.apis.modules.createRequire(context.getAsset, {
  root: "./plugins/my-plugin/",
  scope: { context },          // extra names visible inside every file
});
const curves = require("./curves.js");   // module.exports of curves.js
```

Each file runs once per loader as `function (module, exports, require, ...scope)`.
`require` resolves `./` and `../` against the requiring file, refuses paths
outside `root`, and returns partial exports for cycles as CommonJS does. Native
effect sources can reach the same loader through the global
`ZoidiumPluginApis.modules.createRequire`.

### Shared modules (zoidium/shared/)

Pure helpers for logic duplicated across plugins live in `zoidium/shared/*.js`
and are exposed on `ZoidiumPluginApis` (hence also on `context.apis`):

| table | file | contents |
| --- | --- | --- |
| `random` | `shared/random.js` | Seeded 0-1 hashes plus the matching GLSL chunk |
| `props` | `shared/props.js` | Property readers and JSON clones |
| `color` | `shared/color.js` | Clamps, lerps, and color-space conversions |
| `gl` | `shared/gl.js` | Render-target and copy-pass helpers (takes `THREE`) |
| `json` | `shared/json.js` | Prototype-safe JSON parsing and assignment |
| `windows` | `shared/windows.js` | Escape handling and persisted window geometry |

The overlay entries load in `postInitScripts` before `zoidium/plugin-apis.js`
(which attaches them), and before `zoidium/settings.js` (which reads
`ZoidiumSharedJson`) and every plugin. Call sites use the shared tables
directly with no local fallback. Bit-for-bit pins live in
`test/shared-random.test.js` and `test/shared-helpers.test.js`.

Each table has a non-enumerable `workerSource()` method. It serializes the
module's named initializer with `Function.prototype.toString()` and returns a
script that initializes the table on `globalThis.ZoidiumPluginApis`. Prepend
only the tables a worker needs before evaluating the worker's bundled modules:

```js
const prelude = context.apis.random.workerSource() +
  context.apis.props.workerSource() + context.apis.color.workerSource();
const worker = new Worker(URL.createObjectURL(new Blob([prelude, jobSource], {
  type: "text/javascript",
})));
```

The initializer contains its helper dependencies and creates fresh closure
state in the worker. It does not fetch scripts or require `window`, `document`,
or the page's API object. Module authors must keep dependencies inside that
initializer or pass them explicitly to a helper. Effector mesh jobs and the
Material+ graph worker use this mechanism with their bundled source assets.
`test/shared-worker-realms.test.js` evaluates both generated workers in VM
realms without browser globals and compares their complete results with the
main realm. `test/worker-helper-pins.test.js` pins the migrated call sites
against verbatim pre-migration copies.

- `random`: `legacyHash01(seed, index)` (Datamosh/VHS setups) with
  `nextSeed(seed)`; `sceneSeededRandom` (Scene+); `textSeedHash` /
  `textSeededRandom` (Text+); `effectorHash01` / `effectorHashUnitVector`
  (Effector core); `particularSimHash` (Particular);
  `plexusRand` / `plexusHash2` / `plexusSmoothNoise2` / `plexusFbm2` (Plexus);
  `formSrand` / `formHash3` / `formSmoothNoise` (Form);
  `vibrateHashNoise` / `vibrateSampleNoise` (Camera+). Variants differ in
  integer math, so each keeps its own name: never unify them.
  `GLSL_RAND` is the `"float rand(vec2 n) { ... }"` chunk shared by the Form
  and Particular point shaders.
- `props`: `readNumber(property, time, fallback)` (finite number or fallback,
  never throws); `readVector` / `readColor` (per-component fallback, the
  fallback is never mutated); `forEachProp(properties, visit)` over own
  entries; `cloneJson` (registry semantics) and `cloneJsonValue` (reset-data
  semantics: functions clone to `undefined`); `finiteOr(value, fallback)`; `numberValue` coerces scalar values, and
  `readNumberCoerced` preserves Material+'s optional getter and numeric-string
  behavior.
- `color`: `clamp` / `lerp`; `clampUnit` (Effector: NaN and non-positive
  collapse to 0) vs `clamp01` (NaN passes through); `hsvToRgb` / `rgbToHsv`
  (hue in degrees, Magic Looks); `hsvToRgb01` / `rgbToHsv01` (hue in [0, 1],
  Material+ graph runtime); `hslToRgb`; `hexToRgb` / `rgbToHex`.
- `gl`: `createRenderTarget(THREE, w, h, options)` (options pass through
  untouched, so each site keeps its depth/stencil behavior; mipmaps pinned
  off); `sameSize` / `ensureSize` (in-place `setSize`); `disposeTarget` /
  `disposeAll` (never throw); `createCopyPass(THREE)` (plain CopyShader pass);
  `disposePass` (material plus quad geometry).
- `json`: `parseJsonSafe(text, fallback)` (never throws);
  `parseJsonClean` / `cleanParsed` (drop `__proto__`/`constructor`/`prototype`
  at every depth); `safeAssign(target, ...sources)` (skips those keys, so a
  parsed payload can never change the target's prototype).
- `windows`: `isEscapeKey(event)` / `shouldCloseOnEscape(event)` (mirrors the
  UI kit close path: unconsumed Escape); `onEscape(target, handler)` (returns
  a disposer); `readWindowGeometries(storage)` / `writeWindowGeometry(storage,
  key, geometry)` (the `zoidium.ui.windows.v1` localStorage schema; never
  throw).

### core: the hidden plugin

- Only plugins/core/. Hidden from the panel, cannot be disabled,
  and never stored in projects.
- Still listed in the debug log (PZ.zoidium.getDebugPlugins()).
- A failing core script does not abort startup; it lands in the
  failure list carried by zoidium:ready (degraded boot).

## Rendering contract

Every plugin that draws must be deterministic. For a fixed project, assets,
settings, seed and target time, the rendered frame must not depend on earlier
renders, playback direction, repeated redraws, wall-clock time or whether
playback is running.

- Evaluate analytically at the frame, or replay from a defined start with
  fixed steps. Caches and checkpoints are allowed only as acceleration and
  must be keyed by every input that affects the result.
- Core memoizes sampler input textures by exact serialized content, asset/file
  identity, output resolution and aspect settings, plugin state changes, source time,
  effect, nesting depth and adjustment scope. Every key cuts the sampler's
  layer before the sampler, so editing the sampler itself or a later effect
  retains its inputs. Audited ordinary layer content (audited effects before
  the sampler) keys only its clip timing, sequence properties and that effect
  prefix, so an unrelated track can be edited too. Prefix Time Offset and
  Posterize Time operators remain in the key. Other content uses the whole
  sequence; when expressions, layer sources or compositions could read the
  cut effects, the cut is not applied. No edit-generation shortcut replaces
  content serialization. Undo/redo can reuse still-resident entries.
  Inputs without an earlier sampler share storage across depths; adjustment
  inputs retain their depth because lower tracks may recurse into samplers.
  `PZ.zoidium.debugDisableFrameSamplerInputReuse = true` disables reuse between
  preparations for pixel comparisons while preserving the current prepared plan.
- The sampler allocates optional retained RGBA8 targets only while their total
  is at most 256 MiB per root compositor, with at most 128 slots per effect and
  input nesting depth. Single-tap requests reuse one target. Other plans
  normally retain their frame span, tap count and
  four extra scrub slots, so playback recycles targets before filling the byte
  budget. It evicts the least recently used unreserved slot across all effects.
  Mandatory targets for an active request can exceed the byte budget, as before.
  The total target bound is 256 MiB plus
  `width * height * 4 * sum(peak unique taps per live effect/depth)`, with at
  most 64 taps and eight depths. This accounts for RGBA8 pixel storage; driver
  overhead, compositor scratch buffers and effect-owned work buffers are extra.
  Active preparation batches and published output plans remain reserved until
  their captures or main render finish.
- Content edits refill expired slots without reallocating the target pool.
  Overwriting a target immediately unlinks its old memo entry, so retained keys
  are bounded by resident targets. Each resident revision shares one content
  string across its frame entries. Project-resolution events and compositor
  resizes release the pool immediately. Asynchronous input preparation and
  pending previews verify their content keys before publishing. Effect unload,
  project replacement and compositor unload dispose the complete runtime,
  including isolated decoder schedules. Plugin state changes also dispose it.
- Core also keeps finished editor preview frames (`plugins/core/output-frame-cache.js`).
  A frame missing from the cache is drawn live exactly as without it; a draw
  that is provably complete is copied on the GPU (no readback, no conversion)
  and shown again for the same project state and frame. Complete means: the
  project's resources settled for this revision, no font still loading, no
  pending time-effect preview, every visible video drawn from the preview's
  isolated decoders that finished this exact frame, and, while paused, each
  visible object's own `prepare(frame)` awaited. Objects that load data while
  a frame updates expose `zoidiumFrameReady(frame)` (Trapcode Form, Plexus and
  Particular, Optical Flares); return `false` while any data for the current
  frame is still loading.
- The cache key is the full project serialization plus asset identities,
  enabled tracks, drawing-buffer size, aspect and renderer settings, plugin
  versions and states, and font completion. It is recomputed after any input
  event, native history operation (also from pop-out windows), project change
  notification, and for 1.5 s after them; between those, only the cheap parts
  (assets, tracks, buffer size, settings, plugins, fonts) are compared. Projects
  that require plugins outside the verified list keep the live preview.
  `PZ.zoidium.debug.frameCache.assertKeys = true` re-serializes on every hit and
  counts mismatches; `disabled = true` turns the cache off for comparisons.
- When paused and idle for 0.8 s, the cache renders up to 150 frames ahead and
  8 behind the playhead through a private copy of the project (its own
  decoders and sampler pool), one frame per task, stopping on any input,
  edit, seek or playback. The copy is built once per revision and released
  when the window is complete, playback starts or the project changes. Scenes
  whose synchronous draw takes longer than 50 ms, and projects with video
  media (private decoders slowed the editor's own playback), are not
  prefetched; their frames are still kept as they are shown.
- Memory: the Settings **Preview cache** value bounds the counted RGBA8 bytes
  (512 MiB by default, 0 disables it; 1920 x 1080 frames hold at most 64).
  The prefetch copy adds a second sampler pool (256 MiB plus mandatory taps)
  and duplicated geometry while it exists. Project replacement, resolution
  changes, plugin state changes, a smaller setting and compositor unload
  release the frames. Exports and the eyedropper keep their native draws.
- Effects that need other frames request them with `defineFrameSampler` or
  `defineTemporal`. Never feed the previous output back as history.
- Randomness comes from seeded hashes of (seed, index, frame), never from
  `Math.random()`.
- Audio-reactive features analyze decoded audio at the project time
  (see `T.audioAnalysis` in Trapcode Suite), never a live `AnalyserNode`.
- Asynchronous assets are awaited in `prepare()` before a frame is complete.

## Compatibility and serialized types

- New object classes use namespaced string types (`zoidium:<plugin>/<name>`).
  Numeric types collide with CM3 and other plugins and are reserved for
  loading older projects.
- A plugin that must load legacy numeric types claims them in
  `PZ.zoidium.legacyObject3dTypes` (refusing activation on a collision), maps
  them onto the namespaced class, and saves the namespaced type. Effector+
  is the reference.
- Do not replace or patch vanilla CM3 classes to add features to them. Add a
  separate object instead, as Camera+ does, so projects that do not use the
  plugin render exactly as in CM3.

The manager retains cloned, unknown top-level fields and unknown `properties`
entries loaded on media, layers and clips. On save it merges those fields into
the host serializer's output; current host fields and properties take priority.
A live extension's own data field takes priority over its retained snapshot.
Reloading an instance replaces the snapshot. This covers disabled Precomp+
`media.comp` and composite `compId`/`offset`, including older projects without a
plugin descriptor. Composition data also adds the Precomp+ requirement on save.

This preserves serialized metadata, not the disabled feature's rendering or
editing behavior. Keep nested extension data in its own field; the manager does
not merge missing items into host arrays or restore removed host objects.
Unknown object/effect/material types use their separate missing-type adapters.

## Security and future community plugins

Only first-party bundles listed in the shipped registry with matching SHA-256
integrity digests can activate through the plugin manager today. The builder
hashes the exact UTF-8 bundle.json bytes, including its trailing newline, and
records `sha256-<base64>` in the registry. Check mode rejects stale digests.
The manager fetches text, verifies it with Web Crypto, then parses the bundle.
Missing digests, mismatches, unavailable Web Crypto, and version mismatches
refuse activation and appear in the Plugins page and debug log. Project-driven
activation uses the same check, even for a previously disabled plugin.
HTTPS and HTTP loopback origins such as localhost and 127.0.0.1 support the
secure context needed by Web Crypto, including Electron's loopback server.
Other HTTP origins fail closed. Registry and bundle requests revalidate their
cache entries. A stale registry paired with a newer bundle fails closed; reload
or deploy matching files. Desktop packages include the registry and bundles.

This provides tamper evidence relative to the shipped registry, not signatures:
an attacker who can replace both registry and bundle can replace the digest.
Protect the release channel and review changes to both files. The hidden Core
bundle is checked by the manager too, but Core's pre-init scripts are separate
trusted application bootstrap files executed earlier by the runtime loader.
The bundle digest does not authenticate those earlier script requests. They
need loader-level verification before execution to close that separate gap.

Bundles embed declared local assets and modules read them through getAsset.
Source trees are not fetched at runtime. Temporal effects declare bounded
operations and frame offsets. These contracts are not a JavaScript sandbox.
Same-realm code has the editor's DOM, storage, network, and project access; a
manifest permission flag or narrowed context object cannot enforce restrictions
when code can use global objects or patch host prototypes.

A future community-plugin manifest should declare versioned capabilities for
project fields and edit commands, network origins and methods, local storage
quota, file import/export, and UI panels. The installer must present those
requests, record grants, and reject undeclared operations. Such declarations
are a design proposal, not permissions supported by today's manifest schema.

Community code needs a separate sandboxed iframe or worker realm with a
versioned message API. An iframe must have an opaque origin with no same-origin
access; a worker needs an isolated origin and a restrictive network policy.
The host must validate every message and grant, pass only explicit data copies
or scoped handles, bound message sizes and work, and revoke handles on unload.
Panel rendering and file/network operations must go through host brokers.
Workers cannot touch the editor DOM, and iframe panels must not inherit editor
storage or global objects. Review, signing, resource limits, and safe updates
remain prerequisites before accepting community bundles.

## Checks

```bash
pnpm run build:plugin-bundles
pnpm run check:plugin-manifests
pnpm run check:plugin-bundles
pnpm run verify
```

## Timeline track extensions

`timeline.registerTrackField(name, { default })` declares a JSON field on
tracks. Loaded values override the default, and save reads the live track value.
The host retains unknown track fields even when their plugin is disabled.
Disposal releases the declaration for reactivation; serialization remains active
so disabling a plugin cannot erase project data. Reserved object keys, `type`,
and `clips` cannot be declared.

`timeline.registerTrackButton({ id, label, title(track), isActive(track),
onToggle(track, editor), kinds: ["video"] })` adds a button to existing and new
track labels. The plugin owns its history transaction in `onToggle`. Call
`timeline.refreshTrackButtons()` after undo/redo to refresh active states.
The returned disposer removes the buttons and restores label layout. Several
plugins can register buttons without replacing each other's registrations.

## Media presets and layer extensions

`media.registerPreset({ id, name, icon, json })` installs a CM3 Media preset in
the live project and subsequent loaded projects. `json` is the CM3 media payload,
including `assets`, `data`, and `baseType`. Presets are marked `preset: true`, so
CM3 excludes them from saved project media. The returned disposer removes the
preset and its project-load hook when no registrations remain.

`layers.registerType({ id, type, legacyType, factory })` adds a layer factory
and claims a legacy numeric layer ID in `PZ.zoidium.legacyLayerTypes`. IDs below
9 are reserved for CM3. Conflicting claims fail activation; disposal releases
the claim and restores the previous factory only while still owned. Use a
namespaced type for new layer formats. Camera+ retains the established numeric
layer type 9 because the manager's existing missing-layer adapter and project
requirement scanner recognize it. Its camera objects save their stable
`zoidium:camera-plus/camera` type. A project using this layer locks Camera+
against disabling; opening it without the plugin uses the manager's retained
missing-layer placeholder and dependency prompt.

## Assets

`ZoidiumPluginApis.assets` is the same registry as `ZoidiumAssets`.
`snapshot(editor)` returns assets, authored usages, statuses, and counts, cached
by revision. `subscribe(listener)` coalesces changes to one notification per
animation frame. `refresh()` invalidates the cache. `reveal(usage)` selects a
live owner without switching compositions; closed-composition usages return
`false`. Each item's non-enumerable `asset` is the live CM3 asset, not a copy.
Do not serialize it or change asset ownership through the registry.
Built-in and plugin preset files appear only while something uses them; unused
ones are internal dependencies. The open root timeline is not an item.

The Assets plugin shows this registry as an After Effects style Project panel.
Other code can open it on an item with
`ZoidiumAssetsPanel.open({ select: itemId, filter: "problems" })` while that
plugin is enabled.

`replace(itemId, { file })` imports a retained, deduplicated target before changing
references. `replace(itemId, { itemId: targetId })` uses an existing item. Both
return a promise of `{ ok, replaced, newId, skipped, reason, error }`. Native
ASSET values, every matching keyframe, plugin references, and ordinary Media
templates change in one undo step, or join the current history operation.
Consumers reload while keeping clip timing. The old FILE item stays retained.
Kind mismatches return `ok: false, reason: "kind"`. Closed compositions stay
unchanged and appear in `skipped` as `{ path, reason: "closed-composition" }`.
`locate()` still returns `reason: "different"` for different file bytes.

`builtInFonts()` returns `{ id, key, name }` entries in native Font dropdown
order. Listing them creates no assets. They become preset items when used as
replacement targets.

Plugins can report references that native ASSET properties cannot represent:

```js
const dispose = context.apis.assets.registerReferences({
  id: "example/graph-images",
  label: "Graph images",
  collect(project, emit) {
    // Read project data only. Emit once per authored reference.
    emit({ key: assetKey, path: ["Object", "Material", "Image node"],
      owner: material, address: graphProperty.getAddress(), revealable: true });
  },
});
context.lifecycle.onDispose(dispose);
```

Collection must not load/unload assets, create Blob URLs, or mutate the project.
Paths describe the authored owner. `address` and `owner` are optional; omit them
and set `revealable: false` for references that have no live property panel.
Adapter ids must be unique. Dispose the registration when the plugin disables.
An optional `replace(oldKey, newKey)` hook updates live authored references with
native propertyOps writes inside the registry's history operation. It must not
open another operation or edit closed compositions. Material+ rewrites each
graph JSON property once; the IES adapter writes profile, text, and filename.
An adapter without this hook prevents replacement of its live references.

For embedded data without a CM3 asset, an emit record may include `item` with
`{ kind, source: "embedded", name, size, mime }` and a stable synthetic key.
References inside a closed composition may include `composition: { id, name }`;
these usages are never revealable. Adapter collection also covers closed
composition JSON when the plugin stores its references inside text properties.
Precomp+ exposes detached closed timelines through `PZ.precomp.referenceSources(editor)`.

Snapshots rebuild at most once per editor per animation frame. A second change
within that frame is reflected on the next frame; repeated reads return the
same snapshot object. `refresh()` explicitly bypasses that cache for diagnostics.
Subscribers receive the initial snapshot and subsequent changed revisions.

Asset recovery uses `capabilities(item)` to report `reload`, `locate`, and
`exportFile` availability. `reload(itemId)` rebuilds decoded consumers without
changing project data or history and returns `{ ok, status, error }`.
`locate(itemId, file)` accepts a missing FILE asset only when its native hash
matches, returning `{ ok, reason, error }`. A mismatch returns `reason:
"different"` without changing the project. `exportFile(itemId)` returns
`{ blob, filename }` or `null`; callers own the download UI and any object URLs.

Plugins invalidate private decoder caches with
`registerReloader({ id, reload(key, asset) })`. The hook runs for each recovery
of a native asset, after shared wrapper caches reset. It may return a promise
and must finish rebuilding its consumers before resolving. Keep reference
counts and saved data unchanged. Dispose the returned registration through the
plugin lifecycle. Reference adapters may also implement `reload(key, asset)`
for their own emitted items. These adapter items report Reload availability
only when their reference adapter supplies that hook.

Embedded reference records may supply `bytes: text`. The registry keeps this
text private and uses it for Export File. IES filenames receive a `.ies` suffix.
Native font wrappers expose `reset()`, which clears failed decode state, rearms
the warning, and returns the new 3D font load promise. Transient preset reads
retry after 2, 6, and 18 seconds; attached files and parse failures do not retry.


Every FILE item in the live editor project is retained, including unused and
missing files loaded from older projects. Snapshot items expose `retained`;
`ZoidiumAssets.retained(id)` checks the current project. Presets and private
render projects do not receive retention references. Retention is runtime
ownership only; native asset JSON and attached archive bytes preserve the files.

`import(files)` returns a promise of `{ ok, items: [{ id, name, created }], errors }`.
It uses native file hashing and Media import for images, video and audio. Other
files remain asset items. Duplicate bytes reuse the existing item. Import,
`removeUnused(ids?)` and `removeItems(ids)` each join an open history operation
or create one undo step. `removeUnused` returns `{ ok, removed, freed, skipped }`,
where removed/skipped entries have `id`, `name` and `size`. Media holds do not
count as authored uses. `removeItems` returns a promise of
`{ ok, removed, clearedUses }`; it deletes footage clips and clears properties
and matching keyframes. Uses in closed compositions refuse the whole edit with
`reason: "in-closed-composition"` and `composition: { id, name }`.

Reference adapters may implement `clear(key)` to remove all live authored uses
of that key through native property operations. Core calls the hook inside its
history operation. Do not start another operation or edit closed composition
JSON. Material+ clears graph image parameters this way; the IES adapter clears
its profile, filename and embedded data. Deletion refuses unsupported adapters
before changing anything. Undo restores the same asset objects and recreates
their Blob URLs before restoring consumers.

Saving a missing FILE (no bytes in the editor, used or unused) writes its key
into optional `missingAssets` in `zoidium.json`. This records a known absence,
not file bytes. Existing integrity records and attached bytes still undergo
normal validation.

Folders and labels follow the After Effects Project panel. `snapshot().folders`
lists `{ id, name, parent, label }` and every item has `folder` and `label`
(0 = none, 1-16 = the AE label colors). `createFolder(name, parent)`,
`renameFolder(id, name)`, `deleteFolder(id)` (its contents move to the parent;
no asset is deleted), `moveItems(ids, folderId)` and `setLabel(ids, label)`
each record one undo step. The metadata is saved in the project's
`zoidiumAssets` root field, which CM3 ignores; entries for items that no longer
exist are dropped when saving.

`collectFiles({ name? })` (After Effects Collect Files) returns a promise of
`{ ok, blob, filename, collected, missing, report }`: a stored ZIP with every
file item that has bytes (attached files and embedded plugin data), named by
item name with case-insensitive " (2)" suffixes, in directories matching the
Assets folders, plus `Collect Files Report.txt` listing missing files. It does
not change the project. `consolidate()` (Consolidate All Footage) groups file,
preset and plugin data-URL items of one kind whose bytes are identical,
replaces every use of each duplicate with one kept item through `replace()`,
and removes duplicates that become unused like `removeUnused`, all in one undo
step. The kept item is a working one, then a built-in preset, then an attached
file, then the most used. It returns `{ ok, consolidated, groups: [{ keep,
merged }], removed, skipped }`. CM3 keys attached files by a SHA-256 of their
bytes, so in practice duplicates pair a file with a preset or plugin data URL.

`propertyAt(element)` resolves an element inside a CM3 property row to
`{ address, name, kind }` when the row edits an asset property, and
`assign(itemId, address, frame?)` sets that property to the item in one undo
step and returns `{ ok, frame }` (`reason: "kind"` for a mismatched type,
`"expression"` for an expression-driven property). Like the native property
panel, the edit frame defaults to the playhead minus the property's
`frameOffset` (its clip start); an animated property gets a keyframe there
through `propertyOps.startEdit`, or the existing keyframe at that frame changes. `dragMedia(itemId)` returns the Media tab
item that shows a footage item, for CM3's own timeline drag, or `null`.
