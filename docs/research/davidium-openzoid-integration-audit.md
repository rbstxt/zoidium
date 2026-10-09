# Davidium OpenZoid changes and Zoidium integration audit

> This report records the initial audit. Follow-up fixes are documented in
> [the implementation report](davidium-integration-fixes.md). Source links now
> point to the repaired working trees; initial failure descriptions are historical.

Research date: 2026-10-01. This report audits the local files supplied by the
user. It recommends integration work; it does not merge runtime files.

## Source identity and comparison scope

The authoritative donor for this report is
`/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main`, abbreviated
`O` below. The sibling Zoidium checkout at
`/Users/dia/Projects/GitHub/Davidium/zoidium` is `D`. The current target working
tree at `/Users/dia/Projects/GitHub/Zoidium` is `Z`. Links to `O` and `D` refer
to these exact local files, including uncommitted changes.

`O` has no `.git` directory. Both Zoidium checkouts have the remote
`https://github.com/rbstxt/zoidium.git`. `Z` HEAD is
`1d643a2c0f07da342df0fc2320c94bdb491cdfe0`; `D` HEAD is
`0faf124f681dd8ea378ddc5ec49b132c875ef062`. Neither HEAD describes the full
local modifications. In particular, the current target's modified Effector
implementation must count as existing work.

The public OpenZoid source at
[blulere/openzoid commit b2ad06b](https://github.com/blulere/openzoid/commit/b2ad06bdd82f704c181fd0247778aae55b3129d2)
provides a useful original source baseline. Its README is byte-identical to
the local README. GitHub reports no license for that repository, and its
[README](https://github.com/blulere/openzoid/blob/b2ad06bdd82f704c181fd0247778aae55b3129d2/README.MD)
attributes the original runtime to Panzoid. This baseline is not an identified
Davidium GitHub fork. The latest remote Davidium OpenZoid revision remains
unverified; the local files are sufficient for the requested local audit.

Git blob comparison against that baseline finds exactly five added effects:
Datamosh, Echo, JPEG Damage, Posterize Time, and VHS. Existing effect sources
match the baseline except `effect/transform.js`, which adds `THREE.DoubleSide`.
Existing material changes are `custom.js` and `texture.js`; `nodes.js` and
`pbr.js` are new. `singlecolor.js`, `video.js`, and the four worker scripts
are unchanged. This avoids treating the entire copied CM3 resource tree as
new work. The baseline comparison found 111 changed core line ranges,
34 UI ranges, seven Clipmaker controller ranges, and nine three.js ranges.
The review groups these changes by behavior; counts include small formatting
differences, and nearby ranges combine into one unified-diff hunk.

Selected local SHA-256 identities:

| File under `O` | SHA-256 |
| --- | --- |
| `core-1.0.102.js` | `a9cd36b97c2bebc55895799469b5d8d4a292fe5bb72263dc37fe46f532600504` |
| `ui-1.0.72.js` | `152c7935732631029f40e482c09f38c21dd8f089e640e32e8833937f3e25b6b1` |
| `nodes.js` | `fcdd4978c6557429cd8a80ef9c58e808c38d9d6483f5000aa4984ff822821234` |
| `material/nodes.js` | `8c2cd1e09bc61ed527d1883fbab48b8033c868f6576a469bad77c43a204afa0a` |
| `material/pbr.js` | `856b48bd79fdf9c17749d7b75f63a86790e832e895d52d57648bc9afc35cb57f` |

## First inventory of changes still missing or incompletely ported

"Raw only" means absent from both the current target and the donor's declared
plugin sources. "Donor plugin" means already extracted in `D`, but absent or
incomplete in `Z`. These are different integration jobs.

| Change | Location and evidence | Current status | Recommendation |
| --- | --- | --- | --- |
| Procedural Node Material and 31-node graph evaluator/editor | [O/nodes.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:1270), [material/nodes.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/nodes.js:198) | Raw only. Material+ declares Matcap, PBR+, UV Custom, with no node material | Improve runtime and UI before porting |
| Node graph baked into PBR channels | [O/material/pbr.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/pbr.js:607) | Raw only. PBR+ texture maps are not graph support | Improve alongside the graph evaluator |
| Expanded Custom Material | [O/material/custom.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/custom.js:574) | Raw only. Replaces the native `custom` implementation | Extract selected additions into a new material type; discuss serialized compatibility |
| Expanded PBR Material | [O/material/pbr.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/pbr.js:737) | Partially overlaps PBR+; ramps, procedural bump, Fresnel, cel shading, projection and reflection controls remain missing | Port small deterministic features first, retain PBR+ IDs |
| Animated GIF image decoding and project-time seeking | [O/gif.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/gif.js:292) | Raw only | Improve lifecycle and time mapping, then extract as a media module |
| Image material transparency and opacity | [O/material/texture.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/texture.js:172) | Raw only | Good early implementation candidate through a small extension patch |
| Graph Editor 2 | [O/graph-editor-2.0.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/graph-editor-2.0.js:1) | Raw only. Easing+ is complementary and does not contain this replacement | Discuss editor scope; refactor before adoption |
| Expression parser/property additions | [O/core](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:958) | Raw only except Camera+ implements its own focus helper | Split implemented helpers from advertised stubs; improve context handling |
| Voronoi Fracture object | [O/core](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:22708), [D/deformer-objects.js](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/deformer-objects.js:154) | Extracted in donor Effector+, absent target Effector | Discuss intended fracture quality; then integrate into target Effector |
| Media composition metadata persistence | [O/core](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:19951) | Raw support missing from donor Precomp+ | Required fix before Precomp+ integration |
| Video-track 3D/mute persistence | [O/core](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:18839) | Raw `track3d` support missing from donor Camera+ serialization | Required round-trip fix before Camera+ integration |
| Per-camera and sequence DOF, layer depth, film/projection/vibrate, camera layers and 3D footage tracking | [O/core](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:16370), [D/camera-runtime.js](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1428) | Extracted in donor Camera+, missing from target | Use donor plugin as starting point, do not port core twice |
| Reel Smart Motion Blur controls and video blur/warp history | [O/core](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:16570), [D/render-layer.js](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/render-layer.js:179) | Donor Camera+ ports the history ring | Defer the temporal branch until deterministic sampling is defined |
| Composition panel, switching, precompose, source reveal and clip context actions | [O/ui](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/ui-1.0.72.js:8538), [D/comps.js](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:194) | Donor Precomp+, missing target | Fix metadata and non-destructive editing model first |
| Particular, Form, Plexus, C4D lights, shared designer | [O/clipmaker.html](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/clipmaker.html:2084) | Donor Trapcode Suite, missing target | Covered by plugin audit, not raw-only |
| Optical Flares renderer/editor | [O/clipmaker.html](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/clipmaker.html:2089) | Donor Optical Flares, missing target | Covered by plugin audit, not raw-only |
| Five legacy effects, VHS/Datamosh setup, export mosh | [O/clipmaker.html](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/clipmaker.html:2082) | Donor Setup Legacy, missing target | Covered by plugin audit, not raw-only |

The offline resource layer, copied source page, worker/font/shader/material
payloads, source CSS inlining, popup download changes, experimental media
files and development server scripts are also unique local changes. They
are not suitable repository merge candidates under Zoidium's resource and
download boundaries. This is a deliberate exclusion, not an overlooked port.

## Node Material: a seeded evaluator does not make the material deterministic

The evaluator rebuilds its seeded noise lattice for each call. Its graph
cache is local to one evaluation, and graph cycles return `null` rather than
recursing forever. The 31 node types cover output, noise/ridged/turbulence,
gradient/color/checker, image/texture, Fresnel, arithmetic/comparison,
spectra/blackbody/random color, color processing, projection, and UV transforms.
The six texture outputs are color, luminance, roughness, metalness, bump,
and opacity. Fresnel has a separate settings path. Sources are
[types](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:794),
[seeded noise](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:61),
and [graph evaluation](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:1383).

The material caches the wrong thing. Both
[Node Material update](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/nodes.js:237)
and [PBR update](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/pbr.js:680)
bake only when the requested time differs from the last baked time by at
least 1/15 second. The cached image remains from whichever time was visited
previously. A paused refresh can also change the image after an asynchronous
asset finishes loading because `onReady` rebakes from mutable `pzTime`.

A source execution probe confirmed the history problem. It evaluated the
actual graph code and the actual extracted Node Material `update()` body
with a minimal canvas/property environment, using an animated default graph
with `speedX = 1` and a 30 fps project:

| Probe | Output |
| --- | --- |
| Direct evaluator at `t = .05`, before and after evaluating `.10` | Both texture hashes `242bd8547e15` |
| Material update at frame `1.5`, cold state | Texture hash `789a77bcd4f0`, last baked time `0` |
| Material update at frame `3`, then frame `1.5` | Texture hash `dbce2507021e`, last baked time `.1` |

The hashes are the first 12 hexadecimal digits of SHA-256 of the 16 by 16
RGBA color buffer. This proves a cache-history defect without claiming a GPU
render comparison. A deterministic 15 fps optimization would use a time key
such as `floor(t * 15) / 15`, then always evaluate that exact time. Prefer
project-frame caching or an explicit quality setting so export does not
silently inherit a 15 fps texture animation limit.

Further required fixes:

- [isAnimated](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:1367)
  checks animated `noise` and cached GIF `image` only. Source execution
  returned `false` for `ridgedFractal` and `turbulence` with `speedX = 1`,
  though their evaluator accepts time and their controls expose speed.
- [Node Material prepare](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/nodes.js:133)
  is empty. Graph image loads begin inside evaluation. Export must await
  graph assets before rendering; a temporary fallback is not a final frame.
- [Image cache](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:726)
  uses the asset key alone, shares state between materials, and reads a
  GIF's current globally selected frame. Include project identity and
  requested time, and release asset references when no material uses them.
- Graph edits call `properties.graph.set()` after a 40 ms timeout.
  [Commit](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:1707)
  does not use the editor's undo operations. Define one undo entry per
  gesture, graph schema/versioning, duplicate-ID/port validation, and a
  bounded node count before integrating imported graph JSON.
- The [editor](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/nodes.js:1472)
  opens a blank browser popup, clones host CSS, and falls back to a fixed
  in-document overlay with Open Sans. Use Zoidium window/dialog ownership,
  local Source Code Pro, keyboard access, focus restoration, scoped styles,
  and cleanup on disable/project replacement. Popup UI must be optional.

Suggested packaging is a `material-pack` with a declared graph runtime
module, embedded editor styles, and a stable new material ID. Reuse the
existing bundle asset resolver and project asset system. Do not import
`embedded-materials.js` or register a copied native CM3 implementation.

## Material changes should be decomposed

The raw Custom Material replaces the behavior of published `custom`.
Raw PBR uses `pbr`, while Zoidium publishes `pbrplus`. Replacing either
existing target type without a migration changes old projects. Current
[PBR+ source](/Users/dia/Projects/GitHub/Zoidium/plugins/material-plus/pbr-plus.js:297)
already supports PBR parameters, map slots, reflection intensity,
transparency, alpha test and UV tiling. It does not implement the donor's
graph editor, color ramps, procedural bump controls, Fresnel, AO tinting,
cel shading, procedural projections or separate reflection/specular layer.

Raw [Custom Material](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/custom.js:3)
and [PBR Material](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/pbr.js:3)
duplicate much of this expanded behavior. Consolidate their shared code
rather than shipping two near-identical new runtimes. Their procedural
bump uses a reset seeded generator, so it is a reasonable independent port.
Ramps, Fresnel, projection and cel shading are also plausible deterministic
increments after shader compilation and frame-order tests.

The advertised AO modifies lighting from a texture or bump map; it is not
scene-space occlusion. The shader explicitly falls back to bump-map
luminance in
[custom.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/material/custom.js:108).
Ask the author whether this appearance is intended before presenting it
as a new general AO feature. Validate reflection/specular scaling and
transparent blending against the target r91 runtime, including Text+,
Effector, Matcap and UV Custom coexistence.

Image material opacity is a much smaller change. It adds a `transparent`
option, an animated `opacity` property, initialization, and per-frame
opacity assignment. It introduces no timeline history and no separate
editor. Extract those additions through a property/material hook and add
save/load validation; do not copy `material/texture.js` into the repository.

## GIF images and their time model

[gif.js](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/gif.js:97)
implements decoding, frame disposal/composition, image textures, and
render/viewport hooks. `seek()` selects a decoded frame from cumulative
durations using modulo project time, including negative time normalization.
This is a suitable starting point for deterministic image animation.

The current model advances every GIF asset with the same project time.
It does not independently apply each clip's offset, time remap or nested
composition time. The graph image evaluator reads `gif.current`, not its
own requested time. Therefore decide whether GIFs should be project-global
animated materials or clip-local animated media. A single asset shared by
two differently timed clips requires separate evaluation state. Test
variable GIF frame delays, disposal modes, negative seeks, GIFs reused in
multiple clips, nested compositions, image materials and graph textures.
Keep external asset loads in the project system, and await decode before
export. The raw wrappers need uninstall/disable handling and clear errors.

## Expression and dynamic property changes

The local core extends the parser argument list with `property` and `value`,
allows `Math`, and adds a custom `MemberExpression` emitter. Evaluation
passes the current base value and property object, writes current frame,
property and value into shared `PZ.expression.methods`, and exposes
`PZ.expression.prototype.methods`. Dynamic scalar/group classes separate
`getBaseValue()` from expression evaluation. Sources are
[parser](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:958),
[context](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:1072),
and [dynamic properties](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:6112).

New helpers include `focusDistanceTo`, `valueAtTime`, identity `property`,
seeded harmonic `wiggle`, `_propertySeed`, `_wiggleVector`, formatting and
angle conversions, and quadratic easing aliases. `loopIn`, `loopOut`,
and `pingPong` simply return their first argument. The ease aliases ignore
their other arguments. These are explicit stubs or narrower semantics,
not completed After Effects expression compatibility. See
[helpers](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:1181).

Port each helper with defined units and examples. `wiggle()` uses the current
frame as its default time and adds noise to the current base value. Its
property seed hashes a serialized address, so moving the property/object
can change the result. Nested evaluations can overwrite the shared context.
Save and restore the evaluation context or pass it explicitly. Test scalar
and vector base values, recursive references, `valueAtTime()` on groups,
expression ordering, object reordering, nested evaluations and repeated
forward/reverse seeks. Discuss expected loop/easing semantics with the author
before enabling those names. Camera+'s existing focus helper should become
one shared implementation, not a conflicting second registration.

## Voronoi Fracture: discuss the intended geometry contract

The donor Effector+ contains the same Voronoi implementation as the raw
local core. An extracted-class comparison is exact after removing the
different final comma/semicolon. This is a missing target feature, not
a raw-only unported donor feature.

The raw class seeds cells, subdivides triangles, assigns each triangle's
centroid to the nearest cell and creates fragment surfaces with capped
boundary loops. It is an approximation of volume fracture, not exact
Voronoi-plane clipping. Sources are
[subdivision](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:22720),
[assignment](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:22822),
and [caps](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:23100).
It allows up to 200 cells, subdivision depth five, and an outer triangle
budget of 98,304 before caps. That can be expensive on animated upstream
geometry because it compares all positions and rebuilds cells when they
change.

The movement itself uses seeded vectors and current-frame distance,
scatter, spin, offset and field values. It does not integrate a physics
simulation through previously played frames. Its cache therefore has a
plausible deterministic design, but the port must correctly restore
source geometry/materials and invalidate topology. Multi-material meshes
take a different path, and cap UVs duplicate one boundary vertex's UV.
See [fractureGeometry](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:23222).

Discuss whether an approximate visual breakup is the desired product,
what non-manifold/thin/text meshes should do, and whether fragment IDs
must remain stable while source geometry animates. Then add a namespaced
object to the existing target Effector pipeline. Do not restore the raw
numeric object table or overwrite the target's newer Twist/Warp code.
Existing target [Effector](/Users/dia/Projects/GitHub/Zoidium/plugins/scene-plus/README.md:1)
already restores mesh positions before frame evaluation and handles
generated Repeater output, so it is the correct integration point.

## Graph Editor 2 and small UI changes

Graph Editor 2 replaces `PZ.ui.graph`, its grid and `PZ.ui.graphEditor`.
It adds fit/frame, normalized view, snap, keyframe addition/deletion,
interpolation presets, easing sampling, hold display, ruler scrubbing,
zoom/pan, legend visibility, tooltips, status, labels and keyboard nudges.
The file header claims API compatibility, but this is a roughly 110 KB
replacement with global CSS/prototype ownership. Compatibility needs
tests rather than relying on that claim. It uses `Date.now()` to throttle
status UI; that alone does not change timeline rendering.

Current Easing+ wraps keyframe controls, property operations,
`correctCurve` and keyframe scaling, with uninstall support. Graph Editor 2
must cooperate with those modifications, protect the same Bezier handles,
and clean up observers and animation loops. Decide whether it belongs
as a selectable alternative editor, an incremental native graph patch,
or a full replacement. A host editor-registration API would be safer
than unconditional reassignment. Source is
[Graph Editor 2](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/graph-editor-2.0.js:1),
with target [Easing+ lifecycle](/Users/dia/Projects/GitHub/Zoidium/plugins/easing-plus/easing-plus.js:1737).

Smaller raw UI changes include property-list `displayName`, definition-level
action buttons, a custom `getValue` reader, a camera helper refresh callback,
and a 1280 by 800 graph-window default. Current named property lists already
cover naming; Camera+ supplies focus buttons/actions and helper behavior.
Carry only genuinely missing pieces. File-protocol style copying, inline
CM3 CSS and popup download fallback conflict with the target architecture.

## Raw serialization changes are prerequisites, not optional polish

OpenZoid adds `isComp`, `compLength`, `compSource` in `PZ.media` construction,
load and serialization. Donor Precomp+ calls `m.load()` with those keys,
but does not patch the target's native media load/serialization. Its
`listComps()` identifies compositions through `m.isComp`, so merely porting
the panel can fail even before saving. Current project-file handling does
not add these fields to native media objects. Add explicit extension-owned
metadata and migrations or wrappers before integrating the panel.

OpenZoid also adds video `track3d` and enabled state to track load/serialization,
and ignores disabled tracks in update. Donor Camera+ changes `track3d` in
memory and adds UI buttons, but needs persistent serialization support.
Test save/open, restore backups, duplicate tracks, precompose, linked
media, cross-plugin disabling and composition switching. Relevant raw
evidence is [track persistence](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:18839)
and [media persistence](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:19951).

The extra render-order and camera-ancestor matrix updates, transform-video
scene ownership, layer rotation X/Y/depth/motion-blur fields, sequence
camera sharing, film-system options, and vibrate/shake migration belong
to the Camera+ port. The original blur ring is a serious exception.
It writes a new texture and increments `_mbHead` on every render, with
no frame-key lookup. The same requested time can sample different
"previous/next" images according to playback order. Define sample times
and request exact decoded frames, or omit the history mode initially.
Source is [raw blur](/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main/core-1.0.102.js:16609)
and [donor blur](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/render-layer.js:179).

## Already integrated work and deliberate exclusions

- Native text spacing and bevel controls, typeface outline creation, and
  staged `ExtrudeGeometry` bevel extensions already exist in target Text+.
  The target [portability note](/Users/dia/Projects/GitHub/Zoidium/docs/research/openzoid-dof-text-portability.md:43)
  records parity, and [runtime-resources.js](/Users/dia/Projects/GitHub/Zoidium/tools/runtime-resources.js:840)
  patches only generated stages. No second text port is needed.
- Twist/Warp already exist in the modified target Effector, including
  source-position restoration and subdivision controls. Donor Effector+
  cannot replace that newer implementation wholesale.
- Target Matcap/PBR+/UV Custom, layer inputs, temporal rendering, local
  download, named property lists and native deterministic Echo/Posterize
  are existing capabilities. Similar donor names are not proof of missing
  implementation.
- `PZ.workerURL` and embedded font/texture/shader/effect/material lookups,
  copied `download.html`, FileSaver-style legacy flow, copied CM3 icons,
  embedded workers/WASM/fonts and CSS inlining are excluded. Preserve
  the single configured source fetch/staging path and in-place Blob download.
- VHS import reference projects, plugin dumps, downloaded AMV/video/GIF
  samples, screenshots, `_aex_extract`, and experiment HTML are research
  assets, not shipping Zoidium source. Inspect provenance before any asset
  reuse. The added external effects/fonts retain their own rights holders.

Before distributing extracted code, identify which additions the donor
author wrote and which include third-party or Panzoid code. The public
baseline has no declared open-source license; the source README itself
distinguishes Panzoid rights. Obtain compatible permission/attribution for
the new additions and keep complete runtime resources out of the checkout.
This is especially relevant to whole Custom Material replacements,
Graph Editor 2, embedded libraries and named third-party effect recreations.

## Validation performed and integration acceptance criteria

Performed read-only inventory and hunk comparison, checked source identities,
executed the graph determinism probe above, and ran `node --check` on raw
core, graph runtime, GIF runtime and Graph Editor 2. These passed syntax.
No browser pixel or export comparison was performed by this audit. The
minimal canvas probe proves a material cache defect; it cannot establish
visual quality, GPU compatibility or full project round-trip behavior.

For each port, lock the project, assets, properties, seed, resolution and
render settings, then compare output at a target frame from cold state,
forward playback, reverse playback, shuffled seeks, repeated stationary
renders and a fresh reopened project. Include fractional subframes used
by motion blur. Compare preview and export through the same evaluator.
Invalidate caches by input identity and revisions, never by last visited
time alone. Asset readiness may change a loading state, but export must
wait for it and cache keys must include the resolved asset revision.

Priority order is Image opacity and small material features, shared
serialization support, deterministic graph runtime, graph window/editor
integration, GIF time mapping, then fracture and full editor replacement
after discussing their contracts. Camera+/Precomp+/Trapcode/Optical Flares/
Setup Legacy should follow the separate plugin audit rather than repeating
their raw core changes. Run `pnpm run verify` and staged `build:web` after
actual integration, inspect the generated tree, and keep fetched resources
out of source control.
