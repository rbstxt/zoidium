# Shape+

Shape+ is a default-off external extension layer for CM3. Enable it in the
Scene Extensions pack, then use the Shape+ Media preset or Add Layer entry.
Native Shape, Text and Preset Shape retain their original implementations.

## Format and coordinates

The layer type is `zoidium:shape-plus/shape-layer`. Both `schemaVersion` and
`renderVersion` are `1`, independently of the bundle version. Coordinates are
composition pixels, centered at the origin with positive Y upward. The layer
extends `PZ.layer`, owns a Three r91 scene and orthographic camera, and renders
through the compositor's generic pass branch. Native layer transforms, opacity,
blending and effects operate on that image. Frame time comes from CM3, including
fractional sampler times and nested compositions.

Each item has a stable `id`, `kind` and native `properties`. A group also has an
ordered `contents` array. Cloning assigns fresh item IDs; deletion undo restores
the old IDs. Editor selection and GPU/cache state are never serialized. Unknown
item fields and unknown property keys survive the model's serializer. Supported
native properties use CM3's canonical serialization.

Contents kinds in round 1:

- `group`: anchor, position, scale, rotation and isolated opacity.
- `rectangle`: size, position and roundness, clamped to half the smaller size.
- `ellipse`: size and position, represented by four standard cubic spans.
- `polystar`: star/polygon, bounded rounded integer point count, inner/outer
  radius and roundness, position and rotation. Corner roundness cuts adjacent
  edges and connects them with a tangent cubic. Fractional AE point counts
  are not implemented.
- `path`: ordered `vertexIds`, `vertexModes`, static closed/open topology, and
  one dynamic `path` group with six scalar channels per vertex.
- `fill`: RGB color, opacity and `nonzero` or `even-odd` winding rule.
- `stroke`: RGB color, opacity, width, butt/round/square cap, miter/round/bevel
  join and miter limit. Excessive miters fall back to bevels.

Every numeric animation channel is an ordinary CM3 dynamic NUMBER property.
Vector/color values are native dynamic groups. Discrete mode/cap/join/fill-rule
choices and enabled/closed flags are static. Point count is evaluated as a
bounded rounded integer. Rotation is stored in radians, displayed in degrees.

## Path keys and native editing

The `path` property's group contains `[x, y, inX, inY, outX, outY]` for each
vertex in `vertexIds` order. Tangents are relative to that vertex. A segment is
`[point[i], point[i]+out[i], point[j]+in[j], point[j]]`; the closing segment
wraps to vertex zero. `vertexModes` records editing constraints for later rounds
and does not modify evaluated tangents.

The native stopwatch and key button on **Path** operate on every channel in one
history transaction. CM3's existing dynamic.group implementation supplies the
aggregate timeline diamonds. Shape+ hides its component timeline rows while
retaining their native tracks and keyframes for history and Graph+. Expand Path
in Edit to inspect and edit the individual numeric channels. Easing+ and Graph+
use those ordinary scalar channels, without an interpolation patch.

This was verified against the actual cached CM3 browser runtime: a four-vertex
path has 24 channels; native key actions produced keys at 0, 15 and 30 on all
24; undo removed the middle key on every channel and redo restored it. Exactly
one Path property track remains visible. Fixed topology is required while
animated. Vertex insertion/deletion and the dedicated pen editor belong to
round 2. A newly added Path starts as a four-vertex rectangle.

Edit contains native Contents add menus for all seven kinds, clone/delete
buttons, normal property rows and native structural history commands. Selecting
a content item makes that selection the keyframe panel's root. Even deeply
nested items therefore remain within the shared three-generation traversal
limit. The scoped UI hooks do not change other layer or object trees.

## Contents evaluation contract

`compiler.js` accepts evaluated plain data and allocates no host/GPU objects.
Its result contains flattened paths and ordered paint/isolation commands.

1. Collect eligible paths from top to bottom within each group. A paint sees
   every path above it in that group, including paths in nested groups above
   it. It never sees paths below it or in a sibling group outside its scope.
2. Paints render bottom to top. A nested group's own painted result participates
   at that group's contents position. Filling/stroking a path does not consume
   it, so a later paint can use the same path again.
3. Evaluate a group's own paints in its local coordinates, then transform the
   painted geometry. Parent paints see that group's transformed paths. This
   distinction preserves local versus outer stroke widths under group scale.
4. Group opacity isolates its complete painted result in a transparent target
   before compositing once. It does not multiply overlapping child alphas.
5. Disabled items remain serialized and contribute neither paths nor paint.
   Open paths are implicitly closed for fills and remain open for strokes.

## Geometry and antialiasing

The CPU engine uses plain CommonJS JavaScript loaded from the bundle, with no
npm runtime dependencies. Cubic evaluation/splitting uses De Casteljau. Adaptive
flattening bounds each control hull's distance to its finite chord, catching
collinear reversals as well as curved spans. Tolerance is 0.125 destination
pixels converted to local units, including group and layer scale. It never
uses UI zoom or previously rendered frames. Cumulative length tables use the
same flattened segments. Ellipses use the standard four-cubic approximation,
with roughly 0.0273% maximum radial error before flattening.

Fills use a horizontal segment arrangement. Slabs split at vertices and all
segment intersections; winding transitions produce disjoint trapezoids that
are triangulated. Holes, opposite winding, coincident contours and crossing
contours are explicitly resolved. This avoids feeding unresolved crossings to
an ear-clipping triangulator. Stroke segment rectangles, cap arcs and join
wedges go through the same nonzero union. Their interiors never overdraw, so
translucent joins, crossings and overlapping paths within one stroke paint do
not double-darken. Separate paint items still composite independently.

Meshes use r91 `BufferGeometry.addAttribute`, explicit `renderOrder`, disabled
depth testing/writes, and premultiplied RGBA throughout. Evaluated contents,
logical resolution and tolerance form the geometry cache key. Geometry changes retire and dispose the old buffers while retaining paint
materials and render targets. Paint-only edits update uniforms. Structural
changes retire and dispose the old mesh/material/target tree. Nothing accumulates across
frames. Rendering different target resolutions can replace that cache without
changing a later frame's result.

WebGL1 targets do not receive canvas MSAA. Shape+ renders at 4x per dimension
when the destination's largest dimension is at most 2048 and the target budget
allows it, otherwise at 2x. A box resolve uses four bilinear taps at 4x and one
at 2x. The decision depends only on explicit output dimensions and authored
isolation count. Large outputs retain 2x instead of exceeding the 4x memory
cost. There is no silent 1x fallback.

A thin cubic stroke was compared with Canvas2D at 640 x 360 on ANGLE Metal,
Apple M2, Chromium WebGL1. RMSE covers the nonzero-pixel union, in alpha bytes.
Timings include a synchronous 1-pixel readback after each draw, 30 batches of
10 draws after warmup; they are not isolated GPU timings.

| Sampling | Edge RMSE | Alpha levels | Median / p95 ms | Root RGBA target |
| --- | ---: | ---: | ---: | ---: |
| 1x prototype | 81.72 | 2 | 0.40 / 0.52 | 0.88 MiB |
| 2x prototype | 36.63 | 5 | 0.45 / 0.54 | 3.52 MiB |
| 4x chosen for this size | 30.39 | 17 | 0.95 / 1.27 | 14.06 MiB |

4x reduced edge RMSE by 63% relative to 1x and 17% relative to 2x. It costs
four times the target storage of 2x. Canvas2D remains an independent quality
oracle, not a hidden raster backend. Exact edge pixels can differ from Canvas
and across graphics drivers. Full-resolution captures were inspected alongside
1/8-resolution captures, including holes and translucent caps/joins.

## Bounds and round 1 limits

Validation bounds a layer to 512 items, 16 nested groups and 256 vertices per
path. Flattening rejects work above depth 24 or 4096 points per path. The
compiler allows 16384 collected points and 200000 output triangles across all
paints. Each polygon arrangement permits 4096 nonhorizontal edges, 65536
crossing levels and 16 million edge/slab visits. Stroke outlines are bounded
to 16384 vertices. Exhaustion rejects the operation instead of silently
violating tolerance or drawing unresolved geometry.

Intermediate targets are bounded to 64 million RGBA pixels in total, excluding
the host compositor. At 1920 x 1080, one 4x root is about 126.6 MiB. Isolation
adds full-size targets; the explicit budget can select 2x. A target exceeding
the renderer's maximum texture size or the 2x budget is rejected. Very complex
or heavily isolated layers can reach these limits before the item count.

Round 1 has solid paints and group opacity. It does not implement per-group
blend modes, gradients, path operators, topology editing, 3D geometry, SVG
import or native Shape conversion. No existing project is converted implicitly.

## Persistence and checks

Shared layer registration requires no numeric ID. Its picker entry and Media
preset dispose independently. Loaded layers track plugin usage, locking the
plugin while an active project uses it. Unknown namespaced layers load as
transparent placeholders, preserve the complete parsed layer payload through
save, participate in dependency detection and restore on their owning clips
when the plugin is enabled. Original JSON whitespace outside the parsed record
is not retained.

Unit tests are `test/shape-plus-*.test.js`. Browser QA scripts, measurements,
PNG exports and screenshots are external artifacts under `shape-plus/r1/`
in the implementation workspace. Browser checks cover native grouped path
keys/history, native contents editing, missing-plugin save/restore, native
Shape pixel comparison, Precomp+, temporal effects and the native image export
pipeline. Run `pnpm run build:plugin-bundles` and `pnpm run verify` after edits.
