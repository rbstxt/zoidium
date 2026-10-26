---
title: Use a track or image as Layer Input
sidebar:
  label: Use Layer Input
---
Use another video track as an effect input or a material map. Layer Input selects top-level video tracks, not individual nested objects.

## Composite a source track

1. In **Plugins**, enable **Layer Input** and accept its experimental warning.
2. Put the source content on a separate video track.
3. Select the destination layer.
4. Add the **Layer Input** effect.
5. In **Source Layer**, select the source track.
6. Adjust **Source Opacity**.

The source track can stay hidden on the main timeline. Layer Input still captures its active clip. The destination cannot select its own track or a track that creates a dependency cycle.

If the picker shows **(Missing source)**, select an available track. Track references survive track reordering.

## Use a displacement map or material

To displace a layer, add **Layer Input Displacement Map**. Select a track in **Displacement Map Source**, then adjust the displacement controls.

To map a track onto a 3D object, choose **Layer Source** as the material type. Select the track in **Source Layer** and adjust **Opacity**.

For an image instead of a track, select **Image** in the source picker. Choose the file in **Source Image**. The project stores the image as an asset. With no image assigned, the effects leave their input unchanged and the material remains transparent.

## Add an input to a Custom Shader

1. Select the destination's **Custom Shader** effect.
2. Add a custom property of type **Layer Input**.
3. Name the property for the shader input.
4. Select the source track in that property's picker.
5. Select **Source**, **Masks**, or **Effects & Masks** in the adjacent input-mode selector.
6. Declare the corresponding shader input as `sampler2D`.

**Source** captures the layer before effects and masks. **Masks** applies mask effects only. **Effects & Masks** captures the final layer output and is the default. Each shader input keeps its own mode.

The shader path uses the track picker. For a static image in a Custom Shader, use the shader's image input instead.

If the source is unavailable or cyclic, choose another track before exporting. Test the result with [Render once](/docs/how-to/preview-heavy-project/). [Shader basics](/docs/shaders/basics/) covers shader inputs.
