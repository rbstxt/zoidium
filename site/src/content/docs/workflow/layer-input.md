---
title: Layer Input
description: Feed another video track or image into an effect, displacement map, 3D material, or Custom Shader.
---
Use **Layer Input** (under **Experimental** in **Plugins**) to pass another top-level video track or a static image into an effect, displacement map, 3D material, or Custom Shader.
Layer Input targets top-level video tracks, not individual objects nested inside a 3D Scene.

## Composite a source track

1. In **Plugins**, enable **Layer Input** and accept the experimental warning.
2. Place the source content on a separate video track.
3. Select the destination clip.
4. Add the **Layer Input** effect.
5. In **Source Layer**, select the source track.
6. Adjust **Source Opacity**.

- You can hide the source track on the main timeline; Layer Input still captures its active clip.
- A destination cannot pick its own track or a track that forms a dependency cycle.
- Track references survive track reordering. If the picker shows **(Missing source)**, select an available track.

## Use a displacement map or 3D material

- **Displacement map:** Add **Layer Input Displacement Map**, choose a track in **Displacement Map Source**, and adjust the displacement controls.
- **3D material:** Set a 3D object's material type to **Layer Source**, pick the track in **Source Layer**, and adjust **Opacity**.
- **Image source:** To use a still image instead of a track, choose **Image** in the source picker and pick the file in **Source Image**. The project stores the image as an asset. When no image is assigned, the effects leave their input unchanged and the material renders transparent.

## Feed a track into a Custom Shader

1. Select the destination clip's **Custom Shader** effect.
2. Add a custom property of type **Layer Input** and name it for your shader uniform.
3. Choose the source track in that property's picker.
4. Choose the capture stage in the adjacent selector: **Source**, **Masks**, or **Effects & Masks** (default).
5. Declare the matching `sampler2D` uniform in your GLSL code.

| Capture stage | What is sampled |
| --- | --- |
| **Source** | The layer before effects and masks. |
| **Masks** | The layer with mask effects applied only. |
| **Effects & Masks** | Final rendered layer output (default). |

Each shader input keeps its own capture stage. The Custom Shader property uses the track picker only; for a static image inside a Custom Shader, use the shader's standard image input instead.

Before exporting, replace any unavailable or cyclic source. You can check the result on demand with **Render once** in [Preview and cache](/docs/workflow/preview-and-cache/). For shader basics, see [Write your first shader](/docs/shaders/basics/).
