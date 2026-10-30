---
title: Smart Motion Blur properties
---
**Smart Motion Blur** combines fractional scene captures or estimates motion between neighboring project frames.
**Blur Amount** controls a centered shutter interval.

## Properties

| Property | Default | Range or options | Meaning |
| --- | --- | --- | --- |
| Blur Amount | 0.5 | 0 to 1 | Shutter duration in project frames. The shutter angle equals this value times 360 degrees. |
| Motion Sensitivity | 70 | 0 to 100 | Optical-flow search limit as a percentage of Max Displacement. Zero disables both reconstruction methods. |
| Vector Smoothness | 50 | 0 to 100 | Regularization weight between nearby optical-flow estimates. |
| Max Displacement (px/frame) | 256 | 1 to 256 | Maximum tracked displacement in project pixels per frame. |
| Analysis Frames | Both | Both, Previous, Next | Neighboring project frames used to estimate motion. A single direction supplies a mirrored velocity for the other shutter half. |
| Quality | Balanced | Balanced, High | Shutter Samples captures 32 times in Balanced and 64 in High. Optical Flow uses a 4-pixel mesh and at most 32 reconstruction samples in Balanced, or a 2-pixel mesh and at most 64 in High. |
| View | Result | Result, Motion Vectors, Confidence | Result shows the blur. Motion Vectors encodes signed horizontal and vertical velocity in red and green. Blue indicates speed. Confidence shows agreement and residual as grayscale. Both diagnostic views use optical flow regardless of Reconstruction. |
| Reconstruction | Automatic | Automatic, Optical Flow, Shutter Samples | Automatic uses Shutter Samples on a 3D Scene layer and Optical Flow on other layers. |

## Limits

A zero **Blur Amount** or **Motion Sensitivity** copies the input exactly.
With **Optical Flow**, identical neighboring images and clips without a distinct neighboring frame also copy the input.
With **Optical Flow**, one available direction supplies both shutter halves at clip boundaries.
With **Optical Flow**, a detected scene cut bypasses blur.

**Shutter Samples** clamps each capture to the clip boundaries and keeps its equal shutter weight.
It does not use **Analysis Frames**, **Vector Smoothness**, or **Max Displacement (px/frame)**.
Positive **Motion Sensitivity** values do not change its output.
Recorded footage does not gain intermediate source frames.
Cuts inside the shutter are averaged. Thin moving edges can show sample bands.
Capture cost scales with scene complexity.
Disocclusion, repeated patterns, thin features, and similar colors across separate motions can produce incorrect trajectories.
Hidden background detail is unavailable when none of the captured frames contains it.
Perspective registration adds processing cost.
The effect has no separate motion-vector input.

The blur analysis ignores the layer's own transform. An **Adjustment** layer above moving content includes that motion.

[Add blur to moving content](/docs/features/smart-motion-blur/) describes effect placement and tuning.
