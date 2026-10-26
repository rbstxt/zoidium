---
title: Use an animated GIF
description: Import GIF images for layers, materials, and effect textures with repeatable frame timing.
sidebar:
  label: Animated GIF input
---
Use **Animated GIF** to animate GIF image assets in image layers, image materials, and effect textures. This plugin supports GIF input.

## Add a GIF image

For a large GIF, check the [decoder limits](/docs/reference/animated-gif/) before import.

1. In **Plugins**, enable **Animated GIF**.
2. Import the GIF as an image asset.
3. Assign the asset to an image layer, an image material, or an effect's image texture field.
4. Move the playhead to inspect different frames.

## Adjust the animation time

GIFs loop. Inside a clip, the selected GIF frame follows that clip's media time, including its offset and retiming.

1. Select the clip that contains the GIF consumer.
2. Adjust the clip's media-time animation to change the GIF timing.
3. Inspect a frame near the loop boundary.
4. To verify repeatable timing, return to an earlier frame.

Without a clip context, GIF animation follows project time. Export waits for GIF decoding through the image consumer's preparation chain.

The [GIF reference](/docs/reference/animated-gif/) describes frame delays, looping, and decode limits. Use the [export options](/docs/reference/export-options/) for output formats.
