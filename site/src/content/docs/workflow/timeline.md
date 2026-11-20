---
title: Timeline and frame rate
description: Jump to a typed frame or timecode, change sequence frame rate without shifting timing, trim multiple clips together, and manage linked timeline clips.
---
Zoidium extends the native CM3 timeline with typed frame and timecode seeking, multi-clip trimming, linked-clip cleanup, and frame-rate changes that preserve timing in seconds.

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

## Jump to a frame or timecode

Click the current time at the top left of the timeline to type a target frame or timecode instead of dragging the playhead.

1. Click the current time readout at the top left of the timeline.
2. Type a frame number or timecode in any of the three formats that right-click cycles through.
3. Press **Enter** to move the playhead.

You can enter any of these three formats, no matter which format the readout currently shows:

| Format | Example | Meaning |
| --- | --- | --- |
| `HH:MM:SS.sss` | `00:00:01.500` | Hours, minutes, and seconds (fractional seconds are optional). |
| `HH:MM:SS:FF` | `00:00:02:10` | Hours, minutes, seconds, and frames within the second. |
| Plain frame number | `120` | Whole frame index from the start of the sequence. |

- **Cancel:** Press **Escape** or click outside the field to close it without moving the playhead. If an input method editor (IME) is composing, pressing **Enter** does not commit the seek.
- **Range and validation:** A negative frame number jumps to frame `0`. If a timecode in `HH:MM:SS:FF` has a frame field at or above the sequence frame rate, Zoidium rejects it and leaves the playhead where it is. Unrecognized text also leaves the playhead where it is.
- **Shortcuts and Undo:** Typing in the time field does not trigger timeline shortcuts. Seeking to a frame does not add an **Undo** step.

## Trim multiple clips at once

Dragging a clip's left or right edge while multiple clips are selected trims the same edge of every selected clip by the same frame delta.
One **Undo** restores all trimmed clips together.

- Dragging a clip outside the current selection trims only that clip.
- Each trim handle is at least `8` px wide. Short clips keep at least one third of their width in the middle for moving.
- Trimming the left edge of a masked **Scene** or **Adjustment** clip shifts its clip-local mask keyframes together with the clip start so they stay at the same project frames.

## Path and mask keyframe rows

When a single **Scene**, **Adjustment**, or **Shape+** clip is selected, the timeline keyframes panel shows logical path rows (**Masks > `<mask name>` > Mask Path** and **Shape+ > `<path name>` > Path**). Click a diamond to move the playhead, `Shift`-click to select multiple diamonds on a row, drag to retime them in one **Undo** step, or press `Delete` to remove selected keys. For full path and mask editing details, see [Shape+ and layer masks](/docs/2d-and-text/shape-plus/).

## Linked timeline clips

- Deleting a track removes its clips from any clip links. Linked clips on other tracks stay selectable and draggable.
- **Undo** restores the deleted track, its clips, and their links. **Redo** removes them again.
- Opening a project automatically strips link members that no longer belong to the sequence and drops links with fewer than two members. This repair adds no undo step and keeps valid links intact.

## Related animation controls

- For incoming Bezier curves, see [Easing+](/docs/animation/easing-plus/).
- For full curve and tangent editing, see [Graph Editor 2](/docs/animation/graph-editor/).
- For viewport position trajectories, see [Motion Paths](/docs/animation/motion-paths/).
- For viewport pause and quality controls, see [Preview and cache](/docs/workflow/preview-and-cache/).
