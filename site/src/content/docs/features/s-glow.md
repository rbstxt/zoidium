---
title: Add glow with S_Glow
sidebar:
  label: S_Glow
---
Use **S_Glow (beta 1.0)** to add a soft glow to bright areas of a clip. The
effect thresholds the image, blurs the result, and combines it with the source.

## Add the effect

1. Enable **S_Glow (beta 1.0)** in Plugins.
2. Select a clip.
3. Add **S_Glow (beta 1.0)** under **NATIVE FX** in the Effects picker.
4. Raise **Threshold** until only the bright areas glow.

## Set the glow

- **Brightness** sets the glow intensity. **Color** tints the emitted light.
- **Glow Width** sets the glow reach in image pixels. **Width X** and
  **Width Y** scale the horizontal and vertical reach.
- **Width Red**, **Width Green**, and **Width Blue** set the reach for each
  color channel. Different values separate the color fringes.
- **Subpixel** smooths changes of fractional widths during animation.
- **Combine** sets how the glow blends with the source. **Screen** is the
  default. **Source Opacity** fades the source without reducing the glow.
- **Glow Under Source** places the source above the glow. **Affect Alpha**
  controls how much the glow adds to opacity.
- **Show** set to **Threshold** displays the emitter instead of the result.
  Return it to **Result** before export.

## Extend the borders

Glow that reaches past the image edge is clipped by the frame. Set **Expand
Borders** to **on** to add transparent padding before the glow is generated.
The final composition still clips the frame.

## Choose a blur engine

- **AE Match (3-box)** is the default. It runs three box blur passes with
  calibrated weights.
- **Performance (legacy)** uses the faster blur pass.

**Quality** sets the sampling precision of both engines. **Edge Mode** selects
how the blur samples outside the image edges.

## Use the atmosphere controls

**Atmosphere Amp** above zero adds dust and shadow structure to the glow.
**Atmosphere Freq**, **Atmosphere Detail**, **Atmosphere Seed**, and
**Atmosphere Speed** shape that structure. **Atmosphere Speed** set to zero
freezes it.

**Time Mode** set to **Automatic** follows the project timeline. Set it to
**Manual** to reveal **Time** and animate the atmosphere independently of the
playhead.

## Limits

Very large **Brightness** and **Glow Width** values increase GPU cost, and the
preview can be slow at high **Quality**. Check the result at the export frame
before a long render.

Contributed by MOUSEIIIIII.
