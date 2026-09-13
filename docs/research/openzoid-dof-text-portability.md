# Portability of the modified openzoid feature set into Zoidium

Research date: 2026-09-13

Source analysed: `modified-openzoid-main/openzoid-main/UPSTREAM-DIFF.md` and the
folder it describes. Runtime inspected: the Git-ignored CM3 cache
(`.zoidium-resources/`), specifically `core-1.0.102.js`, `ui-1.0.72.js`, and
`three.r91.min.js`.

## Conclusion

Openzoid's four features are not one port job. The base is the same, so the two
rendering features and the 3D-text rewrite are portable through Zoidium's
existing extension mechanisms; the offline embedded-asset layer is the only
part that collides with Zoidium's resource boundary.

| Feature (openzoid section) | Verdict | Where it lands in Zoidium |
| --- | --- | --- |
| (A) Per-camera depth of field | Portable | New core script; post-process added to `PZ.compositor.prototype` |
| (B) Sequence DOF + layer `Depth` | Portable, one real risk | Same script; the `renderLayer` wrapper is the risk |
| (C) 3D text rebuild (spacing, bevel) | Implemented | Text+ v15 and the native Text property patch |
| (D) `ExtrudeGeometry` bevel extensions | Implemented | Anchored rewrite in disposable runtime stages |
| (E) Offline embedded assets (~10.4 MB) | Blocked by design | Boundary rule; no change needed for HTTP modes |

Rough size of the port: about 900-1,200 lines of new Zoidium-owned JavaScript,
an 8-hunk anchored patch to the staged three.js, and one edit to the CM3 text
caller. Nothing from the source folder has to be copied into the repository.

## Implemented slice

Zoidium now ships the text part as Text+ v15. The plugin adds horizontal
spacing and the openzoid bevel controls to the native Text property list, then
rebuilds Text geometry from typeface outlines with `THREE.ExtrudeGeometry`.
Text+ character meshes use the same outline path and spacing calculation.

The staged r91 patch is also in place. It adds `bevelProfile`, `bevelRound`,
`bevelSizeInner`, and `bevelShift` to `ExtrudeGeometry` only in disposable
runtime or deployment stages. The fetched cache and the repository stay free
of modified CM3 runtime files. Sequence and camera DOF remain future work.

## The base really is shared

The fork's `UPSTREAM-DIFF.md` claims the base is upstream openzoid at CM3
`core-1.0.102` / `ui-1.0.72` / `three.r91`. That holds against the build
Zoidium currently fetches:

| File | Cached live build | Fork | Relationship |
| --- | --- | --- | --- |
| `core-1.0.102.js` | 462,630 B, minified, 1 line | 942,354 B, 22,039 lines | same source; the fork is a prettified snapshot |
| `three.r91.min.js` | 534,113 B, `REVISION="91"`, MD5 `dbc882ea9757ed00f9c4bdbfaef851af` | 1,080,486 B unminified | cached file is byte-identical to official `three@0.91.0/build/three.min.js`; the fork is official r91 plus a header |
| `ui-1.0.72.js` | 363,921 B | 604,422 B | same source, one patched line (`PZ_ICONS`) |

The decisive check is the unmodified code, not the version string. The live
`renderSequence` body is the same logic as the fork's pre-patch function:

```js
// .zoidium-resources/core-1.0.102.js (minified, live)
renderSequence:function(e){this.ratio=this.readBuffer.width/this._sequence.properties.resolution.get()[0],
this.renderer.clearTarget(this.accumBuffers[0],!0,!0,!0); ... }
```

and the fork only inserts the depth clear, the `dofAperture` read, and the
`globalDofActive` branch into that same shape (`core-1.0.102.js:15995-16047`).
The same is true for every anchor a port needs:

| Anchor | Live cache | Fork uses it at |
| --- | --- | --- |
| `PZ.compositor` constructor (passes, buffers, `setSize`) | present, char 325,600 region | new DOF members |
| `PZ.compositor.prototype.reset` (render targets) | present, char 325,045 | `16286`, `16296` |
| `PZ.compositor.prototype.renderLayer` | present | `16077`, depth rows added |
| `PZ.compositor.prototype.compositeScene` | present | unchanged |
| `PZ.layer.propertyDefinitions` | present, char 367,792 | `18243` (`depth`) |
| Base layer property list (`... opacity, blending ...`) | present, char 368,194 | `18100` (`depth` added) |
| `PZ.sequence.propertyDefinitions` | present, char 363,033 region | `17845` (five `dof*` keys) |
| `PZ.object3d.camera.propertyDefinitions` | present, char 439,049 region | `21251` (three `dof*` keys) |
| `PZ.object3d.text.propertyDefinitions` | present, `"Bevel size"` region | `20797` (spacing + bevel) |
| `PZ.object3d.text.prototype.updateGeometry` | present, uses `THREE.TextGeometry` | `20656`, replaced |
| `THREE.SceneDof*`, `dofQuad`, `depthBuffer`, `sceneDepthBuffer` | absent (only the unrelated `accumParams.depthBuffer:false`) | all created by the fork |

Every layer type extends `PZ.layer` (`PZ.layer.scene=class extends PZ.layer`,
`PZ.layer.composite=class extends PZ.layer`, and the same for adjustment and
shape), so the base class is a single insertion point for a layer-wide
property. The base layer's property list is an inline object inside the
constructor, so the `Depth` property is added by wrapping the property-list
construction (or the layer `load` path) rather than by editing a static
definition object.

Zoidium has already proved that this kind of patch works:
`plugins/core/text-shape-winding.js` replaces
`THREE.ShapePath.prototype.toShapes`, `plugins/core/render-aspect-ratio.js`
wraps `renderSequence`, `renderLayer`, `compositeScene`, and `unload`, and
`plugins/core/temporal-render.js` and `plugins/layer-input/layer-input.js` wrap
`renderSequence` and `renderLayer` too. All of it runs from `preInitScripts`,
which `zoidium/runtime-loader.js` loads after the CM3 entry script and before
`initTool()`.

## (A) Per-camera depth of field - portable

The fork adds `THREE.SceneDofShader` and `THREE.SceneDof`
(`core-1.0.102.js:456-614`, 159 lines / 7.3 KB) plus one branch in
`EffectComposer.render`. The shader is a 32-sample golden-angle spiral
(`angle = fi * 2.399963229728653`) that unpacks RGBADepthPacking depth,
linearizes it for orthographic and perspective cameras, and weights each sample
by `sampleColor.a * ( 1 - abs( sampleBlur - centerBlur ) )` squared. It also
early-outs on `centerColor.a < 0.02`, which matters for Zoidium's transparent
2D content.

Port shape:

- copy `SceneDofShader` / `SceneDof` into a Zoidium module;
- add `dof`, `dofAperture`, `dofFocusDistance` to the cached camera
  property-definitions object (plain object assignment, in the style of
  `plugins/core/named-property-lists.js`);
- patch the camera object's `update` path to push `near`/`far`/`orthographic`
  into the pass, as the fork does at `18405-18440`;
- patch the composer render call so `dof.render(...)` runs when
  `pass.dof.enabled && !pass.globalDof`.

No minified-body surgery is needed for (A): everything is new methods plus
wrappers. This is the cheapest of the four features.

## (B) Sequence DOF and layer Depth - portable, one real risk

The fork's `dofQuad`, `renderDOF` (24 samples), `renderSceneDepth`, and
`compositeDepth` are all new methods and can be copied nearly verbatim. The
sequence properties are five keys appended to
`PZ.sequence.propertyDefinitions`; the layer property is one key appended to
`PZ.layer.propertyDefinitions` plus one entry in the base layer's property
list. The two new render targets are created in `reset()`, which Zoidium can
wrap (`render-aspect-ratio.js` already patches the compositor and its buffers).

The risk is `renderLayer`. The fork's version is an edited copy of the whole
method: it sets `this.sceneDepthReady = false`, assigns
`e.pass.globalDof = this.globalDofActive`, calls `renderSceneDepth` for 3D scene
layers, and calls `compositeDepth` before `swapScreenBuffer`. Zoidium already
has three independent wrappers on that same method:

- `plugins/core/render-aspect-ratio.js:364`
- `plugins/core/temporal-render.js:920`
- `plugins/layer-input/layer-input.js` (through its `renderSequence` context)

A fourth wrapper is mechanically fine (each plugin guards with its own marker
and delegates to the method it found), but the depth pass must observe each
layer after its content is composited and before the screen buffer swap, and
the aspect-ratio wrapper is already changing viewports and buffer patches in
that same window. This is the part that needs a rendered-frame test, not just
unit tests. Two mitigations: keep the depth composite inside a single wrapper
that is documented to run last (load order is fixed in
`zoidium/runtime-config.js`), or hook `compositeScene`, which the fork leaves
free.

Secondary considerations:

- DOF state lives on `pass.dof` and `compositor.globalDofActive`; the flag must
  be refreshed per frame so a disabled DOF cannot leave a stale blur.
- Export uses the same `renderSequence` path, so DOF reaches exports for free -
  but that also means the export-time resolution/DPR changes exercise the depth
  render targets, which must follow `reset()`/`unload()`.
- The initial `pass.dof` object has to be created for every composite/scene
  pass, because the live build has no `dofQuad`/`dofScene` members at all.

## (C) 3D text rebuild - portable, needs (D) first

The live text object is unchanged upstream code
(`new THREE.TextGeometry(text, {size, height, curveSegments, font,
bevelEnabled, bevelThickness, bevelSize})`), and the live
`PZ.object3d.text.propertyDefinitions` matches the fork's pre-patch version,
including `bevelSize` with the old `subtitle1: "size"` / `subtitle2:
"thickness"` labels, `min: .01`, `step: .1`. The fork's `createShapes()`
(`20597-20647`) walks the typeface.js outline itself, which is what makes
per-character `spacing` and multi-line text possible, and it uses
`THREE.ShapePath.toShapes()` - the exact call Zoidium already customizes in
`plugins/core/text-shape-winding.js`. That patch only takes over the
zero-argument form, which is the form `createShapes` uses, so the two compose
correctly.

Dependencies to plan for:

- `createShapes` needs the (D) bevel options; port (D) first.
- `plugins/text-plus/text-plus.js` patches `PZ.object3d.text.prototype.update`
  and builds its own per-character `THREE.ExtrudeGeometry` meshes. It reads
  the parent's material and visibility only and computes its own layout. The
  implementation now passes the Text object's `spacing` value into that
  layout, so the split characters keep the same horizontal positions as the
  rebuilt source geometry.
- `plugins/material-plus/uv-custom.js:256` already accepts both
  `"TextGeometry"` and `"ExtrudeGeometry"`, so UV normalization keeps working
  after the swap; its `options.extrudePath` guard stays valid.
- The property changes are ordinary `changed: PZ.object3d.text.changeFn`
  entries, so history and serialization behave like the fork's.

## (D) three.js `ExtrudeGeometry` extension - portable with an anchored patch

Both builds are the same r91 source (see the byte-level comparison above).
Against official r91 the fork's whole three.js diff is 11 hunks: a 7-line
header, 8 content hunks inside `ExtrudeBufferGeometry.prototype.addShape`, and
a trailing-newline change. The 8 content hunks touch these sites:

| Fork line | Cached original form | Change |
| --- | --- | --- |
| 27691-27695 | after `...bevelSegments:3,` @ char 378,227 | +5 defaults (`bevelProfile` 0.5, `bevelRound` true, `bevelSizeInner=bevelSize`, `bevelShift` 0, `bevelProfilePow`) |
| 27738-27739 | `y\|\|(v=q=x=0);` @ 378,610 | +`bevelSizeInner=0,bevelShift=0` |
| 27791-27801 | after `triangulateShape(...); ... a.concat(S);` @ 378,809 | +12 lines building `verticesSizes[]` per contour (holes use `bevelSizeInner`) |
| 27988-27991 | `var fa=q*Math.cos(W*Math.PI/2);U=v*Math.sin(W*Math.PI/2);` @ 379,245 | 2 -> 4 lines (profile power, flat taper, `-bevelShift`, `bsInner`) |
| 28012 | front hole cap call @ 379,438 | `bs` -> `bsInner` |
| 28028 | `U=v;for(...)ha=y?c(a[J],ea[J],U):a[J],A?` @ 379,474 | `bs` -> `verticesSizes[i]` |
| 28058 | stepped loop @ 379,708 | `bs` -> `verticesSizes[i]` |
| 28088-28091 | back bevel loop head @ 379,906 | 2 -> 4 lines |
| 28111 | back hole cap call @ 380,092 | `bs` -> `bsInner` |

This patch was reproduced against the cached file: all anchors matched with the
expected multiplicity, `node --check` passed, and the resulting geometry is
bit-identical to the fork's patched three.js across 13 option combinations
(shape with a hole; round/flat; profile 0.1/0.9; inner 0/4; shift +/-3; all
four; bevel off; `bevelSegments` 1), with the unpatched file as a control that
ignores all four options.

Three constraints follow:

1. The fork's patch text cannot be copied, because it addresses unminified
   identifiers. Anchors must be minifier-stable strings; a re-minification of
   the same source with terser 5.51.2 breaks 4 of the 8 naive anchors, but the
   chosen identifiers (`void 0!==b.bevelThickness?b.bevelThickness:6`,
   `void 0!==b.bevelSegments?b.bevelSegments:3,` with a backreference for the
   options parameter, the literal `THREE.ExtrudeGeometry: vec does not exist`,
   the two bevel loop heads, and the two mid-cap calls) survive it.
2. The patch cannot live in the repository. `AGENTS.md` keeps CM3 runtime
   files in the Git-ignored cache or generated outputs, so the right home is a
   stage-time rewrite driven from `tools/runtime-resources.js` (the same file
   that already owns staging and bootstrap injection), failing loudly when an
   anchor is missing.
3. A three.js-only patch is inert until the text caller passes the options, so
   (C) and (D) ship together.

Lower-risk alternative if anchor maintenance becomes a burden: stage the
official unminified `three@0.91.0/build/three.js`, where the fork's patch
applies verbatim, at the cost of a ~1 MB uncompressed script. A runtime
wrapper of `Ia.prototype.addShape` is technically possible but not advisable:
the bevel amounts are computed inline with minified locals, so a wrapper would
have to reimplement the whole extrusion body.

## (E) Offline embedded assets - blocked by design, and unnecessary

The fork embeds 41 shaders, 44 effects, 4 materials, 122 icon symbols, 28
fonts, 36 particle textures, and the av/tar WASM plus worker sources as base64
in seven files (~10.4 MB), then falls back to those variables whenever a
`fetch` or `new Worker` would fail.

Zoidium already serves every one of those over HTTP in all three modes (web
server, Electron, packaged stage). The cache holds 177 verified resources,
including 28 `assets/fonts/2d/*.ttf`, 39 GLSL files, 36 particle PNGs, 44
`effect/*.js`, 4 `material/*.js`, 6 `worker/*`, and the 122-symbol
`pz.icons29.svg`. Worker files are written byte-for-byte with
`importScripts("tar_init.js")` intact, and `worker/av.wasm` (3,512,844 B) and
`worker/tar.wasm` (883,145 B) are byte-identical to the fork's copies. The
icon sprite is a declarative `<use xlink:href="pz.icons29.svg#id">` reference,
not a `fetch`, so it needs no inline injection.

Two independent reasons not to port (E):

- `AGENTS.md` puts CM3 workers/WASM, fonts, shaders, textures, and icons
  outside the repository ("only in the Git-ignored cache or generated
  outputs"), and a committed `bundle.json` is a repository artifact. The one
  in-repo asset exception is the non-CM3 Source Code Pro font.
- `file://` is banned with a stated technical reason ("workers/WASM require an
  HTTP origin"), and the fork's Blob-URL worker trick exists only to work
  around `file://`. It also replaces worker construction inside
  `core-1.0.102.js`, which Zoidium does not own.

The plugin bundle builder could technically carry the payload (no size guard;
images and text are base64-embedded, and a 3.2 MB single-line bundle parses in
~2.5 ms with ~3.3 MiB resident), but that is a size and policy question, not a
port. If offline resilience is ever a product goal, generate the embedded
assets at build time inside the disposable stage only (`dist/web/`), the way
`tools/build-afterclip-plugin.js` consumes an external pack.

## Effort, order, and verification

| Work item | Size | Browser-free test |
| --- | --- | --- |
| (A) camera DOF shader + pass wiring | ~300 lines | shader construction, uniform mapping, enable/disable |
| (B) sequence DOF, depth map, `Depth` property, render targets | ~450-600 lines | depth normalization math, RT lifecycle on resize/unload |
| (C) text `createShapes` + property additions | Implemented | outline walk, spacing, multi-line offsets, property list contents |
| (D) staged three.js anchored patch | Implemented | anchor presence and multiplicity, geometry parity |
| boundary review, docs, `assetVersion` bump | small | `pnpm run verify` |

Zoidium's `node --test` suite already stubs `PZ` and `THREE` heavily
(`test/material-plus-uv-custom.test.js`, `test/text-plus.test.js`,
`test/temporal-render.test.js`), so the math and property work can be covered
the same way. The parts that genuinely need rendered frames are the
`renderLayer` depth composite and the DOF look itself.

Remaining work:

1. Port (A). It is self-contained, touches no minified body, and delivers a
   visible feature quickly.
2. Port (B), in one clearly owned wrapper, after resolving the interaction with
   `render-aspect-ratio.js` and `temporal-render.js`.
3. Do not port (E). If offline is a product goal, design it as a build-time
   generated stage instead.
