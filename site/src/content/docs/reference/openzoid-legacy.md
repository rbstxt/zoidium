---
title: OpenZoid Legacy
---
OpenZoid Legacy provides seven effects in **SETUP LEGACY**. The pack is an external extension layer around CM3.

## Effects and setup windows

| Effect | Output | Setup launch row |
| --- | --- | --- |
| **Echo (Legacy)** | Blends explicitly sampled earlier frames. | Properties only |
| **Posterize Time (Legacy)** | Holds source time in frame-rate buckets. | Properties only |
| **Jpeg Damage** | Simulates JPEG compression damage. | Properties only |
| **VHS** | Simulates tape color, tracking, noise, and motion faults. | **Open VHS Setup** |
| **Datamosh** | Simulates compression breaks with sampled source frames. | **Open Datamosh Setup** |
| **Tracery** | Draws manual point callouts or color-detected region overlays. | **Open Tracery Setup** |
| **ASCII** | Converts the input into a character-cell image. | **Open ASCII Setup** |

Setup windows edit the effect's properties directly, with a live preview. **Done** closes the window.

## Echo (Legacy)

Each echo samples the source one additional project frame earlier. The number of echoes is capped at 16.

| Property | Default | Range or choices |
| --- | --- | --- |
| **Mode** | **maximum** | **smear**, **maximum**, **additive**, **screen** |
| **Number of Echoes** | 6 | 0 to 16 |
| **Decay** | 0.88 | 0 to 0.99 |
| **Strength** | 1 | 0 to 1 |
| **Threshold** | 0 | 0 to 1 |

**Decay** controls the weight of successive earlier samples. **Strength** mixes the echo result with the original input.

## Posterize Time (Legacy)

**Frame Rate** defaults to 8, with an editor range of 1 to 120 FPS. This changes temporal sampling, not the project's frame rate or export frame rate.

## Jpeg Damage

**Amount** defaults to 1 and ranges from 0 to 1. **Quality** defaults to 0.1 and ranges from 0.01 to 1. **Res Factor** defaults to 1 and ranges from 1 to 8.

| Controls | Function |
| --- | --- |
| **Res Rel X** | Horizontal resolution ratio. |
| **All Freq Scale**, **X Freq Scale**, **Y Freq Scale**, **Low Freq Scale**, **Mid Freq Scale**, **High Freq Scale** | Frequency weighting. |
| **Affect Luma**, **Affect Chroma** | Luminance and color damage strength. |
| **Error Rate**, **Err Block Density**, **Error Amp**, **Error Coherence** | Block-error distribution and strength. |
| **Jitter Frames** | Time grouping for jitter, from 0 to 240. |
| **Rand Seed** | Repeatable random variation. |
| **Scale Lights**, **Offset Darks**, **Saturation** | Output tone and color changes. |
| **Time Offset** | Offset added to the effect clock. |

It does not rewrite the source JPEG file.

## VHS

**Amount** mixes the effect, from 0 to 1. **Roll Speed** ranges from 0 to 5 and defaults to 1.5.

| Group | Controls |
| --- | --- |
| **Master** | **Amount** |
| **Color** | **Signal Strength**, **Color Stripes**, **Chroma Crawl**, **Chroma Loss**, **Flicker**, **RGB Split**, **Blue Screen** |
| **Image** | **VHS Sharpen**, **Interlace**, **Static Warp**, **Fast Forward**, **Tracking**, **Anisotropy Warp**, **Tear**, **Hum Bar**, **Crease**, **Ghost**, **Blinds**, **Snow Dots**, **Speed Dots**, **Anisotropy Snow Dots** |
| **Motion** | **Jitter X**, **Jitter Y**, **Roll**, **Roll Speed**, **Persistence**, **Skew** |
| **Noise** | **Noise Evolution**, **Noise Opacity** |
| **Overlay** | **OSD Timecode** |

**Persistence** blends explicitly sampled earlier source frames. **Clean VHS** selects the clean preset. **Glitch!** changes the stored seed and generates a repeatable set of damaged-tape values.

## Datamosh

**Look** includes **Motion matching** and 80 legacy look entries. **Motion** has **Identity**, **Scale**, **Vertical**, **Horizontal**, **Zoom**, **Shear**, **Wave**, **Swap**, and **Random** choices.

| Property | Default | Range |
| --- | --- | --- |
| **Amount** | 1 | 0 to 1 |
| **I-frame Interval** | 30 | 2 to 240 project frames |
| **Motion Samples** | 4 | 1 to 15 |
| **Block Size** | 12 | 2 to 64 |
| **Seed** | 0 | 0 to 9999 |
| **Remove Frames (Hold)** | 0.15 | 0 to 1 |
| **Speed** | 1 | 0 to 5 |
| **Time Offset** | 0 | Numeric offset in seconds |
| **Intensity** | 0.6 | 0 to 2 |
| **Acceleration** | 0.35 | 0 to 1 |
| **Blend** | 0.8 | 0 to 1 |
| **Threshold** | 0.12 | 0 to 1 |

**Look**, **Motion**, **I-frame Interval**, **Motion Samples**, **Block Size**, and **Seed** cannot be animated.

The setup window groups controls under **Master**, **Cadence**, and **Motion**. **How to mosh** contains its field guide. **Clean Pass** selects the clean preset. **Mosh!** and **Remove Frame** store a new seed and change simulation properties. **New Seed** changes only the seed.

**Remove Frame** sets simulated hold. It does not remove a timeline frame or an encoded keyframe. The separate **True datamosh** export control removes encoded keyframes after a render.

## Tracery

**Detection** is on by default. It finds regions that match **Key Color**, which defaults to white. **Threshold**, **Blur Strength**, and **Detection Quality** control detection. Quality choices are **low**, **medium**, **high**, and **extreme**, with **high** as the default.

**Show Mask** displays the detection mask. **Alpha Layer** selects the alpha-layer output. With no matching key color, detection produces no regions.

The setup groups are **Detection**, **Boxes**, **Markers**, **Grid**, **Connections**, **Labels**, and **Points**. Box shapes are **rectangle**, **square**, **ellipse**, and **circle**. Connection types are **spline**, **pcb traces**, **smooth bend**, and **step bend**.

There are six manual points. **Point 1** starts enabled at the center. Each point has position percentages, size, label, and label offsets. Manual point motion comes from keys or expressions. Color detection does not write motion-tracking keys.

## ASCII

**Block size** sets the cell grid, with a default of 23 and a range of 4 to 64. **Character size** defaults to 18 and ranges from 8 to 64. **Contrast**, **Brightness**, and **Background color** shape the image.

**Character set** offers **standard**, **blocks**, **detailed**, **minimal**, and **custom**. **Custom characters** supplies the custom string. Black, White, Grey, and Alpha bands each have fill, stroke, color, and opacity controls.

**Color mode** offers **band colors**, **footage colors**, **duotone**, **mono**, and **invert**. Additional setup groups cover **Random**, **Sine waves**, **Advanced noise**, **Scroll**, and **Glitch**.

Fonts use bundled Source Code Pro and local fallback families.

## Time, seeds, and saved data

New VHS, Jpeg Damage, and Datamosh effects use clip-local time plus **Time Offset** in seconds.

Stored seeds make randomized values repeatable. Randomizer buttons create new stored values.

## True datamosh export

**True datamosh** is off by default and independent of the seven effects. It processes VP8 or VP9 WebM data after rendering. A successful pass produces `video-moshed.webm` and a keyframe-count note. A failed pass delivers the clean render with a failure note. **at clip cuts** with no cuts preserves the original file and filename.

After **Cancel** during the pass, no moshed file and no finished page are delivered. Seeking in a moshed file is imprecise.

[Use legacy effects](/docs/how-to/use-legacy-effects/) covers setup. [True datamosh export](/docs/how-to/export-true-datamosh/) covers the export workflow.
