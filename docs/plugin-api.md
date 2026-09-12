# Zoidium Plugin API (simplified)

Plugins have five kinds plus one hidden core kind.
Full documentation comes later; this file covers the contract and how-to.

## Kinds

| kind | Adds | Examples | JS |
| --- | --- | --- | --- |
| shader-pack | Single shaders and multi-shader groups | AlipFX, CCFX, AfterClip | No |
| native-fx | Multipass effects including time ops | Native FX, Layer Input | Yes |
| object | 3D shapes and containers | Geometry+, Repeater, Text+, Light+ | Shapes yes |
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

- Each module exports activate(context); deactivate() is optional.
  Modules receive context.apis. See Player+ and Easing+.

### core: the hidden plugin

- Only plugins/core/. Hidden from the panel, cannot be disabled,
  and never stored in projects.
- Still listed in the debug log (PZ.zoidium.getDebugPlugins()).
- A failing core script does not abort startup; it lands in the
  failure list carried by zoidium:ready (degraded boot).

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
