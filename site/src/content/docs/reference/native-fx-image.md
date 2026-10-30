---
title: Native FX image filters
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX image filters
  order: 71
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

## Radial Blur (Spin)

Blurs the current image around a center with symmetric rotated samples.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | Bypasses the effect when off. |
| **Angle** | Number | -2 to 2 | 0.5 | Signed rotation amount, not degrees. |
| **Dither** | Number | 0 to 1 | 0.5 | Pixel-based jitter of the angular sample positions. |
| **Decay** | Number | 0 to 1 | 0.9 | Successive sample-weight multiplier away from the center sample. |
| **Center** | Vector2 | See component rows | `(0, 0)` | Center offset. |
| **Center.X** | Number | No effect-specific numeric bounds | 0 | Horizontal component of Center. |
| **Center.Y** | Number | No effect-specific numeric bounds | 0 | Vertical component of Center. |
| **Overbright** | Option | **off**, **on** | **off** | off normalizes the blur weights. on uses an unnormalized sum with an extra center contribution and a brightness falloff. |
| **Overbright Weight** | Number | 0 to 1 | 0.2 | Scales the blur sum only while Overbright is on. |

### Sampling and limits

This filter samples only the current input.

## Color Curves

Remaps RGB intensity through a composite curve and separate red, green, and blue curves.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | Bypasses the effect when off. |
| **Curves** | Text | Curve editor; see below | Identity curves | RGB maps the common input first, then R, G, and B remap their channels. |

### Curve data and limits

**Curves** defaults to an identity diagonal, with points `(0, 0)` and `(1, 1)` on each channel.
The channel buttons are **RGB**, **R**, **G**, and **B**. **Reset** restores the current channel to that diagonal.
Each channel stores 2 to 16 points, including the endpoints. Input and output coordinates are bounded to 0 to 1.
The editor status displays **Input** and **Output** on a 0 to 255 scale.
The filter applies the composite curve before each separate channel curve.
The input alpha is preserved.
**Curves** is not an animated property. **Enabled** is animated.

## Drop Shadow

Composites a colored, offset, blurred copy of the input alpha behind the input.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | Bypasses the effect when off. |
| **Shadow Color** | Color | No effect-specific numeric bounds | `[0, 0, 0]` | Shadow tint. |
| **Opacity** | Number | 0 to 1 | 0.5 | Shadow alpha multiplier. 0 hides the shadow. |
| **Angle** | Number | 0 to 360 | 135 | Offset direction in degrees. |
| **Distance** | Number | 0 to 200 | 10 | Offset distance in layer pixels. |
| **Blur** | Number | 0 to 50 | 10 | Blur amount. |

### Rendering and limits

The shadow uses the current input alpha. It does not sample another frame.
The shadow is clipped to the effect bounds. The original input composites over the shadow.

## Radial Shadow

Projects the input away from a point light to form a colored shadow.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | Bypasses the effect when off. |
| **Shadow Color** | Color | No effect-specific numeric bounds | `[0, 0, 0]` | Shadow tint before Color Influence. |
| **Opacity** | Number | 0 to 100 | 50 | Shadow opacity as a percentage. |
| **Light Source** | Vector2 | See component rows | `(0.3, 0.2)` | Light point in normalized image coordinates, with the origin at the top left. |
| **Light Source.X** | Number | 0 to 1 | 0.3 | Horizontal component of Light Source. |
| **Light Source.Y** | Number | 0 to 1 | 0.2 | Vertical component of Light Source. |
| **Projection Distance** | Number | 0 to 1000 | 10 | Radial expansion about Light Source. |
| **Softness** | Number | 0 to 1000 | 0 | Shadow blur size in pixels. Zero uses one shadow sample. |
| **Render** | Option | **Regular**, **Glass Edge** | **Regular** | Regular uses source alpha. Glass Edge emphasizes partial alpha. |
| **Color Influence** | Number | 0 to 100 | 0 | Percentage mix from Shadow Color toward the sampled source color. |
| **Shadow Only** | Option | **off**, **on** | **off** | on outputs the shadow without compositing the original input. |

### Rendering and limits

The shadow reads the current input only. The projection scales the image about **Light Source**.
Samples outside the input are transparent.
Large **Softness** values remain a coarse approximation.
**Glass Edge** depends on partial alpha. Fully opaque source areas produce no glass-edge shadow.
