---
title: Native FX keying effects
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX keying effects
  order: 73
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

Numeric ranges are the minimum and maximum in the property definitions. Color defaults are RGB component values.

## Color Difference Key

Builds a keying matte from two differences against the key color's dominant channel.

Editor location: **Effects** picker > **NATIVE FX** > **Color Difference Key**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **View** | Option | **Final Output**, **Source Only**, **Corrected Matte**, **Uncorrected Matte**, **Corrected Partial A**, **Corrected Partial B** | **Final Output** | Shows the final keyed image, the source, or one of the four matte views. Matte views are opaque grayscale multiplied by source alpha. |
| **Key Color** | Color | No effect-specific numeric bounds | `[0, 1, 0]` | Dominant channel and two reference differences used to construct partial mattes A and B. |
| **Color Matching Accuracy** | Option | **Faster**, **More Accurate** | **Faster** | Faster compares encoded RGB. More Accurate linearizes RGB and Key Color before comparison. |
| **Partial A In Black** | Number | 0 to 255 | 0 | Input black point for partial matte A. Values at or below it map to the output black point. |
| **Partial A In White** | Number | 0 to 255 | 255 | Input white point for partial matte A. Values at or above it map to the output white point. |
| **Partial A Gamma** | Number | 0.01 to 10 | 1 | Midtone exponent correction for partial matte A, applied as power 1 / Gamma. |
| **Partial A Out Black** | Number | 0 to 255 | 0 | Output black point for partial matte A. |
| **Partial A Out White** | Number | 0 to 255 | 255 | Output white point for partial matte A. |
| **Partial B In Black** | Number | 0 to 255 | 0 | Input black point for partial matte B. Values at or below it map to the output black point. |
| **Partial B In White** | Number | 0 to 255 | 255 | Input white point for partial matte B. Values at or above it map to the output white point. |
| **Partial B Gamma** | Number | 0.01 to 10 | 1 | Midtone exponent correction for partial matte B, applied as power 1 / Gamma. |
| **Partial B Out Black** | Number | 0 to 255 | 0 | Output black point for partial matte B. |
| **Partial B Out White** | Number | 0 to 255 | 255 | Output white point for partial matte B. |
| **Matte In Black** | Number | 0 to 255 | 0 | Input black point after the corrected partial mattes combine by maximum. |
| **Matte In White** | Number | 0 to 255 | 255 | Input white point after the corrected partial mattes combine by maximum. |
| **Matte Gamma** | Number | 0.01 to 10 | 1 | Midtone correction for the combined matte, applied as power 1 / Gamma. |

### Matte calculation and limits

The key color's largest channel is compared with each other channel to produce partial mattes A and B.
Each partial matte has input black, input white, gamma, output black, and output white controls.
The corrected partial mattes combine by maximum before the final matte levels.
Final output multiplies the input RGBA by the corrected matte. It does not remove color spill.
This is a current-frame filter with no temporal samples.

## Advanced Spill Suppressor

Suppresses excess key-color channels while preserving input alpha.

Editor location: **Effects** picker > **NATIVE FX** > **Advanced Spill Suppressor**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Method** | Option | **Standard**, **Ultra** | **Standard** | Standard suppresses the dominant key channel. Ultra also enables the five controls marked Ultra below. |
| **Key Color** | Color | No effect-specific numeric bounds | `[0, 1, 0]` | Selects the dominant RGB channel to suppress and, in Ultra, the hue to match. |
| **Suppression** | Number | 0 to 200 | 100 | Percentage of excess key-channel intensity removed. |
| **Tolerance** | Number | 0 to 100 | 50 | Ultra only. Width of the hue region affected around Key Color. |
| **Desaturate** | Number | 0 to 100 | 0 | Ultra only. Desaturates pixels in proportion to removed spill. |
| **Spill Range** | Number | 0 to 100 | 50 | Ultra only. Moves the suppression limit from the larger other channel toward the average of the other two channels. |
| **Spill Color Correction** | Number | 0 to 100 | 0 | Ultra only. Adds a neutral RGB contribution from the removed spill. |
| **Luma Correction** | Number | 0 to 100 | 0 | Ultra only. Restores brightness using the suppressed channel's luminance weight. |

### Suppression and limits

**Standard** chooses the dominant channel from **Key Color**, rather than analyzing the whole frame.
**Ultra** limits suppression by hue and adds spill-range, desaturation, and brightness corrections.
The shader preserves input alpha. It does not create a keying matte.
This is one current-frame shader pass with no temporal samples.

## Key Cleaner

Refines keyed edges with spatial alpha filtering, contrast, and color decontamination.

Editor location: **Effects** picker > **NATIVE FX** > **Key Cleaner**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Additional Edge Radius** | Number | 0 to 100 | 3 | Pixel radius for local edge-color estimation. The implementation derives sigma as half this value. |
| **Reduce Chatter** | Option | **off**, **on** | **off** | on applies a spatial alpha blur to edges. It does not sample earlier frames. |
| **Alpha Contrast** | Number | 100 to 500 | 100 | Alpha contrast as a percentage. 100 leaves the contrast multiplier at 1. |
| **Strength** | Number | 0 to 100 | 100 | Percentage strength of edge-color decontamination. |

### Edge calculation and limits

**Reduce Chatter** uses a fixed 5 × 5 spatial alpha kernel, followed by a contrast step.
Edge-color estimation also uses a fixed 5 × 5 kernel. Its sampling step is clamped to 1 to 4 pixels.
Large **Additional Edge Radius** values therefore remain a bounded approximation.
Fully transparent source pixels remain transparent.
There is no temporal history or neighboring-frame analysis.

## Linear Color Key

Removes or retains pixels according to their color distance from a key color.

Editor location: **Effects** picker > **NATIVE FX** > **Linear Color Key**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **View** | Option | **Final Output**, **Source Only**, **Matte Only** | **Final Output** | Final Output applies the key. Source Only passes the source. Matte Only displays the keyed alpha as opaque grayscale. |
| **Key Color** | Color | No effect-specific numeric bounds | `[0, 0, 1]` | Reference color for the distance calculation. |
| **Match Colors** | Option | **Using RGB**, **Using Hue**, **Using Chroma** | **Using RGB** | Using RGB measures RGB distance. Using Hue measures circular hue distance. Using Chroma measures normalized red and green distance. |
| **Matching Tolerance** | Number | 0 to 100 | 10 | Color-distance threshold as a percentage. Matching pixels below the threshold are fully keyed. |
| **Matching Softness** | Number | 0 to 100 | 10 | Width of the linear alpha transition above Matching Tolerance, as a percentage. |
| **Key Operation** | Option | **Key Colors**, **Keep Colors** | **Key Colors** | Key Colors removes matching pixels. Keep Colors retains matching pixels and removes others. |

### Matching and limits

RGB distance is normalized by `sqrt(3)`. Chroma distance uses normalized red and green components, divided by `sqrt(2)`.
Hue matching treats source pixels with saturation below 0.02 as distance 1.
The final keyed result multiplies the original RGBA by the matte, preserving existing transparency.
This is a current-frame filter with no temporal samples or spill suppression.
