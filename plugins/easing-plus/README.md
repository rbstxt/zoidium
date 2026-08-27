# Easing+

Easing+ replaces Panzoid's easing dropdown only when the current keyframe uses
Bezier interpolation (`interp_1`). Linear interpolation continues to use the
bundled dropdown. The edited interval is always the outgoing segment from the
current keyframe to the next keyframe; open Easing+ while the playhead is on the
segment's first keyframe. The compact editor opens beside the easing button and
commits edits as one undoable operation when it is closed.

The editor works in normalized 0–1 coordinates, then converts the two handles to
Panzoid's frame-relative and value-relative `controlPoints` representation. For
equal start/end values, it stores the curve as a deviation from the linear
baseline (`y - x`). A linear curve therefore stays still, while a non-linear
curve creates a finite out-and-back motion without dividing by a zero value span.
Untouched Panzoid Bezier handles open as the normalized Linear default
(`0.333, 0.333, 0.667, 0.667`) so the initial curve does not depend on segment length.

Both handle X coordinates move independently across the full 0–1 interval.
While Easing+ is enabled, Panzoid's automatic crossing-handle correction is
bypassed only for normalized curves whose handles cross, so the saved native
control points render and reopen with the edited shape.

Vertical overshoot is unlocked independently above and below the normal graph.
The first 40 screen pixels past a boundary stay snapped to that boundary.
Overshoot only arms after 40 pixels and must be released while armed. Returning
within 24 pixels disarms it, so setting a control point to exactly 0 or 1 never
enables overshoot by accident. Once a side is armed, release to expand that side,
then drag again into the expanded area. Curves that already contain values
outside 0–1 open with the matching side expanded. Changes are applied through
`PZ.ui.properties`, so a complete apply is one undoable history operation.
