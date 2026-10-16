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

Contents kinds:

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
wraps to vertex zero. `vertexModes` records editor constraints and does not modify evaluated
tangents during rendering.

The native stopwatch and key button on **Path** operate on every channel in one
history transaction. CM3's existing dynamic.group implementation supplies the
aggregate timeline diamonds. Shape+ hides its component timeline rows while
retaining their native tracks and keyframes for history and Graph+. Expand Path
in Objects to inspect and edit the individual numeric channels. Easing+ and Graph+
use those ordinary scalar channels, without an interpolation patch.

This was verified against the actual cached CM3 browser runtime: a four-vertex
path has 24 channels; native key actions produced keys at 0, 15 and 30 on all
24; undo removed the middle key on every channel and redo restored it. Exactly
one Path property track remains visible. The preview editor keeps topology
synchronized across every Path key. A Path added through native Contents starts
as a four-vertex rectangle; the Pen starts a new one-vertex open path.

## Native Objects panel

Select a Shape+ clip and open CM3's **Objects** tab. The top half shows the
ordered Contents tree. Groups expand into their own contents. The native **+**
menu adds Group, Rectangle, Ellipse, Polystar, Path, Fill, Stroke, Gradient Fill,
Gradient Stroke, Trim Paths, Repeater and Round Corners. Native row controls
clone or delete items. Drag to reorder or nest items, right-click a name to
rename it, and use the eye button to enable or disable it. These edits use
CM.history. Clone assigns fresh IDs; deletion undo retains the originals.

Select an item to show its native properties in the bottom half, including
ordinary animation stopwatches, keys and gradient controls. A selected item is
the keyframe panel's root, including deeply nested paths. The normal Edit tab
keeps clip/layer properties and does not repeat the contents tree.

The model still uses `PZ.objectList` with the Shape+ Content factory. A transient
`layer.objects` alias satisfies CM3's existing Objects `objectMap`. Only the two
Objects panel instances have amended child filters. Their original decisions
for every non-Shape+ list remain intact. Scoped native row hooks expose clone,
delete and enabled actions. All hooks, buttons, selection listeners and toolbar
commands are removed on disposal. `contents`, schemaVersion 1 and renderVersion
1 stay unchanged, so no saved-data migration is needed.

## Editing on the main preview

Selecting a Path, Rectangle, Ellipse, Polystar, gradient or Repeater in Objects
shows its controls over the main CM3 preview. No window opens, and double-click
on a clip has no Shape+ launcher. The overlay draws only editing guides; CM3
continues to own and render the preview canvas in its original parent.

The viewport toolbar has **Shape+ path controls (V)** and **Shape+ pen (P)** next
to CM3's camera and transform buttons. V selects the path tool, or toggles its
controls off when already selected. P enables the Pen. These keys are unused
by the native toolbar. **T** returns control to CM3's layer transform widget;
V or P resumes path editing. Shortcuts ignore text and native property inputs.

- Pen click adds a corner; drag pulls symmetric handles. Alt/Option breaks a
  handle, and Shift constrains it to 45 degrees. Click the first anchor to
  close. Enter/Escape finishes an open contour. Click a segment to insert an
  exact cubic split; click an existing anchor to delete it. Insertion, deletion
  and reversal update every animated Path key without flattening metadata.
- Select click/Shift-click selects anchors or handles. Drag empty preview space
  for a marquee. Drag anchors together, drag individual handles, or drag a
  segment to bend it with its endpoints fixed. Double-click an anchor toggles
  Corner/Smooth. The right-click native select menu also offers Symmetric,
  Independent, Close/Open and Reverse, plus static primitive conversion.
- Arrows nudge selected anchors or handles by one local pixel, or ten with
  Shift. Repeated keydown events through keyup make one history entry.
  Cmd/Ctrl+A selects path anchors. Delete removes anchors or selected items.
- Rectangle/Ellipse corner handles resize about the center. Shift keeps size
  square. Drag a selected shape's interior to move it. Star handles adjust
  radius. Gradient start/end and Repeater anchor handles edit native animated
  values. Snapping uses other anchors within eight CSS pixels. There is no
  separate grid, pan, zoom or preview renderer.
- Use the native Path row stopwatch and key button for grouped animation.
  Cmd/Ctrl+Z, Y and Shift+Z use the shared native history. Each pointer gesture
  creates one history entry. Selection and hover do not create project edits.

Coordinates use the visible preview canvas rect, including letterboxing, then
invert layer position/scale/rotation and every nested group anchor/transform.
Negative scales are supported. Player+ quality changes backing resolution,
not pointer coordinates. Handles stay the size and gray colors of the native
2D widget, independent of preview quality and display pixel ratio.

Escape, pointercancel, capture loss, window/focus loss, playhead or projection
change, selection/project replacement, target deletion and disposal cancel the
complete gesture and release capture/history ownership. The selected native
row follows stable IDs when topology edits or undo reconstruct the contents.

Editing is available for a single direct Shape+ clip in the active sequence.
It hides in perspective/editing-camera contexts, outside the clip's time span,
with disabled/singular content transforms, or when the layer has effects.
Composites, arbitrary effect inverses, free transforms and SVG import are not
implemented. Group/operator-generated artwork remains an evaluated result;
path controls edit the authored source geometry.

Geometry, topology, selection, pointer ownership and history remain bundled
CommonJS modules. The removed window canvas renderer, custom contents tree,
window CSS and launcher are no longer part of the bundle. Tests cover native
list commands against the optional cached host, projection math, cancellation,
animated topology and saved-data round trips.

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
changes retire and dispose the old mesh/target tree. One warm material per shader
variant stays alive until layer disposal, keeping Three from recompiling when
structural animation changes the command tree. This pool has at most three
materials, independent of frame count. Rendering different target resolutions can replace that cache without
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

Per-group blend modes, 3D geometry, SVG import and native Shape conversion
remain outside this round. No existing project is converted implicitly.

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


## Round 3 paints and operators

The plugin remains default-off. Existing schemaVersion 1 / renderVersion 1
projects use the original solid geometry path unless a new operator is present.
No native layer implementation changes.

Multiple fills and strokes each collect all paths above them in the same group,
including nested paths. Paint does not consume paths. Default Composite is
Below previous in same group, preserving bottom-to-top paint order. Above
previous places that paint over the earlier painted result in that group.
Trim and Round Corners resolve path dependencies before paint geometry, so a
modifier below a paint also changes that paint's eligible paths. Child paints
retain their own local coordinates and stroke widths under parent modifiers.

`trim` has animated Start/End in percent and Offset in degrees. Simultaneously
uses the same normalized interval on each eligible path. Individually uses
one concatenated length domain in top-to-bottom contents order, including
nested groups. Start/End may cross; their absolute difference defines the span
and the smaller endpoint defines its origin. Offset wraps in either direction.
A full 100 percent span stays closed; a zero span is empty. Wrapped closed
pieces join at the original seam and receive caps only at the trim ends.
Fills implicitly close each trimmed open piece.

Solid and gradient strokes support zero to three animated dash/gap pairs and
an animated offset in pixels. Pair count is discrete. Zero pairs means solid;
an all-zero active pattern is rejected. Every dash uses the selected cap;
a dash spanning a closed seam joins across it. All fragment outlines enter
one nonzero union before painting, including taper, caps and joins, so one
translucent stroke never darkens itself at overlaps. Separate paint items
still composite independently.

Taper measures Start/End Length as percentages of each full post-trim contour,
before dash splitting. Start/End Width are percentages of the base width at
the contour ends. A zero taper length leaves that end at full width. Each
endpoint blends toward full width with `pow(t, pow(2, ease / 50))`, with ease
bounded to -100 through 100. Overlapping start/end profiles multiply. Wave
multiplies this width by `max(0, 1 + amount/100 * sin(2*pi*(cycles*s/L +
phase/360)))`. Units chooses Cycles over that contour or Wavelength in pixels.
Phase is degrees. Closed contours use their authored first vertex as origin;
noninteger cycles and unequal taper endpoint widths can deliberately make a
width seam. Dashes retain the original contour's profile coordinates.

`gradientFill` and `gradientStroke` are planar linear/radial paints. Start/End
points, opacity and radial Highlight Length/Angle are ordinary numeric
animation channels. Radial radius is the Start-to-End distance; Highlight
Length is a signed percentage of radius, clamped inside the circle, and its
angle is relative to that axis. Gradient coordinates follow complete group
and painted-repeater transforms. A repeater before paint leaves one shared
paint coordinate system over the compound paths.

Colors use native CM3 type 5 GRADIENT and the native gradient picker. Canonical
stop storage is `[{position: 0, color: "rgba(255,77,26,1)"}, ...]`, in a native
dynamic property's keyframes. Stops animate with native hold keys, never
numeric array interpolation. The picker adapter supplies local clip time to
its frame-less get/set methods and retains native history/address handling.
The compiler accepts 2 through 16 stops, sorts a copy stably, clamps channels,
and validates finite values. One generic WebGL1 gradient program uses uniform
stop arrays, independent of shape and frame. It explicitly interpolates
premultiplied encoded sRGB RGBA. This matches CM3's existing encoded-sRGB
source-over compositing, rather than introducing linear-light colors only
for gradients. Transparent stops contribute no hidden RGB. Solid paints keep
the original shader and output.

`repeater` copies all paths and painted results above it. Copies before a later
paint become one compound path for that paint; copies after a paint transform
the complete painted result, including its gradient and local stroke width.
Copies includes the original index zero. Index `i` uses exponent `i + offset`:
position is multiplied by that exponent, rotation by the exponent, and scale
is raised to that exponent around Anchor. Positive rotation follows Shape+
coordinates. Composite Above draws later copies on top; Below draws them
behind earlier copies. Start/End Opacity linearly interpolate across copy
indices. Each painted copy isolates its complete result before applying its
opacity. Fractional Copies fades the final painted copy by the fraction.
Opacity ramps and fractional fading apply to painted results; a later paint
sees the complete compound geometry. Fractional exponents with negative scale
and negative exponents with zero scale are rejected with an English message.

`roundCorners` rounds sharp authored vertices using tangent circular cubics.
Radius clamps each cut to half the available adjacent segment lengths.
Existing smooth vertices and generated flattening samples remain smooth.
The operator handles paths, rectangles and stars, including duplicate corner
vertices in the original polystar construction. Curved neighboring segments
retain their authored controls; exact circular fillets against arbitrary
curved segments are not claimed.

The native Objects add menu includes every new item. The split panel keeps the
contents tree above the selected item's scrollable native properties. Gradient
start/end points and Repeater anchors have preview handles. Handle drags and
segment bends use the same cancellable history transaction as path edits.

Additional budgets are 128 copies per repeater, 2048 live path instances,
2048 dash fragments, 4096 sampled points per width-profile fragment, 16384 total width samples, 4096
expanded command visits, and 16 gradient stops. Existing total path, triangle,
arrangement and render-target budgets still apply. The overlay adds no WebGL
renderer, image cache or render targets.

The ordering reference is Adobe's [shape attributes and operations guide](https://helpx.adobe.com/after-effects/desktop/drawing-painting-and-paths/shapes-and-shape-attributes/shape-attributes-paint-operations-path.html).
