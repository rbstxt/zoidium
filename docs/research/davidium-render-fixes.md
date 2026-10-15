# Davidium render and asset fixes

Date: 2026-10-01. These changes repair the local donor implementations under
`/Users/dia/Projects/GitHub/Davidium/zoidium` and selected raw implementations
under `Davidium/openzoid-main/openzoid-main`. No CM3 source/resource files were
copied into the destination Zoidium checkout.

## Implemented

### Legacy Echo and Posterize Time

The legacy effect IDs and serialized parameter names remain stable. Posterize
Time now declares a host `posterize-time` operator using the saved `frameRate`
property. Its selected source frame is calculated from project time, rather
than from the first frame rendered within a bucket.

Echo now declares a host frame sampler with preceding one-frame source
intervals. Its existing shader still implements smear, maximum, additive,
screen, threshold and weighted mixing. GPU targets only hold the current
composition of explicitly prepared samples; rendering no longer pushes input
frames into playback history. The renderer restores `autoClear` even if drawing
throws. `clearOnJump` remains a recognized saved property but is hidden because
there is no playback-history state to clear.

Echo follows the host's existing limit of 16 temporal samples. The control and
request both clamp to 16, including old saved values above this limit. This is
an intentional performance/compatibility change. Existing projects that relied
on seek history, incomplete startup history, or the former tap indexing defect
will look different. The now-explicit source-time semantics are suitable for
further integration; they should be described in release notes.

Echo and Posterize declare their required plugin APIs in the source manifest.
The copied CM3 `shaders/common.glsl` and its manifest resource were removed.
Echo and Jpeg Damage obtain the shared vertex shader through the host asset API
and require their effect fragment shaders to exist in the bundle. Posterize
Time no longer needs a GPU shader/pass. Jpeg Damage now sets premultiplied alpha
and disposes its material and quad geometry when unloaded.

### Form and Plexus

Form now retains awaitable requests for its model, mask and enabled layer maps.
Its `prepare(frame)` starts required loads, awaits them, then rebuilds that
requested frame. Failures reject preparation rather than treating random
fallback geometry as a completed frame. Asset wrappers are released after
CPU geometry/pixel data has been copied. Requests carry identities so an older
load cannot overwrite a newer selected asset or repopulate an unloaded object.
Layer-map caching uses a Map, avoiding property-name collisions for asset keys.

Form's base geometry cache now includes axis counts, base type, base dimensions,
model scale, selected model/mask and string-generation controls. Changing grid
shape with the same total particle count or seeking animated dimensions no
longer reuses the previous base geometry. Nonfinite and excessive axis counts
are bounded before grid allocation and reduction loops.

Plexus likewise awaits selected OBJ/JSON and image inputs before updating the
requested frame. Both loaders invalidate by the selected asset key, discard
outdated completion, copy required CPU data and release temporary asset
wrappers. Removing the selected asset clears its previous sample. Disposed
Form/Plexus roots are not resurrected by a pending preparation operation.

Live analyser-based audio behavior in either plugin has not been redefined.

### Optical Flares

Flare light projection and occlusion are recalculated in THREE's
`onBeforeRender` callback after CM3 has updated the scene objects. This removes
the earlier object-list update-order dependency. A 3D-sourced flare enters the
render list even when its earlier projection was outside the view; the final
projection then determines brightness. Mesh collection runs against the
current scene, instead of an object-count cache that missed replacements and
nested topology edits. Invisible ancestry and flare overlay quads do not count
as occluders.

Rendering reads designer state only from an active
`PZ.opticalflares.previewContext` belonging to that flare root. Solo filtering
uses the preview's element Set both in shader data and visibility checks.
Normal/editor/export evaluation without that scoped context ignores designer
preview state. The matching editor scope is implemented separately in the UI
fixes.

### Raw Node Material and PBR graph channels

Both raw materials now cache the exact requested time when a graph is animated.
They no longer compare the current time to the last visited bake using a
1/15-second threshold. Cache signatures also include the parsed graph,
resolution and image dependency revisions. Property-edit rebakes default to
the latest requested time rather than zero.

The shared evaluator recognizes speed-driven `ridgedFractal` and `turbulence`
nodes as animated, alongside `noise`. Image caches are isolated by project,
so identical asset keys in different projects do not share loaded images or
GIF metadata. Asset readiness and GIF frame changes invalidate dependencies.
Graph-image preparation is awaited by the material preparation methods.
Canvas conversion errors remain failures. Unload guards prevent asynchronous
image-ready callbacks from recreating disposed material textures.

Node Material reuses existing CanvasTexture objects during rebaking, as the
raw PBR implementation already does. Loading an image preserves its native
canvas dimensions, avoiding the former accidental reuse of whichever bake
resolution first requested it.

GIF time ownership and shared-asset clip offsets remain a separate design
question. These cache fixes do not claim to define GIF temporal semantics.

## Validation

The donor's focused tests execute the actual effect declarations, Echo pass
and selected Form/Plexus/Flare class methods with controlled asynchronous
assets and symbolic GPU textures:

- `test/legacy-temporal.test.js`: canonical Posterize source selection,
  seek-order-independent Echo sampling and repeated draws without history.
- `test/render-readiness.test.js`: late model completion, awaited maps/OBJ,
  asset failure propagation, bounded counts and same-count mesh replacement.
- Existing temporal API, temporal-render and Native FX Echo tests.

All 30 tests in that focused run pass. Raw
`test/node-material-time.test.cjs` separately executes both materials' update
functions and the actual shared node evaluator. All 6 tests pass, covering
cold/direct/forward/reverse/repeated requests, same-time dependency edits,
animated-node detection and project cache isolation. Changed JavaScript files
pass syntax checks.

These are scheduling, readiness and cache regressions, not GPU pixel tests.
Full shader rendering, premultiplied-alpha comparison, export parity and editor
integration still require runtime visual validation. Final bundle regeneration
and repository-wide verification belong to the combined change set.

## Decisions still required

Datamosh/VHS history, Particular CPU simulation, camera video blur and live
analyser audio still need explicit source-time/replay contracts. Pausing a
history update or clearing on reverse seek would not repair their
nondeterminism. Those algorithms were not replaced with guessed semantics.
Precomp composition/audio behavior and approximate Voronoi fracture geometry
remain separate product/design decisions. The raw material implementations
still need plugin packaging, serialization/UI review and runtime validation
before they can be added to Zoidium.

## Follow-up: composition load transactions

The donor `plugins/precomp-plus/comps.js` now prepares incoming tracks in
separate parented object lists. It awaits track and nested layer loading before
replacing either displayed track list. Loading failure, a replaced project,
a competing switch or plugin teardown discards the draft. Schedule failure
restores the previous tracks, length and links. Successful replacement unloads
the old tracks while retaining the parent project required for asset release.

`switchTo`, `restoreIntoSequence`, `newComp` and `precomposeFromSelection` are
now asynchronous. Callers that use their result must await it. Panel deletion
waits for returning to Main before removing an active composition. New media
is fully loaded before automatic switching or precompose source removal, and
failed new media is removed.

Main snapshots include native `clipLinks` metadata. Main save serialization
uses that snapshot without swapping displayed tracks. Composition snapshots
carry their own `compClipLinks` using the host's `{ links, seed }` format; the
runtime metadata adapter preserves the field. Unchanged composition snapshots
do not open empty history operations. Linked clips across compositions and
full precompose undo/reference behavior remain unresolved.

The expanded `test/precomp-plus.test.js` passes all 10 tests. It covers nested
loading, load/schedule rollback, concurrent switches, project replacement,
Main serialization and link restoration, single-call serialization failure,
new-media failure cleanup and watcher restoration. These tests validate the
transaction and save boundaries, not the broader composition product model.

## Follow-up: nested expression context

Raw `core-1.0.102.js` saves and restores `currentFrame`, `currentProperty` and
`currentValue` around every expression evaluation, including thrown or nested
evaluations. Original property descriptors and absent keys are restored. This
repairs shared-context corruption without implementing the advertised loop or
easing stubs. `test/expression-context.test.cjs` passes three tests for nested
scalar/vector values, failure restoration and repeated/reverse requests.
Combined with the six material tests, the raw focused suite passes 9/9.
