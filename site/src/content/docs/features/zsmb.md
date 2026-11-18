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
6. Set **Quality** to the detail level you need.

## Set the quality

**Quality** sets the width of the motion analysis as a part of the rendered
frame.

| Quality | Analysis width | Use |
| --- | --- | --- |
| Full | The full frame | The reference result. The slowest level. |
| 1/2 | One eighth of the frame | The default. Less detail than Full, and much faster. |
| 1/4 | One sixteenth of the frame | Faster than 1/2, with softer detail. |
| 1/8 | One thirty-second of the frame | The fastest level. |

The effect analyses the smaller of the project frame and the rendered frame.
In the preview, Player+ sets the rendered frame. When the preview is 1/8
quality, ZSMB analyses at most the pixels of that 1/8 frame, whatever
**Quality** you select. **Full** at 1/8 preview quality analyses the whole 1/8
frame. **1/2** at Full preview quality analyses one eighth of the frame.

Export uses the same **Quality** value. A 1/2 export at the project resolution
analyses the same pixels as a 1/2 preview at Full preview quality. A 1/2 export
renders much faster than a Full export. The blur keeps its length and position
at every level, because the effect scales the motion field to the frame.

The project saves the **Quality** level with the effect. Older projects keep
the Full or 1/2 result they had.

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

A reduced quality analyses less detail. Fine detail and the response to
**Motion Sensitivity** can differ from Full.
Full analysis is not guaranteed to match another motion blur tool on every
clip.

Exports decode media with the native path. The faster preview decoder is used
only for preview frames, and a per-source comparison decides whether a file
supports it.

Contributed by Zoidium contributors.
