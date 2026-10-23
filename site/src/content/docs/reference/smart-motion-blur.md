---
title: Smart Motion Blur properties
---
**Smart Motion Blur** estimates motion between neighboring project frames.
**Blur Amount** controls a centered shutter interval.

## Properties

| Property | Default | Range or options | Meaning |
| --- | --- | --- | --- |
| Blur Amount | 0.5 | 0 to 1 | Shutter duration in project frames. The shutter angle equals this value times 360 degrees. |
| Motion Sensitivity | 70 | 0 to 100 | Tracking search limit as a percentage of Max Displacement. |
| Vector Smoothness | 50 | 0 to 100 | Regularization weight between nearby flow estimates. |
| Max Displacement (px/frame) | 256 | 1 to 256 | Maximum tracked displacement in project pixels per frame. |
| Analysis Frames | Both | Both, Previous, Next | Neighboring project frames used to estimate motion. A single direction supplies a mirrored velocity for the other shutter half. |
| Quality | Balanced | Balanced, High | Both modes refine through quarter resolution and apply source constraints. Balanced uses a 4-pixel mesh and caps the shutter at 32 samples. High uses a 2-pixel mesh and caps it at 64. |
| View | Result | Result, Motion Vectors, Confidence | Result shows the blur. Motion Vectors encodes signed horizontal and vertical velocity in red and green. Blue indicates speed. Confidence shows agreement and residual as grayscale. |

## Limits

A zero **Blur Amount** or **Motion Sensitivity** copies the input exactly.
Identical neighboring images and clips without a distinct neighboring frame also copy the input.
At clip boundaries, one available direction supplies both shutter halves.
A detected scene cut bypasses blur.

The maximum tracked displacement is 256 project pixels per frame.
Disocclusion, repeated patterns, thin features, and similar colors across separate motions can produce incorrect trajectories.
Hidden background detail is unavailable when none of the captured frames contains it.
A single projective transform does not describe separate extrusion faces.
Perspective registration adds processing cost.
The effect has no separate motion-vector input.

The selected layer's final composite transform is absent from its captured input.
An **Adjustment** layer above moving content includes that motion.

[Add blur to moving content](/docs/features/smart-motion-blur/) describes effect placement and tuning.
