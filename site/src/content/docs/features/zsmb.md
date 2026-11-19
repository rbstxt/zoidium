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

**Quality** sets the width of the motion analysis relative to the project.

| Quality | Analysis width | Use |
| --- | --- | --- |
| Full | The project width | The reference result. The slowest level. |
| 1/2 | One eighth of the project width | The default. Less detail than Full, and much faster. |
| 1/4 | One sixteenth of the project width | Faster than 1/2, with softer detail. |
| 1/8 | One thirty-second of the project width | The fastest level. |

The analysis never uses more pixels than the rendered frame holds. In the
preview, Player+ sets that frame. A reduced preview quality therefore caps the
analysis width. **Full** analyses the whole preview frame. The reduced levels
keep their project-relative width while the frame is at least that large.

Export uses the same **Quality** value on its output frame. A 1/2 export at the
project resolution analyses one eighth of the project width. An export larger
than the project never analyses more than the project frame. A 1/2 export
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
