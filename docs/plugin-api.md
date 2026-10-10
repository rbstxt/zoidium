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

Current assumptions:

- The runtime reads only the generated single-line bundle.json.
  Author source trees are never fanned out at runtime.
  Files come from inside the bundle through getAsset.
- Bundles may reference only repository-local files. Remote URLs are rejected.
- Temporal effects declare only offset or posterize. Frame samplers declare a
  bounded list of frame offsets; arbitrary frame rewrites are not possible.

Still missing before opening up to community plugins (not implemented):

- Declared permissions (network, DOM access) with runtime enforcement.
- Signing and review flow.
- Privilege separation for panel modules.

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
