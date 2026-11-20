---
title: Timeline and frame rate
description: Change sequence frame rate without shifting timing, trim multiple clips together, and manage linked timeline clips.
---
Zoidium extends the native CM3 timeline with multi-clip trimming, linked-clip cleanup, and frame-rate changes that preserve timing in seconds.

## Change the sequence frame rate without changing timing

When you change **Frame rate** in **Sequence**, Zoidium rescales supported clip boundaries, keyframes, and timing controls so your edit stays the same length in seconds.

1. Open **Sequence**.
2. Set **Frame rate** to a value from `1` to `120`.
3. Finish the edit. A notice confirms **Timing kept in seconds**.

For example, a move that ends at frame 30 at 30 FPS moves to frame 60 at 60 FPS. Both finish at 1 second.

- **Precomp+ compositions:** Every composition uses the sequence frame rate, including **Main** when another composition is open. Check nested compositions after a frame-rate change.
- **Expressions:** Expressions that read `frame` keep their per-frame meaning. Review them after changing FPS, or use `time` when you want seconds instead.
- **Lowering FPS:** At a lower frame rate, keyframes and clip boundaries can land between whole frames. Keep those fractional positions to preserve timing and adjacent clip edges. The playhead displays the nearest whole frame.

### Keep the rate for this project or for new projects

- To apply the change only to this project, click **Just this project** on the notice.
- To also make the new rate the default for future projects, click **Make 60 fps default** (showing your chosen rate). This button appears only when the new rate differs from the current default. A follow-up notice confirms **New projects will use 60 fps.**
- To change the default rate without editing an open sequence, set **Default frame rate** in **Settings**.

### Undo a frame-rate change

1. Click **Undo** in the frame-rate notice, or press Ctrl+Z.
2. Press Ctrl+Y (or Cmd+Shift+Z on macOS) to redo the change.

If you made edits after the frame-rate change, undo those edits first. One **Undo** restores both the previous frame rate and every adjusted time.

## Trim multiple clips at once

Dragging a clip's left or right edge while multiple clips are selected trims the same edge of every selected clip by the same frame delta.
One **Undo** restores all trimmed clips together.

- Dragging a clip outside the current selection trims only that clip.
- Each trim handle is at least `8` px wide. Short clips keep at least one third of their width in the middle for moving.

## Linked timeline clips

- Deleting a track removes its clips from any clip links. Linked clips on other tracks stay selectable and draggable.
- **Undo** restores the deleted track, its clips, and their links. **Redo** removes them again.
- Opening a project automatically strips link members that no longer belong to the sequence and drops links with fewer than two members. This repair adds no undo step and keeps valid links intact.

## Related animation controls

- For incoming Bezier curves, see [Easing+](/docs/animation/easing-plus/).
- For full curve and tangent editing, see [Graph Editor 2](/docs/animation/graph-editor/).
- For viewport position trajectories, see [Motion Paths](/docs/animation/motion-paths/).
- For viewport pause and quality controls, see [Preview and cache](/docs/workflow/preview-and-cache/).
