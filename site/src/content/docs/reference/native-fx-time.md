---
title: Native FX time effects
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX time effects
  order: 72
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

## Time and input rules

**Time Offset** and **Posterize Time** remap the input clock in effect-list order.
On an **Adjustment** layer, they remap the image from lower tracks.
Media-backed layers clamp mapped input time to the clip range. **3D Scene** and **Adjustment** layers can evaluate beyond their clip boundaries.
A clip still contributes nothing outside its output range.

**Echo**, **Time Displacement**, **CC Wide Time**, and **Time Difference** explicitly capture their input at requested times.
Their sample plans clamp to the owning clip's start and just before its end, including on procedural layers.
Repeated boundary samples keep their weights. They do not wrap or discard out-of-range requests.
Each capture includes earlier effects, but not the layer's own transform.
On an **Adjustment** layer, captures include the composite from lower tracks at the sampled time.
Earlier **Posterize Time** operators also quantize requested sample times.

The samplers capture the source, not previous outputs. Nested sampling is capped at eight levels.
The four effects copy the current input if no samples are available.

## Echo

Composites explicitly sampled earlier inputs with decreasing opacity.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Echoes** | Number | 1 to 16 | 4 | Number of earlier samples. |
| **Echo delay (frames)** | Number | 0 to 100000 | 3 | Spacing between earlier samples in project frames. |
| **First echo opacity** | Number | 0 to 1 | 0.75 | Weight of the first earlier sample. |
| **Opacity decay** | Number | 0 to 1 | 0.75 | Each successive echo multiplies the previous weight by this value. |
| **Composite** | Option | **over**, **behind (alpha)**, **add**, **screen**, **maximum** | **over** | over places each echo above the accumulated image. behind (alpha) puts it below. add sums RGB. screen uses screen blending. maximum takes component maxima. |

### Temporal behavior and limits

Samples composite from the nearest to the farthest requested time over the current input.
A zero **First echo opacity** bypasses the effect. A zero **Opacity decay** leaves only the first echo.
At clip boundaries, the repeated clamped frames can make the echo stronger.

## Time Offset

Evaluates the layer input at an offset in project frames.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Offset (frames)** | Number | -100000 to 100000 | 0 | Added to the evaluated input time. Positive values read later content, and negative values read earlier content. |

### Temporal behavior and limits

Fractional offsets are retained.
This is a clock operator. It does not blend two frames or interpolate recorded footage.

## Posterize Time

Holds the layer input on a lower frame-rate clock.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Frame rate** | Number | 1 to 120 | 12 | Held-input rate in frames per second. This does not change the project or export frame rate. |

### Temporal behavior and limits

The ordinary layer's clock is clip-local. Adjustment scope mapping uses project time for lower-track input.
Clock operators apply in list order, so **Time Offset** before quantization can produce a different result from an offset after quantization.
The same boundary handling as **Time Offset** applies.
This effect selects input times. It does not remove export frames or blend motion.

## Time Displacement

Selects a sampled time for each pixel from a luminance map.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Displacement Map Source** | List | **The Layer Itself**, **Image**, **Other Layer…** | **The Layer Itself** | The Layer Itself uses the current input as the map. Image uses Source Image. Other Layer… selects a track through Layer Input. |
| **Source Image** | Asset | Image asset | None | Image asset used only for the Image source. No image is selected by default. |
| **Max Displacement Time (sec)** | Number | -30 to 30 | 1 | Signed half-span in seconds. Positive values map black to earlier times and white to later times. Negative values reverse that mapping. |
| **Time Resolution (slices)** | Number | 2 to 64 | 16 | Number of evenly spaced time slices. |
| **Stretch Map To Fit** | Option | **off**, **on** | **on** | on fills the input with the map. off samples a centered region. |

### Temporal behavior and limits

Each pixel uses the nearest slice for its map brightness.
Transparent map pixels use luminance 0.5.
A zero **Max Displacement Time (sec)** bypasses the effect.

**Image** works without Layer Input. **Other Layer…** requests the **Layer Input** plugin and its track picker.
If an image or track texture is unavailable, the current input remains the map.
With **Stretch Map To Fit** off, the map is a centered crop with no letterbox bars.
[Layer Input](/docs/how-to/use-layer-input/) describes track selection.

## CC Wide Time

Averages or accumulates the current input and neighboring project-frame samples.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Forward Steps** | Number | 0 to 45 | 3 | Number of later project-frame offsets. |
| **Backward Steps** | Number | 0 to 45 | 3 | Number of earlier project-frame offsets. |
| **Native Motion Blur** | Option | **off**, **on** | **off** | off averages the current input and available taps equally. on sums RGB and caps accumulated alpha at 1. |

### Temporal behavior and limits

With default settings, the current input and three frames on each side share the result equally.
This control changes accumulation. It does not activate CM3's scene motion-blur renderer.
If both step counts are zero, the effect bypasses processing.

Samples are capped at 64. With both step counts at 45, only offsets −32 through −1 and +1 through +32 remain.

## Time Difference

Displays the color or alpha difference between the current input and a time-shifted input.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Time Offset (sec)** | Number | -30 to 30 | 0 | Comparison time relative to the current input, in seconds. Positive reads later, and negative reads earlier. |
| **Contrast** | Number | 0 to 100 | 0 | Difference gain, from 1 to 5. |
| **Absolute Difference** | Option | **off**, **on** | **on** | on displays absolute RGB differences. off centers signed differences on 0.5 gray. |
| **Alpha Channel** | Option | **Original**, **Target**, **Blend**, **Max**, **Full On**, **Lightness Of Result**, **Max Of Result**, **Alpha Difference**, **Alpha Difference Only** | **Original** | Selects the output alpha rule. The mode table below defines each choice. |

### Temporal behavior and limits

A zero offset compares the input with itself.
With **Absolute Difference** on, equal colors produce black. With it off, equal colors produce 0.5 gray before alpha multiplication.

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
