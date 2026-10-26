---
title: Native FX image filters
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX image filters
  order: 71
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

Numeric ranges are the minimum and maximum in the property definitions. Color defaults are RGB component values.

## Radial Blur (Spin)

Blurs the current image around a center with symmetric rotated samples.

Editor location: **Effects** picker > **NATIVE FX** > **Radial Blur (Spin)**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Angle** | Number | -2 to 2 | 0.5 | Signed rotation amount. The shader uses this value times 0.2 radians across its sample steps; this is not a degree value. |
| **Dither** | Number | 0 to 1 | 0.5 | Pixel-based jitter of the angular sample positions. |
| **Decay** | Number | 0 to 1 | 0.9 | Successive sample-weight multiplier away from the center sample. |
| **Center** | Vector2 | See component rows | `(0, 0)` | Center offset. Each component maps to image coordinate 0.5 + component × 0.45. |
| **Center.X** | Number | No effect-specific numeric bounds | 0 | Horizontal component of Center. |
| **Center.Y** | Number | No effect-specific numeric bounds | 0 | Vertical component of Center. |
| **Overbright** | Option | **off**, **on** | **off** | off normalizes the blur weights. on uses an unnormalized sum with an extra center contribution and a brightness falloff. |
| **Overbright Weight** | Number | 0 to 1 | 0.2 | Scales the blur sum only while Overbright is on. With Overbright off, positive weights cancel during normalization. |

### Sampling and limits

This filter samples only the current input. It uses 25 rotated texture reads with a fixed 24-step angular scale.
**Dither** depends on pixel position, not playback history.
With **Overbright** off, a zero **Overbright Weight** produces a zero normalization divisor.

## Color Curves

Remaps RGB intensity through a composite curve and separate red, green, and blue curves.

Editor location: **Effects** picker > **NATIVE FX** > **Color Curves**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Curves** | Text | Curve editor; see below | Identity curves | Curve editor stored as text. RGB maps the common input first, then R, G, and B remap their respective channels. |

### Curve data and limits

**Curves** defaults to an identity diagonal, with points `(0, 0)` and `(1, 1)` on each channel.
The channel buttons are **RGB**, **R**, **G**, and **B**. **Reset** restores the current channel to that diagonal.
Each channel stores 2 to 16 points, including the endpoints. Input and output coordinates are bounded to 0 to 1.
The editor status displays **Input** and **Output** on a 0 to 255 scale.
The filter applies the composite curve before each separate channel curve through a 256-entry lookup texture.
The input alpha is preserved.
**Curves** is not an animated property. **Enabled** is animated.

## Drop Shadow

Composites a colored, offset, blurred copy of the input alpha behind the input.

Editor location: **Effects** picker > **NATIVE FX** > **Drop Shadow**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Shadow Color** | Color | No effect-specific numeric bounds | `[0, 0, 0]` | Shadow tint. |
| **Opacity** | Number | 0 to 1 | 0.5 | Shadow alpha multiplier. A stored zero currently renders with the 0.5 fallback. |
| **Angle** | Number | 0 to 360 | 135 | Offset direction in degrees. A stored zero currently renders with the 135 fallback. |
| **Distance** | Number | 0 to 200 | 10 | Offset distance in layer pixels. A stored zero currently renders with the 10 fallback. |
| **Blur** | Number | 0 to 50 | 10 | Blur amount. Three horizontal and vertical blur pairs use a kernel delta of Blur / 10. Zero currently uses the 10 fallback. |

### Rendering and limits

The shadow uses the current input alpha. It does not sample another frame.
The shadow is clipped to the effect buffer. The original input composites over the shadow.
The implementation allocates two scratch targets and performs three horizontal and vertical blur pairs.
Stored zero values for **Opacity**, **Angle**, **Distance**, and **Blur** currently take their nonzero fallback values during rendering.

## Radial Shadow

Projects the input away from a point light to form a colored shadow.

Editor location: **Effects** picker > **NATIVE FX** > **Radial Shadow**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Shadow Color** | Color | No effect-specific numeric bounds | `[0, 0, 0]` | Shadow tint before Color Influence. |
| **Opacity** | Number | 0 to 100 | 50 | Shadow opacity as a percentage. |
| **Light Source** | Vector2 | See component rows | `(0.3, 0.2)` | Light point in normalized image coordinates, with the origin at the top left. |
| **Light Source.X** | Number | 0 to 1 | 0.3 | Horizontal component of Light Source. |
| **Light Source.Y** | Number | 0 to 1 | 0.2 | Vertical component of Light Source. |
| **Projection Distance** | Number | 0 to 1000 | 10 | Radial scale is 1 + this value / 100 about Light Source. |
| **Softness** | Number | 0 to 1000 | 0 | Pixel scale of the fixed 5 × 5 shadow blur. Zero uses one shadow sample. |
| **Render** | Option | **Regular**, **Glass Edge** | **Regular** | Regular uses source alpha. Glass Edge emphasizes partial alpha with 4 × alpha × (1 − alpha). |
| **Color Influence** | Number | 0 to 100 | 0 | Percentage mix from Shadow Color toward the sampled source color. |
| **Shadow Only** | Option | **off**, **on** | **off** | on outputs the shadow without compositing the original input. |

### Rendering and limits

The shadow reads the current input only. The projection scales the image about **Light Source**.
Samples outside the input are transparent. The output remains within the effect buffer.
This is one shader pass. Positive **Softness** uses a fixed 5 × 5 kernel, so large radii remain a coarse approximation.
**Glass Edge** depends on partial alpha. Fully opaque source areas produce no glass-edge shadow.
