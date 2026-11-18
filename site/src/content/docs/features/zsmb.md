---
title: Add motion blur with ZSMB
sidebar:
  label: ZSMB
---
Use **ZSMB (beta 1.0)** to add optical-flow motion blur to moving footage or to
content inside a **3D Scene**. The effect tracks an adjacent frame and
reconstructs trails from the current image.

## Add the effect

1. Enable **ZSMB (beta 1.0)** in Plugins.
2. Select the footage or **3D Scene** clip.
3. Add **ZSMB (beta 1.0)** under **NATIVE FX** in the Effects picker.
4. Move to a frame where the content moves.
5. Set **Blur Amount** to a value above zero.

## Choose quality

**Quality** sets the resolution of the motion analysis.

- **Full quality** analyses motion at source resolution for the most accurate
  result and is performance-heavy.
- **1/2 quality** is the default. It analyses motion at one eighth of the input
  width and height and reconstructs at full image resolution. Fine detail and
  the response to **Motion Sensitivity** can differ from Full quality.

Both options keep the output at image resolution. Older projects that stored
the removed Quarter or Eighth values load as **1/2 quality**.

## Tune the blur

- Set **Blur Amount** to the shutter angle divided by 360. For a 180-degree
  shutter, use the default 0.5. A value of 0 adds no blur.
- If fast movement is missed, raise **Motion Sensitivity**. The displayed range
  is 0 to 100 and the default is 70. A value of 0 bypasses the blur.
- To track the following frame instead of the preceding frame, set **Track
  Frame** to **Next**. At frame 0 only, **Previous** uses the next frame
  because no preceding frame exists.
- Set **Enabled** to **off** to compare the current image with the blurred
  result. The source frame does not change in either tracking mode.

## Limits

**1/2 quality** keeps an approximate motion field. Detail and the response to
**Motion Sensitivity** can differ from **Full quality**.
**Full quality** is not guaranteed to match another motion blur tool on every
clip.

Exports decode media with the native path. The faster preview decoder is used
only for preview frames, and a per-source comparison decides whether a file
supports it.

Contributed by Zoidium contributors.
