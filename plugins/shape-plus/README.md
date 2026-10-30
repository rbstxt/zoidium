# Shape+

Shape+ is an external extension layer for CM3. It is enabled by default in the
Scene Extensions pack. Use the Shape+ Media preset or Add Layer entry.
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
menu lists every Contents kind with its icon: Group, Rectangle, Ellipse,
Polystar, Path, Fill, Stroke, Gradient Fill, Gradient Stroke, the path
modifiers, Repeater and Merge Paths. Native row controls clone or delete items.
Drag to reorder or nest items, right-click a name to rename it, and use the eye
button to enable or disable it. These edits use CM.history. Clone assigns fresh
IDs; deletion undo retains the originals.

A fill or stroke draws every enabled path above it in the same group,
including paths in nested groups above it (the After Effects rule). New layers
therefore start with a "Rectangle 1" group that holds a Rectangle and the Fill
below it. The **+** menu does not append at the end of the list, where a new
path would sit below the fill and draw nothing. Shape+ places each item with
`contents-ops.js` `planAdd` instead, in one undoable history step:

- Geometry added outside a group gets a new top-level group ("Rectangle 2",
  "Shape 1", ...) with its own Fill, so it is visible immediately.
- Geometry added inside a group, through that group's Contents **+** or with
  the group or one of its items selected, goes to the top of the group, where
  the group's paints already draw it.
- Paints, modifiers, Repeater and Merge Paths go to the bottom of the context
  group, below the paths they act on. A root-level selection keeps the root.

The add panel closes as it does natively and the new item, or the new group
that wraps it, becomes the Objects selection. The filter box, arrow keys and
Enter keep working. Lists of other CM3 objects keep the native add handler.

Rows in the top half make paint scope visible. Fill and stroke rows show a
10 px swatch after the name: solid for fills, a hollow ring for strokes, and
the color stops for gradients, sampled at the clip's current local frame.
Dim hints mark items that draw nothing: "no fill or stroke" on an enabled path
no enabled paint draws, and "no paths above" on an enabled paint with no
enabled path in scope. Hover the name cell for the rule. One
requestAnimationFrame loop refreshes swatches and hints while Shape+ rows
exist. It recomputes scope only when ids, kinds, enabled flags, nesting or
order change, follows animated colors, and stops on disposal.

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

While a single Shape+ clip is selected, the main CM3 preview is the Shape+
selection tool. Shapes can be clicked and dragged directly, whether or not
Objects is open; selection on the preview and in Objects stay in sync. No
window opens. The overlay draws only guides; CM3 continues to own and render
the preview canvas in its original parent.

The viewport toolbar has **Shape+ selection (V)** and **Shape+ pen (P)** next
to CM3's camera and transform buttons. V toggles the Shape+ tool off when it
is already selected. **T** returns control to CM3's layer transform widget
for moving the whole layer; V or P resumes Shape+ editing. Shortcuts ignore
text and native property inputs.

- Selection follows After Effects. Hovering outlines what a click would pick.
  The first click on a shape selects its outermost group; inside a selected
  group, clicks pick items at that depth. Double-click enters the group and
  selects the drawn leaf (a path then shows its anchors); double-click on
  empty space or Escape steps out to the containing group, and a second
  Escape (or a click on empty space) deselects. Shift-click toggles items.
  Dragging empty space draws a marquee that selects top-level items, or
  anchors while a path is open for editing.
- Dragging a selected shape, or empty space inside the selected box, moves
  the selection: groups, rectangles, ellipses and polystars edit Position, and
  paths move every vertex. Shift constrains the drag to 45 degrees. A selected
  group's descendants are carried by the group, never moved twice.
- One selected group, rectangle, ellipse or polystar shows a bounding box.
  Corner and edge handles scale with the opposite side fixed; Alt/Option
  scales about the center and Shift keeps proportions. Groups edit Scale and
  compensate Position; rectangles and ellipses edit Size and Position;
  polystars scale both radii. The round handle above the box rotates groups
  about the box center and polystars about their position; Shift snaps to 15
  degrees. A selected Fill or Stroke outlines exactly the paths it draws.
- Pen click adds a corner; drag pulls symmetric handles. Alt/Option breaks a
  handle, and Shift constrains it to 45 degrees. Click the first anchor to
  close. Enter/Escape finishes an open contour. Click a segment to insert an
  exact cubic split; click an existing anchor to delete it. A new contour goes
  into the selected group, otherwise into a new "Shape N" group with its own
  Stroke and Fill. Insertion, deletion and reversal update every animated Path
  key without flattening metadata.
- On a path open for editing, click/Shift-click selects anchors or handles.
  Drag anchors together, drag individual handles, or drag a segment to bend it
  with its endpoints fixed. Double-click an anchor toggles Corner/Smooth.
- Right-click selects what is under the pointer and opens one Shape+ menu:
  path point types, Close/Open and Reverse, Convert to Path, Add Fill/Stroke
  to the group, Group/Ungroup, Bring Forward/Send Backward, Rename, Duplicate
  and Delete. On empty space it adds a rectangle, ellipse or polystar at the
  pointer. The menu suppresses the browser's own menu.
- Arrows nudge selected anchors or handles by one local pixel, or ten with
  Shift; with no anchors selected they move the selected items in their
  parent space. Repeated keydown events through keyup make one history entry.
  Cmd/Ctrl+A selects path anchors, Cmd/Ctrl+D duplicates, Cmd/Ctrl+G groups,
  Shift+Cmd/Ctrl+G ungroups, Cmd/Ctrl+] and [ reorder. Delete removes anchors
  or selected items. Gradient start/end and Repeater anchor handles edit
  native animated values. Snapping uses other anchors within eight CSS pixels.
  There is no separate grid, pan, zoom or preview renderer.
- Use the native Path row stopwatch and key button for grouped animation.
  Cmd/Ctrl+Z, Y and Shift+Z use the shared native history. Each pointer gesture
  creates one history entry. Selection and hover do not create project edits.

Coordinates use the visible preview canvas rect, including letterboxing, then
invert layer position/scale/rotation and every nested group anchor/transform.
Negative scales are supported. Player+ quality changes backing resolution,
not pointer coordinates. Handle sizes are CSS pixels, independent of preview
quality and display pixel ratio.

Only Escape, undo during a drag and an editing error roll a gesture back.
Interruptions keep the edit the preview already shows and record it as one
history entry: pointercancel, capture loss, a release outside the window,
window/focus loss, playhead change, tool or selection change, target deletion
and disposal. Layout or projection changes mid-drag do not end a gesture.
A transaction replaced by other code mid-drag is recorded as its own entry
afterwards. The selected native row follows stable IDs when topology edits or
undo reconstruct the contents.

Editing is available for a single direct Shape+ clip in the active sequence.
It hides in perspective/editing-camera contexts, outside the clip's time span,
with disabled/singular content transforms. Effects keep editing enabled;
handles map to pre-effect layer space, so a spatial effect may move the image
away from its authored handles. Composites and free transforms remain outside
the editing contract. Group/operator-generated artwork remains an evaluated result;
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

Layer transforms are rasterized continuously. When a Shape+ layer has no
effects and its composite transform is purely 2D (no X/Y rotation and no Z
offset), the position, Z rotation and scale written to the layer's composite
group (by CM3 or by Camera+) are baked into the Shape+ camera, and the group is
reset to identity for that composite. Contents are therefore drawn in
composition space at full resolution instead of being rasterized at layer size
and magnified, so edges stay sharp at any Scale. The flattening tolerance uses
the baked scale. Isolation planes stay screen-aligned, because child targets
are rendered with the same camera. Content outside the layer frame that the
transform brings into view is now visible, like a continuously rasterized
vector layer in other compositors. Layers with effects keep the previous
behavior: effects work on the untransformed layer frame, which CM3 then
transforms and resamples. A zero scale is left to the compositor.

CM3 calls the layer pass on every animation frame, even while idle. Shape+
keeps the supersampled targets between calls and redraws them only when the
commands, target size or baked transform change. Every call still resolves
into the shared destination buffer.

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

Per-group blend modes and 3D geometry remain outside this release.
No existing project is converted implicitly.

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

Existing schemaVersion 1 / renderVersion 1
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
width seam. Dashes retain the original contour's profile coordinates. Width sampling uses at
least 128 intervals over the full contour and 32 intervals per wave cycle,
plus existing flattened path vertices. This is a bounded sampled profile;
subpixel width error is not promised for extreme stroke widths.

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

## Final-round modifiers

All new items are available through the native Objects **+** menu, with native
rows, animation keys and monochrome icons. Storage remains schemaVersion 1 /
renderVersion 1. A project without new items retains its original evaluator.

- **Twist** rotates around Center by `Angle * radius / 100`, with Angle in
  radians internally and degrees in the UI. A point at radius 100 receives the
  authored angle. Resampling accounts for radius, angle and output tolerance.
- **Zig Zag** places two alternating Size extrema per ridge on each authored
  span, retaining endpoints. Ridges is a rounded integer from 1 through 64.
  Cubic spans are flattened and sampled by arc length before displacement.
  Smooth points use Catmull-Rom tangents raised to cubics.
- **Pucker & Bloat** uses the contour centroid. Positive Amount draws authored
  corners inward and edge midpoints outward with a cosine profile; negative
  Amount reverses the direction. Amount is limited to -100 through 100. This
  is an explicit sampled deformation, not a promise of identical Adobe curves.
- **Wiggle Paths** samples a seeded integer hash lattice with smoothstep
  interpolation in space and time. Detail sets spatial intervals; Size is the
  maximum coordinate displacement. Correlation blends shared and independent
  samples. Closed contours wrap the spatial lattice. Temporal/spatial phase
  are degrees; frequency is wiggles per second. Time is the requested local
  frame divided by project rate, including fractional and negative frames.
  No wall clock, mutable random stream or previous frame enters evaluation.
- **Wiggle Transform** uses the same noise for anchor, position, scale-percent
  and rotation offsets. Before a Repeater, each copy resolves its own seeded
  sample. Correlation 100 gives identical offsets to every copy. A painted
  result receives the transform once, including its paints and gradient frame.
- **Offset Paths** resolves the nonzero filled region of closed contours, then
  offsets it. Negative amounts may split or remove contours. Miter, round and
  exact bevel joins are supported; miter-limit overflow falls back to bevel.
- **Merge Paths** has Merge, Add, Subtract, Intersect and Exclude modes. Merge
  retains compound contours. Add unions all regions. Subtract removes the union
  of later contours from the first eligible contour. Intersect intersects all
  contours, and Exclude folds XOR in contents order. Open contours are refused.
  A topology item welds the eligible scope into one compound result, including
  preceding paints; gradients retain their local paint coordinate frames.

Nonlinear deformations resample before changing points, never merely move a
cubic's endpoints. Deformed geometry drops the original cubic controls. Later
Round Corners therefore works on the resulting flattened corners. Path guides
continue to edit authored source geometry before all modifiers and repeats.
Twist Center and Wiggle Transform Anchor have main-preview handles.

## Clipping and offset contract

The bundle embeds Clipper 6.4.2, JavaScript port 6.4.2.2, an extension of Vatti
clipping. See `vendor/README.md` for provenance, reviewed patches and the Boost
and JSBN notices, also embedded as bundle assets. There is no runtime download.
Coordinates quantize to a fixed 1/1024-pixel integer grid with symmetric half
ties away from zero. Nonzero winding resolves coincident/self-crossing edges;
strict simplicity separates touching polygons. Results retain outer/hole winding,
rotate to their lexicographically first point, then sort deterministically.

Stroke outlines generated from new modifiers are unioned through Clipper before
triangulation, within the existing 16384-outline-point limit. Uniform new strokes
use closed/open Clipper offset outlines directly. New resolved polygons use the
existing pinned Earcut 2.2.4 dependency with explicit hole ancestry; unresolved
self-intersections never reach Earcut. Sub-grid stroke artifacts are cleaned and
resolved again before triangulation. Existing stroke
paths retain their original floating-point arrangement.

Each modifier clipping input permits 4096 points and coordinates up to one million
pixels in magnitude. The intersection budget is 262144 events. Offset amount
is limited to 100000 pixels, its predicted arc work to 32768 points, and output
to 16384 points. Round arcs use the requested flatten tolerance, capped at 0.25
pixels and floored at one grid unit. The normal arrangement/triangle budgets
still apply afterward. Over-budget work fails explicitly. Deformation and smooth
subdivision retain the 4096-point per-contour limit. Thin features smaller than
the integer grid may disappear. These rules are independent of evaluation order.

## Native rows and workflows

Stroke/Gradient Stroke rows have collapsible Dashes, Taper and Wave sections.
A section starts collapsed when all its values are defaults and unanimated.
Only active dash pairs, the chosen wave unit, radial gradient highlights,
star-only inner controls and miter-only limits appear. The groups are transient
native list presentation; properties keep their original keys and addresses.

**Convert to Shape+** is a native list action on Shape, Text and Preset Shape
layers. It replaces the selected clip's object in one native history entry,
retaining clip timing/name/link/time channels, effects, layer transform,
opacity/blending and native paint/shape-transform key metadata. Undo restores
the original live native object. Native half-pixel transform pivots are kept
with static wrapper groups. Preset ellipse/rectangle and available OpenType
M/L/Q/C/Z outlines are supported; quadratics become exact cubics. Each native
child receives its parent paint operations separately, preserving translucent
overlap semantics. Text must finish loading. Opaque `.draw` callbacks, unknown
paint operations, unsupported presets and expression-driven shape data are
refused before changing the clip. Conversion is static for glyph outlines;
font/text content remains editable in the original after undo. Raster edges
can differ because Shape+ uses its own documented supersampling.

**Import SVG…** opens a local file picker from the native Contents/layer row.
Cmd/Ctrl+V accepts SVG documents or SVG path data when a Shape+ clip/item is
selected and the Objects panel or main preview has focus. Text fields and the
clip/keyframe panels keep native clipboard behavior. Contents Cmd/Ctrl+C/X/V
uses a versioned text envelope that retains animation/unknown fields and gives
pasted items/vertices fresh IDs. **Copy SVG path data** on a path/primitive row
copies its evaluated local contour as SVG text, with Y converted to SVG space.

SVG supports absolute/relative M/L/H/V/C/S/Q/T/A/Z, repeated command parameters,
rectangles with corner radii, circles, ellipses, polygons/polylines, groups,
affine transforms and basic solid fills/strokes with opacity, winding and up
to three dash pairs. Group opacity isolates. Affine matrices decompose into
native group rotations and signed scales, so transformed strokes keep their
local width semantics. Document viewBox centers the imported coordinate system;
its units remain pixels. Bare path data keeps its origin and gets a white fill.
Sibling paint order is retained. Arc conversion follows the W3C endpoint-to-center
formula with at most 45 degrees per cubic.

The restricted XML parser never inserts SVG into the DOM, evaluates code or
fetches resources. Scripts, external references, entities/declarations, text,
CSS classes/stylesheets, gradients, filters, clipping/masks and unsupported
attributes are explicitly refused. Text is capped at 256 KiB, elements/items at
512, XML nesting at 16, path commands at 4096, and vertices at 256 per imported
path. Native model item/depth budgets also apply after transform decomposition.
Nested SVG viewport sizing and viewBox-to-width/height scaling are not applied;
import geometry uses viewBox pixel units. A complex import can hit the model's
16-group-depth limit before reaching the XML limit.

The automatic-backup race found during rapid project replacement is handled in
`zoidium/project-restore.js`: a stale automatic archive is discarded and retried,
while manual-save failures and unrelated backup errors still report normally.

### Dense strokes and geometry failures

Small strokes keep the original floating-point union tessellation. Budgets
count work, never wall-clock time, so the same contents take the same path on
every machine and under any load; preview and export always match. If the
union's edge, intersection, or work budget is exhausted, Shape+ draws the same segment,
join, and cap polygons into an opaque coverage mask. A separate paint quad
applies the color, gradient, and opacity once. Self crossings therefore do not
accumulate opacity. Masks share one render target and repeated paint copies
share their coverage geometry.

A synchronous compile has a 200 ms deadline. The legacy stroke attempt gets
25 ms and topology modifiers get 75 ms within that deadline. Count limits also
bound allocations. A failed paint is omitted with one English warning per
item and error reason. Other valid paint items remain available. Content edits
invalidate the normal signature cache and automatically retry geometry.
Renderer failures restore the previous render target and clear settings.

## Text engine prototype

`text-engine.js` is an internal prototype for uncompressed variable OpenType
fonts. It provides HarfBuzz shaping, glyph outlines in font units, explicit
font error states, and a bounded outline cache. Existing runtime code does not
call this module. Shape+ has no live Text contents item or text editing controls.

The prototype compiles WASM only when `createLoader()`'s result is called.
Its bytes are embedded in the Shape+ bundle, so download delivery is not lazy.
WOFF, WOFF2, font fallback, and family/style selection are not implemented.
See `vendor/README.md` for dependency provenance and licenses.
