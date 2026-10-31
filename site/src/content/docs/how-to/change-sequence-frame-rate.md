---
title: Change the frame rate without changing timing
sidebar:
  label: Change the frame rate
---
Keep clip and animation timing in seconds when you change the sequence frame rate.

## Change the sequence frame rate

1. Open **Sequence**.
2. Change **Frame rate** to a value from 1 to 120.
3. Finish the edit. The notice confirms **Timing kept in seconds**.

For example, a move that ends at frame 30 at 30 FPS ends at frame 60 at 60 FPS. Both end at one second.

If you use Precomp+, check the nested compositions too. Every composition uses the sequence frame rate, including **Main** when another composition is open.

If you use expressions based on `frame`, review them after the change. They keep their per-frame meaning. Use `time` when you want an expression to follow seconds.

At a lower frame rate, keyframes and clip boundaries can fall between frames. Keep these fractional positions to preserve timing and adjacent clip boundaries. The playhead displays the nearest whole frame.

## Keep the change for this project or for new projects

To keep the new rate for this project only, click **Just this project**.
To also use the new rate for new projects, click **Make 60 fps default**. This choice appears only when the new rate differs from the current default. A follow-up notice confirms **New projects will use 60 fps.**
To change the default without editing a sequence, change **Default frame rate** in **Settings**.

## Undo the change

1. In the frame rate notice, click **Undo**.
2. To apply the change again, use **Redo**.

If you have made later edits, undo those edits first. One **Undo** restores both the previous frame rate and all adjusted times.

Before switching between **Main** and a Precomp+ composition, finish any **Undo** or **Redo** work. Switching compositions clears both histories.
