---
title: OpenZoid Legacy
description: Use deterministic OpenZoid Legacy effects (Echo, Posterize Time, Jpeg Damage, VHS, Datamosh, Tracery, and ASCII) and floating setup windows.
---
Use **OpenZoid Legacy** to add seven deterministic effects under **SETUP LEGACY** in the Effects picker, four of which include live floating setup windows.
Enabling OpenZoid Legacy also unlocks the separate **True datamosh** WebM export pass (see [Exporting video and frames](/docs/workflow/export/#export-with-true-datamosh-webm)).

## Add an effect and open its setup window

1. In **Plugins**, enable **OpenZoid Legacy**.
2. Select a layer clip, open the Effects picker, and pick an effect under **SETUP LEGACY**.
3. For **VHS**, **Datamosh**, **Tracery**, or **ASCII**, click the launch button above its properties (**Open VHS Setup**, **Open Datamosh Setup**, **Open Tracery Setup**, or **Open ASCII Setup**).
4. Adjust controls or pick a preset with live viewport feedback, then click **Done** to close the window (edits apply immediately; **Undo** reverses them).

New **VHS**, **Jpeg Damage**, and **Datamosh** effects use clip-local time plus **Time Offset** in seconds. Stored seeds make random results repeatable, and clicking **Glitch!** (VHS) or **Mosh!** (Datamosh) writes a new seed in one undo step.

| Effect | Output | Setup window |
| --- | --- | --- |
| **Echo (Legacy)** | Blends explicitly sampled earlier frames. | Properties only |
| **Posterize Time (Legacy)** | Holds source time in frame-rate buckets. | Properties only |
| **Jpeg Damage** | Simulates JPEG compression artifacts (does not alter the source file). | Properties only |
| **VHS** | Simulates tape color, tracking, noise, and motion faults. | **Open VHS Setup** |
| **Datamosh** | Simulates compression breaks deterministically without needing prior playback. | **Open Datamosh Setup** |
| **Tracery** | Draws manual point callouts or color-detected region overlays. | **Open Tracery Setup** |
| **ASCII** | Converts the image into character cells. | **Open ASCII Setup** |

## Echo (Legacy) and Posterize Time (Legacy)

These are separate from the **Echo** and **Posterize Time** effects in [Native FX time effects](/docs/effects/native-fx/time/).

- **Echo (Legacy):** Each echo samples one additional project frame earlier (capped at `16`).
  - **Mode:** **smear**, **maximum** (default), **additive**, **screen**.
  - **Number of Echoes:** `0` to `16` (default `6`).
  - **Decay:** `0` to `0.99` (default `0.88`, weight of older frames).
  - **Strength:** `0` to `1` (default `1`, mix with input).
  - **Threshold:** `0` to `1` (default `0`).
- **Posterize Time (Legacy):** **Frame Rate** (`1` to `120` FPS, default `8`) steps temporal sampling without changing project or export FPS.

## Jpeg Damage

**Amount** (`0` to `1`, default `1`), **Quality** (`0.01` to `1`, default `0.1`), and **Res Factor** (`1` to `8`, default `1`), plus:

| Controls | Function |
| --- | --- |
| **Res Rel X** | Horizontal resolution ratio. |
| **All / X / Y / Low / Mid / High Freq Scale** | DCT frequency weighting. |
| **Affect Luma**, **Affect Chroma** | Luminance and chroma damage strength. |
| **Error Rate**, **Err Block Density**, **Error Amp**, **Error Coherence** | Block-error distribution and strength. |
| **Jitter Frames** | Time grouping for jitter (`0` to `240`). |
| **Rand Seed**, **Time Offset** | Repeatable seed and clock offset. |
| **Scale Lights**, **Offset Darks**, **Saturation** | Output tone and saturation adjustments. |

## VHS

**Amount** (`0` to `1`) mixes the effect; **Roll Speed** (`0` to `5`, default `1.5`) drives vertical roll.

| Setup group | Controls |
| --- | --- |
| **Master** | **Amount** |
| **Color** | **Signal Strength**, **Color Stripes**, **Chroma Crawl**, **Chroma Loss**, **Flicker**, **RGB Split**, **Blue Screen** |
| **Image** | **VHS Sharpen**, **Interlace**, **Static Warp**, **Fast Forward**, **Tracking**, **Anisotropy Warp**, **Tear**, **Hum Bar**, **Crease**, **Ghost**, **Blinds**, **Snow Dots**, **Speed Dots**, **Anisotropy Snow Dots** |
| **Motion** | **Jitter X**, **Jitter Y**, **Roll**, **Roll Speed**, **Persistence** (samples earlier frames), **Skew** |
| **Noise** | **Noise Evolution**, **Noise Opacity** |
| **Overlay** | **OSD Timecode** |

**Clean VHS** loads the clean preset; **Glitch!** generates a seeded damaged-tape combination.

## Datamosh

**Look** offers **Motion matching** plus 80 legacy look presets. **Motion** offers **Identity**, **Scale**, **Vertical**, **Horizontal**, **Zoom**, **Shear**, **Wave**, **Swap**, and **Random**.
Static (non-animatable) properties: **Look**, **Motion**, **I-frame Interval**, **Motion Samples**, **Block Size**, and **Seed**.

| Property | Default | Range |
| --- | --- | --- |
| **Amount** | `1` | `0` to `1` |
| **I-frame Interval** | `30` | `2` to `240` project frames |
| **Motion Samples** | `4` | `1` to `15` |
| **Block Size** | `12` | `2` to `64` |
| **Seed** | `0` | `0` to `9999` |
| **Remove Frames (Hold)** | `0.15` | `0` to `1` |
| **Speed** | `1` | `0` to `5` |
| **Time Offset** | `0` | Offset in seconds |
| **Intensity** | `0.6` | `0` to `2` |
| **Acceleration** | `0.35` | `0` to `1` |
| **Blend** | `0.8` | `0` to `1` |
| **Threshold** | `0.12` | `0` to `1` |

The setup window groups controls into **Master**, **Cadence**, and **Motion** (with **How to mosh** notes). **Clean Pass** resets to clean; **Mosh!** and **Remove Frame** store a new seed and tweak simulation hold (**Remove Frame** does not delete timeline frames or alter video files); **New Seed** changes only the seed. Leave **True datamosh** set to **off** on **Export > Device** when you want only this viewport effect.

## Tracery

- **Color detection (default on):** Turn **Detection** on, pick **Key Color** (default white), and tune **Threshold**, **Blur Strength**, and **Detection Quality** (**low**, **medium**, **high** default, **extreme**). Use **Show Mask** while dialing **Threshold**, then turn **Show Mask** off before export. **Alpha Layer** selects alpha-layer output. Color detection does not generate motion-tracking keyframes.
- **Manual points:** Turn **Detection** off, enable **Point 1** through **Point 6** (**Point 1** starts enabled at center), and keyframe or drive their positions, sizes, labels, and label offsets.
- **Setup groups:** **Detection**, **Boxes** (**rectangle**, **square**, **ellipse**, **circle**), **Markers**, **Grid**, **Connections** (**spline**, **pcb traces**, **smooth bend**, **step bend**), **Labels**, and **Points**.

## ASCII

- **Grid and tone:** **Block size** (`4` to `64`, default `23`), **Character size** (`8` to `64`, default `18`), **Contrast**, **Brightness**, and **Background color**.
- **Characters and color:** **Character set** (**standard**, **blocks**, **detailed**, **minimal**, **custom** with **Custom characters**); Black, White, Grey, and Alpha bands (each with fill, stroke, color, and opacity); **Color mode** (**band colors**, **footage colors**, **duotone**, **mono**, **invert**).
- **Additional setup groups:** **Random**, **Sine waves**, **Advanced noise**, **Scroll**, and **Glitch**. Fonts use the bundled font and local fallbacks.
