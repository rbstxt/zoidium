---
title: Easing+
description: Edit incoming Bezier easing segments with presets, crossing handles, vertical overshoot, and CSS cubic-bezier copy and paste.
---
Use **Easing+** to edit the normalized cubic Bezier curve between the previous keyframe and the keyframe at the playhead.

## Edit an incoming curve

The first keyframe has no incoming segment. Move the playhead to a second or later keyframe first.

1. In **Plugins**, enable **Easing+**.
2. Move the playhead to the segment's end keyframe.
3. Set that keyframe's interpolation to Bezier.
4. Click the **Easing+** button in the property's keyframe row.
5. Drag the curve handles, pick a curve under **Presets**, or enter exact values in **Out X**, **Out Y**, **In X**, and **In Y**.
6. Close the window (or press Escape) to commit the curve as one undoable edit.

While **Easing+** is enabled, moving keys or changing key values rescales edited handles to keep the same normalized curve shape. Equal start and end values keep the segment flat.

## Copy and paste curves

- **Copy** (Ctrl+C, or Cmd+C on macOS) writes the curve as CSS `cubic-bezier(x1, y1, x2, y2)` text.
- **Paste** (Ctrl+V, or Cmd+V on macOS) accepts `cubic-bezier(...)` text, four numbers separated by commas or spaces, or a JSON array of four numbers.

Keyboard shortcuts work while the Easing+ window has focus and no numeric input is active.
Pasted horizontal values clamp to `0` through `1`; vertical values stay as pasted (preserving overshoot).
If the browser blocks clipboard reading, Easing+ falls back to the last curve you copied. Close the window to commit the pasted curve as one undo step.

## Cross handles and add overshoot

- **Crossing handles:** Drag either handle horizontally within `0` to `1`. You can move the outgoing handle past the incoming handle to create steep S-curves.
- **Vertical overshoot:** Drag a handle more than `40` screen pixels past the top or bottom border of the graph, then release while that side is armed to expand the vertical range. Drag again into the expanded area. Moving back within `24` pixels before release disarms that side. Curves that already have overshoot open with that side expanded.

## Coordinate reference

| Field | Range | Step | Meaning |
| --- | --- | --- | --- |
| **Out X**, **Out Y** | X: `0` to `1`, Y: unbounded (supports overshoot) | `0.001` | Outgoing handle on the segment's start keyframe. |
| **In X**, **In Y** | X: `0` to `1`, Y: unbounded (supports overshoot) | `0.001` | Incoming handle on the segment's end keyframe. |

For multi-keyframe curves and tangent tools across tracks, see [Graph Editor 2](/docs/animation/graph-editor/). Both editors share the same native Bezier handles.
