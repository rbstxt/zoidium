---
title: Motion Paths
description: Drag animated Position keyframes and spatial Bezier tangents directly in the main viewport.
---
Use **Motion Paths** (enabled by default) to inspect and edit animated **Position** trajectories directly in the preview viewport.

## Show and edit a motion path

**Position** must have at least one animated, expression-free axis.

1. Select a layer clip on the timeline (or select a 3D object in **Objects**).
2. For a 2D layer clip, press **T** to show layer transform controls.
3. Press **O** or click the viewport's **motion paths** button.
4. Click a keyframe square along the path and drag it to move that key.
5. Drag a yellow tangent handle to bend the curve.

## Gestures and limits

| Input | Result |
| --- | --- |
| `O` | Toggles the motion paths overlay. |
| Shift+click | Toggles selection on a keyframe square. |
| Shift+drag | Constrains key movement to the dominant parent-space axis. |
| Alt+drag (on tangent) | Breaks tangent continuity. |
| Alt+click (on key) | Toggles adjacent segments between linear and Bezier. |
| Escape | Cancels the current drag. |

- Expression-driven axes are read-only or hidden on the motion path.
- Paths draw at most `1500` line segments and omit per-frame dots when the span exceeds `900` frames.
