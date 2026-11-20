---
title: Motion blur (Smart Motion Blur and ZSMB)
description: Choose between Smart Motion Blur, ZSMB, and Camera+ Motion Blur, set up 3D scene and particle blur, and tune reconstruction controls.
---
Zoidium provides three motion-blur options depending on what is moving:

| Option | Plugin | Best for |
| --- | --- | --- |
| **Smart Motion Blur** | **Native FX** | 3D Scenes and particles (via **Shutter Samples**), or footage and Adjustment layers (via **Optical Flow**). |
| **ZSMB (beta 1.1)** | **ZSMB (beta 1.1)** | Lightweight optical-flow motion blur with fast preview and export quality levels (`Full`, `1/2`, `1/4`, `1/8`). |
| **Camera Motion Blur** | **Camera+** | Camera-only shutter blur inside a 3D Scene (see [Camera+](/docs/3d/camera-plus/)). |

## Smart Motion Blur

**Smart Motion Blur** combines fractional scene captures (**Shutter Samples**) or estimates pixel motion between neighboring frames (**Optical Flow**).

### Where to place the effect

- **3D Scenes, rotating meshes, and particles:** Put **Smart Motion Blur** directly on the **3D Scene** clip with **Reconstruction** at **Automatic**. Automatic uses **Shutter Samples** on a 3D Scene layer, capturing true changing silhouettes and extrusion faces at fractional times across the shutter.
- **Footage:** Put **Smart Motion Blur** on the footage clip. **Automatic** uses **Optical Flow**.
- **Animated layer transforms (Position, Rotation, Scale):** Put **Smart Motion Blur** on an **Adjustment** clip above the moving layer (the effect's captured input excludes its own layer's final composite transform). Set **Reconstruction** to **Shutter Samples** if you need direct fractional capture of fast layer transforms or 3D rotations under an Adjustment layer.

### Setup steps

1. In **Plugins**, enable **Native FX**.
2. Select the **3D Scene**, footage, or **Adjustment** clip, and add **Smart Motion Blur** under **NATIVE FX** in the Effects picker.
3. Move to a frame with visible motion (step one frame forward and back to verify particles or objects actually move; keyframe particle **Time** if particles are static).
4. Set **Blur Amount** to `shutter angle / 360` (`0.5` equals a 180-degree shutter).
5. Confirm **View** is set to **Result** before exporting.

### Tuning tips

- **Shutter Samples cost:** Each uncached frame runs `32` scene evaluations at **Balanced** quality and `64` at **High**. While editing heavy scenes, lower **Player+** preview quality to **1/8** or **1/4** with **Pause drawing** and **Render once**, then switch to **Full quality** for final checks. See [Preview and cache](/docs/workflow/preview-and-cache/).
- **Optical Flow tuning:** If fast motion is missed, raise **Motion Sensitivity** or **Max Displacement (px/frame)** (keep max displacement near the expected pixel movement per frame). Raise **Vector Smoothness** to smooth noisy estimates; lower it when separate objects cross paths. Switch **View** to **Motion Vectors** or **Confidence** to inspect tracking, then return to **Result**.

### Smart Motion Blur properties

| Property | Default | Range or options | Meaning |
| --- | --- | --- | --- |
| **Blur Amount** | `0.5` | `0` to `1` | Centered shutter length in project frames (`value × 360°`). `0` copies input unchanged. |
| **Motion Sensitivity** | `70` | `0` to `100` | Optical-flow search limit as a % of **Max Displacement**. `0` disables both modes. |
| **Vector Smoothness** | `50` | `0` to `100` | Regularization between nearby optical-flow estimates. |
| **Max Displacement (px/frame)** | `256` | `1` to `256` | Maximum tracked shift in project pixels per frame. |
| **Analysis Frames** | **Both** | **Both**, **Previous**, **Next** | Neighboring frames analyzed for optical flow (single direction mirrors velocity for the other half). |
| **Quality** | **Balanced** | **Balanced**, **High** | **Balanced** captures `32` shutter taps; **High** captures `64`. |
| **View** | **Result** | **Result**, **Motion Vectors**, **Confidence** | Diagnostic views always run optical flow regardless of **Reconstruction**. |
| **Reconstruction** | **Automatic** | **Automatic**, **Optical Flow**, **Shutter Samples** | **Automatic** picks **Shutter Samples** on 3D Scene layers and **Optical Flow** elsewhere. |

### Smart Motion Blur limits

- Zero **Blur Amount**, zero **Motion Sensitivity**, or (in **Optical Flow**) identical/missing neighbors or a detected scene cut bypass blur and copy the input unchanged.
- **Shutter Samples** clamps captures to clip boundaries and ignores **Analysis Frames**, **Vector Smoothness**, **Max Displacement**, and positive **Motion Sensitivity** changes. Recorded footage cannot gain intermediate source frames, and finite samples can band on very fast thin edges.
- **Optical Flow** cannot invent detail occluded in all analyzed frames; disocclusion, repeated patterns, or similar colors crossing paths can mis-track. There is no external motion-vector input.

## ZSMB (beta 1.1)

**ZSMB (beta 1.1)** is a lightweight optical-flow motion blur that tracks an adjacent frame and scales its analysis width to stay fast in both preview and export.

### Add and configure ZSMB

1. In **Plugins**, enable **ZSMB (beta 1.1)**.
2. Select a footage or **3D Scene** clip and add **ZSMB (beta 1.1)** under **NATIVE FX**.
3. Move to a frame with motion, set **Blur Amount** above `0` (default `0.5` for a 180-degree shutter), and choose **Quality**.

### Quality levels

**Quality** sets the motion-analysis width relative to the project width while scaling the resulting blur to keep the same length and position at every level:

| Quality | Analysis width | Trade-off |
| --- | --- | --- |
| **Full** | Project width | Reference detail; slowest. |
| **1/2** | 1/8 of project width | Default; much faster than **Full** with slightly softer detail. |
| **1/4** | 1/16 of project width | Faster than **1/2**, softer detail. |
| **1/8** | 1/32 of project width | Fastest level. |

- Analysis never exceeds the rendered frame width: lowering **Player+** preview quality caps preview analysis, and exports larger than the project never analyze above project width.
- **Quality** saves with the project; older projects retain their previous **Full** or **1/2** output.

### ZSMB controls and limits

- **Blur Amount:** Shutter angle divided by `360` (default `0.5`; `0` adds no blur).
- **Motion Sensitivity:** `0` to `100` (default `70`; `0` bypasses blur). Raise if fast motion is missed.
- **Track Frame:** **Previous** (default) or **Next**. At frame `0`, **Previous** automatically uses the next frame.
- **Enabled:** Toggle **off** to compare with the unblurred input.
- Reduced quality analyzes less fine detail and can respond differently to **Motion Sensitivity**. Full analysis is not guaranteed to match external motion-blur plugins on every clip. Exports always decode video through the native decoder, while previews may use a faster per-source decoder when verified compatible.

Contributed by Zoidium contributors.
