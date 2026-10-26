---
title: Native FX time effects
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX time effects
  order: 72
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

Numeric ranges are the minimum and maximum in the property definitions. Color defaults are RGB component values.

## Time and input rules

**Time Offset** and **Posterize Time** remap the input clock in effect-list order.
On an **Adjustment** layer, they remap the image from lower tracks.
Media-backed layers clamp mapped input time to the clip range. **3D Scene** and **Adjustment** layers can evaluate beyond their clip boundaries.
A clip still contributes nothing outside its output range.

**Echo**, **Time Displacement**, **CC Wide Time**, and **Time Difference** explicitly capture their input at requested times.
Their sample plans clamp to the owning clip's start and just before its end, including on procedural layers.
Repeated boundary samples keep their weights. They do not wrap or discard out-of-range requests.
Each capture includes the effects before the sampler, but excludes the owning layer's final composite transform.
On an **Adjustment** layer, captures include the composite from lower tracks at the sampled time.
Earlier **Posterize Time** operators also quantize requested sample times.

The samplers use source captures, not previous rendered outputs. Nested frame-sampling depth is capped at eight.
The four effects copy the current input if no samples are available.

## Echo

Composites explicitly sampled earlier inputs with decreasing opacity.

Editor location: **Effects** picker > **NATIVE FX** > **Echo**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Echoes** | Number | 1 to 16 | 4 | Number of earlier samples, rounded to an integer and capped at 16. |
| **Echo delay (frames)** | Number | 0 to 100000 | 3 | Spacing between earlier samples in project frames. |
| **First echo opacity** | Number | 0 to 1 | 0.75 | Weight of the first earlier sample. |
| **Opacity decay** | Number | 0 to 1 | 0.75 | Each successive echo multiplies the previous weight by this value. |
| **Composite** | Option | **over**, **behind (alpha)**, **add**, **screen**, **maximum** | **over** | over places each echo above the accumulated image. behind (alpha) puts it below. add sums RGB. screen uses screen blending. maximum takes component maxima. |

### Temporal behavior and limits

For current evaluated frame `f`, delay `d`, and echo index `i` starting at 1, the requested frame is `f - i * d`.
The weight is `First echo opacity * Opacity decay^(i - 1)`.
Samples composite from the nearest to the farthest requested time over the current input.
A zero **Echo delay (frames)** repeatedly composites the same input. It does not disable the effect.
A zero **First echo opacity** bypasses the effect. A zero **Opacity decay** leaves only the first echo.
At clip boundaries, the repeated clamped frames can make the echo stronger.

The cap is 16 echo requests. The implementation uses two scratch targets for the blend chain, in addition to captured input targets.

## Time Offset

Evaluates the layer input at an offset in project frames.

Editor location: **Effects** picker > **NATIVE FX** > **Time Offset**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Offset (frames)** | Number | -100000 to 100000 | 0 | Added to the evaluated input time. Positive values read later content, and negative values read earlier content. |

### Temporal behavior and limits

The mapped frame is `f + Offset (frames)` before boundary handling.
Fractional offsets are retained.
This is a clock operator. It does not blend two frames or interpolate recorded footage.
Media input freezes at the nearest clip boundary when the mapped time exceeds the clip range.
Procedural **3D Scene** and **Adjustment** input time can continue beyond those boundaries.

## Posterize Time

Holds the layer input on a lower frame-rate clock.

Editor location: **Effects** picker > **NATIVE FX** > **Posterize Time**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Frame rate** | Number | 1 to 120 | 12 | Held-input rate in frames per second. This does not change the project or export frame rate. |

### Temporal behavior and limits

For evaluated input time `t` in seconds and selected rate `r`, the held time is `floor(t * r + 1e-9) / r`.
The ordinary layer's clock is clip-local. Adjustment scope mapping uses project time for lower-track input.
Clock operators apply in list order, so **Time Offset** before quantization can produce a different result from an offset after quantization.
The same boundary handling as **Time Offset** applies.
This effect selects input times. It does not remove export frames or blend motion.

## Time Displacement

Selects a sampled time for each pixel from a luminance map.

Editor location: **Effects** picker > **NATIVE FX** > **Time Displacement**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Displacement Map Source** | List | **The Layer Itself**, **Image**, **Other Layer…** | **The Layer Itself** | The Layer Itself uses the current input as the map. Image uses Source Image. Other Layer… selects a track through Layer Input. |
| **Source Image** | Asset | Image asset | None | Image asset used only for the Image source. No image is selected by default. |
| **Max Displacement Time (sec)** | Number | -30 to 30 | 1 | Signed half-span in seconds. Positive values map black to earlier times and white to later times. Negative values reverse that mapping. |
| **Time Resolution (slices)** | Number | 2 to 64 | 16 | Number of evenly spaced time slices, rounded to an integer. |
| **Stretch Map To Fit** | Option | **off**, **on** | **on** | on fills the input with the map. off samples a centered region with an aspect-dependent UV scale. |

### Temporal behavior and limits

For `N` slices, signed displacement `M` in seconds, and project frame rate `R`, slice `j` requests offset `-M * R + 2 * M * R * j / (N - 1)`.
The index `j` runs from 0 to `N - 1`.
The shader selects the nearest slice from the map's straight-color Rec.709 luminance, bounded to the slice range.
Transparent map pixels use luminance 0.5.
With an even slice count, middle gray selects the upper middle slice, not an exact zero-offset slice.
A zero **Max Displacement Time (sec)** bypasses the effect.
Sample times clamp to the owning clip boundaries as described above.

**Image** works without Layer Input. **Other Layer…** requests the **Layer Input** plugin and its track picker.
If an image or track texture is unavailable, the current input remains the map.
With **Stretch Map To Fit** off, the implementation samples a centered crop. It does not add transparent letterbox bars.
[Layer Input](/docs/how-to/use-layer-input/) describes track selection.

The cap is 64 slices. The gather chain uses one pass per available slice and two scratch targets, in addition to captured inputs.
The shader uses GLSL ES 1.00 integer branches for WebGL1 compatibility. It does not bind all slice textures at once.

## CC Wide Time

Averages or accumulates the current input and neighboring project-frame samples.

Editor location: **Effects** picker > **NATIVE FX** > **CC Wide Time**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Forward Steps** | Number | 0 to 45 | 3 | Number of later project-frame offsets, rounded to an integer. |
| **Backward Steps** | Number | 0 to 45 | 3 | Number of earlier project-frame offsets, rounded to an integer. |
| **Native Motion Blur** | Option | **off**, **on** | **off** | off averages the current input and available taps equally. on sums RGB and caps accumulated alpha at 1. |

### Temporal behavior and limits

For evaluated frame `f`, the default settings request `f - 1`, `f + 1`, `f - 2`, `f + 2`, `f - 3`, and `f + 3`.
The current input also participates. **Native Motion Blur** off gives each of these seven inputs weight `1 / 7`.
This control changes accumulation. It does not activate CM3's scene motion-blur renderer.
If both step counts are zero, the effect bypasses processing.
Sample times clamp to the owning clip boundaries. Repeated boundary taps keep their contributions.

The explicit sample cap is 64. Requests are ordered nearest first, earlier before later at the same distance.
With both step counts at 45, only offsets −32 through −1 and +1 through +32 remain.
The blend chain adds the current input separately and uses two scratch targets in addition to captures.

## Time Difference

Displays the color or alpha difference between the current input and a time-shifted input.

Editor location: **Effects** picker > **NATIVE FX** > **Time Difference**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Time Offset (sec)** | Number | -30 to 30 | 0 | Comparison time relative to the current input, in seconds. Positive reads later, and negative reads earlier. |
| **Contrast** | Number | 0 to 100 | 0 | Difference gain is 1 + Contrast / 25, from 1 to 5. |
| **Absolute Difference** | Option | **off**, **on** | **on** | on displays absolute RGB differences. off centers signed differences on 0.5 gray. |
| **Alpha Channel** | Option | **Original**, **Target**, **Blend**, **Max**, **Full On**, **Lightness Of Result**, **Max Of Result**, **Alpha Difference**, **Alpha Difference Only** | **Original** | Selects the output alpha rule. The mode table below defines each choice. |

### Temporal behavior and limits

For evaluated frame `f`, offset `s` seconds, and project rate `R`, the comparison request is `f + s * R`.
The request clamps to the owning clip boundaries. A zero offset compares the input with itself.
With **Absolute Difference** on, equal colors produce black. With it off, equal colors produce 0.5 gray before alpha multiplication.
The effect compares straight RGB and then premultiplies the result by the chosen alpha.
It needs one comparison capture and one difference pass.

### Alpha modes

| Alpha Channel | Output alpha |
| --- | --- |
| **Original** | Current input alpha. |
| **Target** | Comparison input alpha. |
| **Blend** | Mean of both alphas. |
| **Max** | Larger of both alphas. |
| **Full On** | 1. |
| **Lightness Of Result** | Mean of the largest and smallest result RGB components. |
| **Max Of Result** | Largest result RGB component. |
| **Alpha Difference** | Absolute alpha difference times the contrast gain. |
| **Alpha Difference Only** | Same alpha difference, with white RGB before premultiplication. |

All output alpha values are clamped to 0 to 1.
