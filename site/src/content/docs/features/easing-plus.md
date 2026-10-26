---
title: Set an incoming curve with Easing+
description: Edit a Bezier segment at its last keyframe, including crossing handles and vertical overshoot.
sidebar:
  label: Easing+
---
Use Easing+ for the curve between the previous keyframe and the keyframe at the playhead.

## Open the incoming segment

The first keyframe has no incoming segment. Choose a later keyframe before opening the editor.

1. In **Plugins**, enable **Easing+**.
2. Move the playhead to the segment's last keyframe.
3. In the property's keyframe row, select Bezier interpolation.
4. Click the easing button labeled **Easing+**.
5. Drag the curve handles, or choose a curve under **Presets**.
6. For numeric edits, adjust **Out X**, **Out Y**, **In X**, and **In Y**.
7. Close the window to commit one undoable edit.

The close button and Escape both commit the edit. To undo the committed curve, use the editor's undo command.

## Cross the handles

1. Drag either handle horizontally within the normalized 0 to 1 interval.
2. To cross the handles, move the outgoing handle past the incoming handle.
3. Close the window to save the curve.

While Easing+ is enabled, moving keys or changing their values rescales edited handles to preserve the normalized curve. Equal endpoint values keep the segment flat.

## Add vertical overshoot

1. Drag a handle more than 40 screen pixels past the top or bottom graph boundary.
2. Release while that side is armed to expand the graph.
3. Drag again into the expanded region.
4. Close the window to commit the curve.

Returning within 24 pixels before release disarms that side. A curve with existing overshoot opens with the corresponding side expanded.

For direct keyframe and tangent editing, see [Graph Editor 2](/docs/features/graph-editor-2/).
