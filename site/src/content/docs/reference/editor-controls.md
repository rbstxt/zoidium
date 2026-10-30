---
title: Animation and preview controls
description: Easing+ coordinates, Motion Paths gestures, and Player+ drawing and quality settings.
sidebar:
  label: Editor controls
---
These controls change editing and preview behavior. Easing+ and Motion Paths edit the project's animation. Player+ preferences affect the local viewport.


## Easing+ coordinates

**Out X**, **Out Y**, **In X**, and **In Y** are numeric Bezier coordinates with a step of `0.001`. Initial values come from the incoming segment at the selected key. X coordinates lie between `0` and `1`. Y supports overshoot.

Out controls belong to the start key. In controls belong to the end key. The first key has no incoming segment. Closing the window, including Escape, commits one undoable edit.

[Set an incoming curve with Easing+](/docs/features/easing-plus/)

## Motion Paths gestures and limits

| Input | Result |
| --- | --- |
| `O` | Toggles the motion paths overlay. |
| `Shift-click` | Toggles key selection. |
| `Shift-drag` | Constrains a move to the dominant parent-space axis. |
| `Alt-drag` | Breaks tangent continuity. |
| `Alt-click` | Toggles adjacent linear and Bezier segments. |
| `Escape` | Cancels the current drag. |

Position paths need an expression-free animated axis; anything expression-driven is read-only or hidden. Paths use at most 1500 line segments and omit frame dots beyond 900 frames.

[Edit motion with Motion Paths](/docs/features/motion-path/)

## Player+ drawing and quality

**Pause drawing** suspends viewport drawing, with no change to audio or playhead motion. **Render once** draws the current frame. **Resume drawing** restores automatic draws. Drawing starts enabled.

**Preview quality** is a local choice with **Full quality**, **1/2 quality**, **1/4 quality**, and **1/8 quality**. The default is Full quality. Fractions scale both viewport dimensions. Project resolution and export resolution retain their own values.

[Player+ preview controls](/docs/features/player-plus/)

[Preview cache](/docs/features/preview-cache/)
