---
title: Add motion blur to particles and 3D scenes
sidebar:
  label: Blur particles and scenes
---
Blur particles or objects inside a **3D Scene** with **Smart Motion Blur** on the Scene layer itself.

## Add the effect to the Scene layer

1. In **Plugins**, enable **Native FX**.
2. Select the **3D Scene** clip that holds the particles or moving objects.
3. Add **Smart Motion Blur** under **NATIVE FX** in the Effects picker.
4. Keep **Reconstruction** at **Automatic**.
5. Move to a frame where the content moves.
6. Set **View** to **Result** and inspect the blur.

On a **3D Scene** layer, **Automatic** uses **Shutter Samples**: the effect re-evaluates the scene at fractional times across the shutter. Do not place the effect on an **Adjustment** layer for this case. An **Adjustment** layer captures the composited layers below it, so **Automatic** falls back to optical flow and misses changing silhouettes and extrusion faces. Reserve the **Adjustment** layer for motion from a layer's own Position, Rotation, or Scale.

## Pick a reconstruction mode

- Keep **Automatic** for particles and objects inside a **3D Scene**. It captures scene visibility directly at each shutter tap.
- Select **Optical Flow** to estimate motion between neighboring frames instead, for example to match the look used on footage elsewhere in the project.
- Select **Shutter Samples** to force fractional scene captures when **Automatic** would use optical flow.

With **Optical Flow**, if the effect misses fast motion, increase **Motion Sensitivity** or **Max Displacement (px/frame)**. Keep the displacement limit near the expected movement per frame. With **Shutter Samples**, tune the result with **Blur Amount** and **Quality**; the tracking controls do not change the shutter result.

## Make sure the particles move between frames

The effect compares neighboring project frames. Identical neighbors produce no blur: the output copies the input exactly.

1. Step one frame forward and one frame back.
2. Confirm the particles visibly change position between the frames.
3. If they hold still, keyframe the particle **Time** property so the simulation advances across the shutter range.
4. Check that **Blur Amount** and **Motion Sensitivity** are above zero. A zero in either control also copies the input exactly.

## Control the cost at Full quality

Each uncached frame needs 32 scene evaluations at **Balanced** quality and 64 at **High**. At **Full quality** preview size, every evaluation renders at full size.

1. Edit at **1/8 quality** or **1/4 quality** with Player+ **Pause drawing** and **Render once**. Follow [Preview a heavy project](/docs/how-to/preview-heavy-project/).
2. Switch to **Full quality** only to inspect the final blur.
3. Set **Blur Amount** to the shutter angle divided by 360. For a 180-degree shutter, use 0.5.
4. To inspect tracking instead of the blur, set **View** to **Motion Vectors** or **Confidence**. Return to **Result** before export.

[Smart Motion Blur properties](/docs/reference/smart-motion-blur/) list defaults, ranges, and limits.
