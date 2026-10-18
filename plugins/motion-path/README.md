# Motion Paths

Motion Paths edits native CM3 Position animation in the main preview. It is
an external Zoidium extension layer and starts enabled. Use the viewport's
**motion paths** button or **O** to show or hide paths. Visibility is remembered
in `localStorage` under `zoidium.motion-path.visible`; it is not project data.
Plain O is unused by the native viewport/timeline tools and other Zoidium
viewport tools. Ctrl+O still opens a project.

## Editing

- Select a layer clip in the timeline and turn on layer transform controls
  with T. Shape+ layers also show their path while Shape+ selection or pen
  editing is active. Both overlays stay usable.
- For 3D, select objects in the Objects panel. Paths work through nested,
  rotated and scaled groups, in the editing camera and scene camera views.
  The standard and centered viewport layouts use the same controls.
- Position must have at least one animated axis. The blue line follows the
  native animation, dots mark frames, squares mark the union of axis key
  times, and the white ring marks the playhead.
- Click a square to select it, Shift-click to toggle it, and drag to move the
  selected keys. Shift during a drag constrains movement to the dominant
  parent-space axis. Selection is local to this overlay. It does not change
  the timeline or Graph Editor 2 key selection.
- Drag a yellow tangent handle to bend the animation. Alt-drag a handle to
  break its continuous tangent. Alt-click a key toggles its adjacent linear
  and bezier segments. Alt-drag a linear key pulls out a smooth tangent,
  using its outgoing side, or its incoming side at the last key.
- Escape cancels the whole drag. A lost pointer capture, window blur, playback,
  selection change or plugin shutdown commits the visible edit. Each edit is
  one undo entry. Ctrl+Z and Ctrl+Y use native undo and redo.

Only squares and tangent endpoints consume pointer input. The rest of the
viewport remains available for Shape+, layer/object transforms, camera
navigation and timeline scrubbing. Paused drawing, inactive clips and export
hide paths. Paths are editor canvases and are never part of a rendered frame.

## How handles map to CM3

CM3 has one temporal curve per axis and no spatial interpolation. A visible
handle component is `dv * correction`, in sequence pixels for layers or parent
units for objects. `dv` is `controlPoints[side][1]`. `correction` is CM3's
`min(1, segmentLength / (abs(dtOut) + abs(dtIn)))`. There is no additional
spatial scale. Handle sizes and hit targets use CSS pixels regardless of
preview quality or device pixel ratio.

Dragging changes value offsets and preserves time offsets. Continuous tangents
mirror the temporal slope, `dvOther = dv * dtOther / dt`, preserving asymmetric
time handles. Alt breaks continuity on all editable axis keys at that frame.
A touched linear segment converts to native bezier, initially with its old
straight-line slope. Hold segments remain holds. When all axes share time
handles the result is a spatial cubic. With different timing/easings per axis,
the yellow handles describe the individual temporal controls; the sampled blue
path remains the authoritative trajectory.

A key drag materializes missing keys on every editable axis at the edited
frames and their neighbouring path frames. Static axes become constant keyed
channels before the move. Bezier insertion splits the native temporal cubic
without changing its values; hold and linear insertion also preserve values.
For other native easing presets, inserted keys retain the following key's
easing, so insertion can alter the timing within that segment.

3D drags use a plane through the key, perpendicular to the camera direction.
The world displacement returns through every parent transform into Position's
parent coordinates. Parent transforms are evaluated at each sample's time.

## Storage and compatibility

The plugin writes only native Position keyframe fields: `animated`, `frame`,
`value`, `tween`, `controlPoints` and `continuousTangent`. No spatial curve,
custom object type or rendering state is serialized. Older Zoidium builds and
CM3 can render the edited native channels without this plugin. Installing or
showing it never rewrites existing animation. Disabling it keeps edits.

## Limits

Expression-driven axes are read for drawing but never edited. A group-level
Position expression suppresses the path. Singular parent scales suppress 3D
paths because an inverse drag mapping is undefined. Custom controllers that
apply additional transforms outside native Position/Rotation/Scale are not
represented by the parent mapping. Perspective and spatial image effects on a
2D layer are not inverted; the path describes its native Position before those
effects. Dense paths can have overlapping handles. Drawing bounds long spans
to 1,500 path samples and omits frame dots beyond 900 frames. Native key squares
remain available across the visible clip span.

## Development

`motion-path.js` loads bundled CommonJS modules. `curves.js` and `path-edit.js`
contain pure evaluation and edit planners; `projection.js`, `targets.js` and
`overlay.js` build the drawing; `interaction.js` owns pointer gestures;
`edit-session.js` records native history; `runtime.js` owns the toolbar and
lifecycle. Run `node --test test/motion-path-*.test.js`, bump the manifest
version, run `node tools/build-plugin-bundles.js`, then `pnpm run verify`.
