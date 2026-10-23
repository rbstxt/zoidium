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

## Tune the blur

- Set **Blur Amount** to the shutter angle divided by 360. For a 180-degree shutter, use 0.5.
- If the effect misses fast motion, increase **Motion Sensitivity** or **Max Displacement (px/frame)**. Keep the displacement limit near the expected movement per frame.
- To reduce differences between nearby motion estimates, increase **Vector Smoothness**. Reduce this value when separate objects move in different directions.
- Keep **Analysis Frames** at **Both** for normal use. To use one neighboring frame, choose **Previous** or **Next**.
- For long, thin trails, set **Quality** to **High**. Use **Balanced** for a faster preview.
- To inspect tracking, set **View** to **Motion Vectors** or **Confidence**. Return to **Result** before export.

## Handle tracking limits

If a shot contains a cut, inspect the cut frame. The effect can bypass blur when the neighboring frames do not match.
If a background becomes visible behind an object, reduce **Blur Amount** to limit artifacts in that area.
For repeated patterns or several objects with similar colors, inspect the trajectories with **Motion Vectors**.

The effect cannot recover detail hidden in the current and neighboring frames.
Perspective motion requires additional processing.
See the [property reference](/docs/reference/smart-motion-blur/) for defaults, ranges, and limits.
