---
title: Animated GIF
description: Import animated GIFs as image layers, materials, or effect textures with deterministic clip timing and decoder limits.
---
Use **Animated GIF** to decode GIF87a and GIF89a image assets (including transparency and interlacing) and animate them in image layers, image materials, and effect textures.
This plugin handles GIF input only; it does not add a GIF export format.

## Add an animated GIF

For large GIFs, check the decoder limits below before importing.

1. In **Plugins**, enable **Animated GIF**.
2. Import the GIF as an image asset.
3. Assign the asset to an image layer, an image material, or an effect's image texture field.
4. Move the playhead to inspect the frames.

## Adjust animation timing

Decoded GIFs loop continuously, including at negative media time.
Inside a clip, the displayed GIF frame follows that clip's media time, including clip offset and retiming.

1. Select the clip that uses the GIF.
2. Animate the clip's **Time** property to speed up, slow down, or hold the GIF.
3. Scrub across a loop boundary and back to an earlier frame to verify repeatable timing.

Outside a clip context, GIF playback follows project time. Exports wait for GIF decoding to finish before capturing frames.

GIF frame delays are stored in hundredths of a second. A stored delay of `0` or `1` becomes `0.10` seconds. A delay of `2` or more keeps its encoded value (for example, `2` is `0.02` seconds).

## Decoder limits

| Limit | Cap | Behavior when reached |
| --- | --- | --- |
| Frames | `512` | Decoding stops at the frame cap. |
| Canvas area | `67,108,864` pixels | A larger GIF canvas fails decoding. |
| Accumulated frame area | `67,108,864` pixels | Each decoded frame consumes full canvas size from this budget. Decoding stops once the remaining budget reaches zero or less. |

For video and still-image output formats, see [Exporting video and frames](/docs/workflow/export/).
