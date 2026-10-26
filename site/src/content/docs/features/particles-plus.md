---
title: Choose a Particles+ sprite
description: Apply a bundled monochrome sprite through the native particle Texture picker.
sidebar:
  label: Particles+
---
Use Particles+ to change a native particle object's texture. The plugin adds 54 sprite presets to the existing picker.

## Set the particle texture

1. In **Plugins**, enable **Particles+**.
2. Select a native particle object.
3. Open its **Texture** picker.
4. Choose a sprite such as **circle**, **ring_outline**, or **flare_glint**.
5. Inspect the particles in the viewport.

For all preset names, see the [particle sprite catalogue](/docs/reference/particle-sprites/). These presets change the texture, not the particle simulation.

## Save or remove a sprite dependency

Selecting a sprite adds its image to the project's normal asset list. The project also records its Particles+ dependency.

1. Save the project after choosing a sprite.
2. To remove the dependency, replace every Particles+ particle texture with a native texture or your own image.
3. If the plugin remains in use, check other particle objects before disabling it.

The plugin manager blocks disabling Particles+ while the project uses its sprites. Such projects are marked incompatible with vanilla CM3.
