---
title: Particles+ sprites
description: Apply 54 bundled monochrome particle sprites through the native particle Texture picker.
---
Use **Particles+** to pick from 54 bundled `128 × 128` monochrome white-with-glow sprites inside a native particle object's **Texture** picker.
These presets replace only the particle texture; they do not change the native particle simulation.

## Choose a sprite

1. In **Plugins**, enable **Particles+**.
2. Select a native particle object in your 3D Scene.
3. Open its **Texture** picker and choose a sprite (such as **circle**, **ring_outline**, or **flare_glint**).
4. Save the project to keep the sprite asset.

Selecting a preset adds its image to your project's asset list and records a **Particles+** dependency (marked incompatible with plain CM3).
You cannot disable **Particles+** while any particle object uses one of its sprites. To remove the dependency, replace every Particles+ texture with a native texture or your own image.

## Sprite catalogue

### Geometry and patterns (31)

- **circle**, **square**, **triangle**, **pentagon**, **hexagon**, **octagon**, **diamond**
- **ring_outline**, **ring_double**, **triangle_outline**, **square_outline**, **rounded_square**, **rounded_square_outline**, **hexagon_outline**
- **plus**, **plus_cut_square**, **cross**, **cross_outline**, **line_horizontal**, **line_vertical**
- **grid**, **dot_grid**, **radial_lines**, **spiral**, **snowflake**, **lattice**, **concentric_rings**, **broken_ring**
- **star_5**, **star_6**, **star_8**

### Glows and flares (23)

- **flare_glow_ring**, **flare_halo**, **flare_double_halo**, **flare_blob**, **flare_orb_soft**
- **flare_burst**, **flare_burst_soft**, **flare_needles**, **flare_starburst_fine**, **flare_starburst_dust**, **flare_eight_ray**
- **flare_streak_thin**, **flare_streak_wide**, **flare_streak_glow**, **flare_vertical_streak**, **flare_crossbeam**
- **flare_fourdot**, **flare_fourdot_soft**, **flare_sixdot**, **flare_ring_streak**, **flare_ripple**, **flare_spectral**, **flare_glint**
