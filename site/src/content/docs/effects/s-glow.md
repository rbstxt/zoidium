---
title: S_Glow
description: Add soft threshold glow with per-channel spread, border expansion, blur engine selection, and procedural atmosphere.
---
Use **S_Glow (beta 1.1)** to extract bright regions above a threshold, blur them with per-axis or per-channel spread, and blend the glow back over or under your clip.

## Add S_Glow

1. In **Plugins**, enable **S_Glow (beta 1.1)**.
2. Select a clip and add **S_Glow (beta 1.1)** under **NATIVE FX** in the Effects picker.
3. Raise **Threshold** until only the bright areas you want emit light.
4. Set **Show** to **Threshold** if you want to inspect the extracted emitter alone, then switch **Show** back to **Result** before export.

## Glow and compositing controls

- **Brightness** and **Color:** Control emitted light strength and tint.
- **Glow Width**, **Width X**, and **Width Y:** Set overall glow reach in image pixels and horizontal/vertical multipliers.
- **Width Red**, **Width Green**, and **Width Blue:** Set per-channel reach to create chromatic glow fringes.
- **Subpixel:** Smooths fractional width changes during animation.
- **Combine** and **Source Opacity:** Choose how glow blends with the source (**Screen** by default) and fade the original image without dimming the glow.
- **Glow Under Source** and **Affect Alpha:** Place the source on top of the glow and control how much glow adds to layer alpha.
- **Expand Borders:** Turn **on** to add transparent padding before blurring so glow near the clip edge is not cut off early (the final composition still clips at the frame boundary). If you turn **S_Glow** off with its header eye button, Zoidium skips border expansion as well. See [Bypassing effects](/docs/effects/bypass/).

## Blur engine and atmosphere

- **Blur engine:** **AE Match (3-box)** (default) runs three calibrated box-blur passes; **Performance (legacy)** uses a faster pass. **Quality** sets sampling precision for both engines, and **Edge Mode** sets out-of-bounds sampling behavior.
- **Atmosphere:** Raising **Atmosphere Amp** above `0` adds dust and shadow texture shaped by **Atmosphere Freq**, **Atmosphere Detail**, **Atmosphere Seed**, and **Atmosphere Speed** (`0` freezes motion). Keep **Time Mode** at **Automatic** to follow the project timeline, or switch to **Manual** to reveal **Time** and animate atmosphere independently.

## Performance limits

Very large **Brightness** and **Glow Width** values increase GPU cost, and high **Quality** can slow preview redraws. Check the export frame before starting a long render.

Contributed by MOUSEIIIIII.
