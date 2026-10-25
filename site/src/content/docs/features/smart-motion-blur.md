---
title: Add blur to moving content
sidebar:
  label: Smart Motion Blur
---
Use **Smart Motion Blur** to blur moving footage or objects inside a **3D Scene**.
For motion from a layer's Position, Rotation, or Scale, use an **Adjustment** layer above that content.

## Add the effect

1. Enable **Native FX** in Plugins.
2. Select the footage or **3D Scene** clip. For layer transform motion, select an **Adjustment** clip above the moving content.
3. Add **Smart Motion Blur** under **NATIVE FX** in the Effects picker.
4. Move to a frame where the content moves.
5. Set **View** to **Result** to inspect the blur.

The captured input excludes the selected layer's final composite transform.
An **Adjustment** layer captures that motion after the moving layers are composited.

## Choose reconstruction

For objects rotating inside a **3D Scene**, keep **Reconstruction** at **Automatic**.
This captures the scene at fractional times across the shutter, including changing silhouettes and visible extrusion faces.
For footage, **Automatic** uses optical flow.
To use optical flow on a **3D Scene**, select **Optical Flow**.
For animated layer transforms under an **Adjustment** layer, select **Shutter Samples** to capture those transforms directly.

## Tune the blur

- Set **Blur Amount** to the shutter angle divided by 360. For a 180-degree shutter, use 0.5.
- With **Optical Flow**, if the effect misses fast motion, increase **Motion Sensitivity** or **Max Displacement (px/frame)**. Keep the displacement limit near the expected movement per frame.
- With **Optical Flow**, to reduce differences between nearby motion estimates, increase **Vector Smoothness**. Reduce this value when separate objects move in different directions.
- With **Optical Flow**, keep **Analysis Frames** at **Both** for normal use. To use one neighboring frame, choose **Previous** or **Next**.
- For more shutter samples, set **Quality** to **High**. Use **Balanced** for a faster preview.
- With **Shutter Samples**, use **Blur Amount** and **Quality** to tune the result. The tracking controls do not change this result.
- To inspect optical-flow tracking, set **View** to **Motion Vectors** or **Confidence**. Return to **Result** before export.

## Handle tracking limits

With **Optical Flow**, if a shot contains a cut, inspect the cut frame. The effect can bypass blur when the neighboring frames do not match.
If a background becomes visible behind an object, reduce **Blur Amount** to limit artifacts in that area.
For repeated patterns or several objects with similar colors, inspect the trajectories with **Motion Vectors**.

Optical flow cannot recover detail hidden in the current and neighboring frames.
**Shutter Samples** captures scene visibility directly, but finite samples can leave bands in very fast motion.
Complex scenes require more capture time. Recorded footage retains its source-frame cadence.
Perspective motion requires additional processing.
See the [property reference](/docs/reference/smart-motion-blur/) for defaults, ranges, and limits.
