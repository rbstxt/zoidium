# Easing+

Easing+ is an optional CM3 extension that provides a focused easing editor for
Bezier interpolation (`interp_1`). Linear interpolation continues to use the
standard control. The edited interval is always the outgoing segment from the
current keyframe to the next keyframe; open Easing+ while the playhead is on the
segment's first keyframe. The compact editor opens beside the easing button and
commits edits as one undoable operation when it is closed.

The editor works in normalized 0–1 coordinates, then converts the two handles to
Panzoid's frame-relative and value-relative `controlPoints` representation.
Panzoid evaluates Bezier handles as absolute offsets, so any nonzero Y handle on
an equal-value segment would play back as an out-and-back motion. Easing+ instead
stores zero Y offsets there, so the segment always plays flat at its value, like
every other interpolation. CM3 Bezier handles open as the normalized Linear
default (`0.333, 0.333, 0.667, 0.667`) so the initial curve does not depend on
segment length.

While Easing+ is enabled, moving a keyframe (or changing its value) rescales the
absolute handles of the affected Bezier segments instead of leaving them in
place, so the normalized curve keeps its shape: handle X scales with the segment
duration and handle Y scales with the value span. Collapsing a segment to equal
values flattens its Y handles so it keeps playing still. Fresh native Bezier
handles (`[10, 0]` / `[-10, 0]`) and segments formed by reordering keyframes
keep native behavior.

Both handle X coordinates move independently across the full 0–1 interval.
While Easing+ is enabled, the editor preserves crossing handles for normalized
curves, so the saved native control points render and reopen with the edited shape.

Vertical overshoot is unlocked independently above and below the normal graph.
The first 40 screen pixels past a boundary stay snapped to that boundary.
Overshoot only arms after 40 pixels and must be released while armed. Returning
within 24 pixels disarms it, so setting a control point to exactly 0 or 1 never
enables overshoot by accident. Once a side is armed, release to expand that side,
then drag again into the expanded area. Curves that already contain values
outside 0–1 open with the matching side expanded. Changes are applied through
`PZ.ui.properties`, so a complete apply is one undoable history operation.
