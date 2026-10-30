---
title: Material+ properties
description: Material slots, maps, UV transforms, physical surface controls, and environment limits.
sidebar:
  label: Material+ reference
---
Material+ registers **Matcap**, **PBR+**, **UV Custom**, **Node Material**, and **Image+**. A — range means no declared minimum or maximum.


## PBR+

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Base-color multiplier. |
| **Texture (Base color)** | Asset | image/* | None | Base-color image multiplied by Color. |
| **Emissive** | RGB color | 0 to 1 | `[0, 0, 0]` | Light-independent surface color. |
| **Emissive intensity** | Number | ≥ 0 | `1` | Multiplier for emissive color and its map. |
| **Emissive map** | Asset | image/* | None | Image that modulates emission. |
| **Roughness** | Number | 0 to 1 | `0.5` | Surface roughness. Lower values give sharper highlights. |
| **Roughness map** | Asset | image/* | None | Image that modulates roughness. |
| **Metalness** | Number | 0 to 1 | `0` | Blend between dielectric and metallic surface response. |
| **Metalness map** | Asset | image/* | None | Image that modulates metalness. |
| **Normal map** | Asset | image/* | None | Tangent-space normal image. |
| **Normal scale** | Number | ≥ 0 | `1` | Strength of the imported normal image. |
| **Alpha map** | Asset | image/* | None | Image that modulates surface alpha. |
| **Alpha threshold** | Number | 0 to 1 | `0` | Discards fragments below this alpha. |
| **Reflection** | Choice | **off**, **on** | **off** | Uses the scene environment when no Environment image overrides it. |
| **Reflection intensity** | Number | ≥ 0 | `1` | Multiplier for environment reflection. |
| **Transparency** | Choice | **off**, **on** | **off** | Enables alpha transparency. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Blending** | Choice | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | Blend operation against the destination image. |
| **Render side** | Choice | **front**, **back**, **both** | **front** | Faces included in rendering. |
| **Wrap** | Choice | **none**, **tile**, **reflect** | **tile** | Clamps, repeats, or mirrors image coordinates. |
| **Repeat** | 2D vector | — | `[1, 1]` | U and V texture repetition factors. |
| **Offset** | 2D vector | — | `[0, 0]` | U and V texture translation. |
| **Center** | 2D vector | — | `[0, 0]` | Pivot for the texture transform. |
| **Rotation** | Number | — | `0` | Rotation in degrees. |


## Shared PBR+ and Node Material surface controls

Node Material uses the surface defaults below, with **Bump Strength** `1` and **Use node graph** **on**.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Bake Resolution** | Choice | **128**, **256**, **512**, **1024**, **2048** | **256** | Square map dimensions. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Surface color. Node Material starts white. |
| **Luminance Color** | RGB color | 0 to 1 | `[0, 0, 0]` | Light-independent surface color. |
| **Color Ramp** | Choice | **off**, **on** | **off** | Enables the surface color ramp. |
| **Color Ramp Curve** | Gradient | Editable stops | Black to white | Color stops used by Color Ramp. |
| **Color Ramp Source** | Choice | **luminance**, **u**, **v** | **luminance** | Input coordinate for the ramp. |
| **Color Ramp Interpolation** | Choice | **linear**, **constant**, **ease** | **linear** | Interpolation between ramp stops. |
| **Color Ramp Factor** | Number | 0 to 1 | `1` | Mix amount for the color ramp. |
| **Roughness** | Number | 0 to 1 | `0.5` | Surface roughness. Lower values give sharper highlights. |
| **Metalness** | Number | 0 to 1 | `0.5` | Blend between dielectric and metallic surface response. |
| **Texture** | Asset | image/* | None | Base-color image multiplied by Color. |
| **Bump Strength** | Number | 0 to 2 | `0` | Strength of graph or procedural bump detail. |
| **Bump Noise** | Choice | **off**, **on** | **off** | Uses noise instead of the graph Bump output. |
| **Bump Noise Scale** | Number | 1 to 64 | `4` | Scale of the procedural bump pattern. |
| **Bump MIP Falloff** | Choice | **off**, **on** | **on** | Reduces distant bump detail. |
| **Fresnel** | Choice | **off**, **on** | **off** | Enables view-angle color tint. |
| **Fresnel Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Color of the view-angle tint. |
| **Fresnel Power** | Number | 0.1 to 8 | `4` | Shape of the view-angle transition. |
| **Fresnel Mix Strength** | Number | 0 to 1 | `0.7` | Mix amount of the Fresnel tint. |
| **Ambient occlusion map** | Choice | **off**, **on** | **off** | Enables image-based ambient occlusion shading. |
| **Ambient occlusion map texture** | Asset | image/* | None | Image used for ambient occlusion. |
| **Ambient Occlusion Intensity** | Number | 0 to 1 | `0.5` | Amount of ambient occlusion tint. |
| **Ambient occlusion exponent** | Number | 0.01 to 8 | `1` | Exponent applied to the occlusion map. |
| **Ambient Occlusion Color** | RGB color | 0 to 1 | `[0, 0, 0]` | Tint of occluded areas. |
| **Cel Renderer** | Choice | **off**, **on** | **off** | Enables stepped diffuse and specular shading. |
| **Cel Steps** | Number | 1 to 16 | `4` | Number of diffuse shading levels. |
| **Cel Smoothness** | Number | 0 to 1 | `0.1` | Softness between cel shading levels. |
| **Cel Specular Steps** | Number | 1 to 32 | `6` | Number of specular shading levels. |
| **Projection Rotation** | 3D vector | — | `[0, 0, 0]` | Projection rotation in degrees. |
| **Projection Scale** | 3D vector | — | `[1, 1, 1]` | Projection scale on each axis. |
| **Projection Translation** | 3D vector | — | `[0, 0, 0]` | Translation of the projection frame. |
| **Projection Lock Aspect Ratio** | Choice | **off**, **on** | **off** | Uses the X scale for all projection axes. |
| **Projection** | Choice | **uv**, **spherical**, **cylindrical**, **cubic** | **uv** | UV, spherical, cylindrical, or cubic texture projection. |
| **Reflection Layer** | Choice | **off**, **on** | **off** | Enables the reflection layer and its clearcoat controls. |
| **Reflection Layer Strength** | Number | 0 to 1 | `1` | Strength of reflection-layer clearcoat. |
| **Reflection Layer Opacity** | Number | 0 to 1 | `1` | Opacity multiplier for reflection-layer clearcoat. |
| **Reflection Layer Roughness** | Number | 0 to 1 | `0` | Roughness of the reflection layer. |
| **Specular Layer** | Choice | **off**, **on** | **on** | Enables the specular layer. |
| **Specular Strength** | Number | 0 to 2 | `1` | Strength of the specular layer. |
| **Specular Opacity** | Number | 0 to 1 | `1` | Opacity multiplier for the specular layer. |
| **Global Reflection Brightness** | Number | 0 to 2 | `1` | Multiplier for reflection brightness. |
| **Emission strength** | Number | ≥ 0 | `1` | Strength of RGB Emission from the graph. |
| **Clearcoat** | Number | 0 to 1 | `0` | Clearcoat amount when Reflection Layer is off. |
| **Clearcoat roughness** | Number | 0 to 1 | `0` | Clearcoat roughness when Reflection Layer is off. |
| **Reflectivity** | Number | 0 to 1 | `0.5` | Dielectric reflectivity. |
| **Environment image** | Asset | image/* | None | Equirectangular reflection image. Overrides the scene environment independently of Reflection. |
| **Environment intensity** | Number | ≥ 0 | `1` | Multiplier for the chosen Environment image. |
| **Environment rotation** | Number | — | `0` | Environment image rotation in degrees. |
| **Shadow side** | Choice | **Auto**, **Front**, **Back**, **Double** | **Auto** | Faces used for shadow casting. Auto uses Back for double-sided materials. |

**Selected node image** holds the image for the selected Image or Texture node.


## Matcap

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Matcap** | Asset | image/* | None | View-dependent shading image. Scene lights do not change this material. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Tint multiplied by the Matcap image. |
| **Brightness** | Number | ≥ 0 | `1` | Multiplier for Matcap image brightness. |
| **Transparency** | Choice | **off**, **on** | **off** | Enables alpha transparency. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Blending** | Choice | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | Blend operation against the destination image. |
| **Render side** | Choice | **front**, **back**, **both** | **front** | Faces included in rendering. |


## UV Custom

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Base-color multiplier. |
| **Emissive** | RGB color | 0 to 1 | `[0, 0, 0]` | Light-independent surface color. |
| **Roughness** | Number | 0 to 1 | `0.5` | Surface roughness. Lower values give sharper highlights. |
| **Metalness** | Number | 0 to 1 | `0.5` | Blend between dielectric and metallic surface response. |
| **Texture** | Asset | image/* | None | Base-color image multiplied by Color. |
| **Transparency** | Choice | **off**, **on** | **off** | Enables alpha transparency. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Blending** | Choice | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | Blend operation against the destination image. |
| **Render side** | Choice | **front**, **back**, **both** | **front** | Faces included in rendering. |
| **Normal map** | Asset | image/* | None | Tangent-space normal image. |
| **Normal scale** | Number | ≥ 0 | `1` | Strength of the imported normal image. |
| **Wrap** | Choice | **none**, **tile**, **reflect** | **tile** | Clamps, repeats, or mirrors image coordinates. |
| **Repeat** | 2D vector | — | `[1, 1]` | U and V texture repetition factors. |
| **Offset** | 2D vector | — | `[0, 0]` | U and V texture translation. |
| **Center** | 2D vector | — | `[0, 0]` | Pivot for the texture transform. |
| **Rotation** | Number | — | `0` | Rotation in degrees. |
| **Reflection** | Choice | **off**, **on** | **off** | Uses the scene environment when no Environment image overrides it. |


## Image+

Image+ is unlit. **Image** is an image asset, default empty. **Transparency**, **Opacity**, **Wrap**, **Repeat**, **Offset**, **Center**, **Rotation**, and **Render side** have the PBR+ types, ranges, and defaults above.


## Map composition and limits

On 3D Text and extruded shapes, caps map to the text bounds and side walls unwrap along the outline. Matcap uses view direction.

Ambient occlusion uses a map; it does not compute shadows from scene geometry.

Environment images must use power-of-two dimensions up to 4096 by 2048. HDR and EXR files are not supported.

[Material node properties](/docs/reference/material-nodes/)

[Shade objects with Material+](/docs/features/material-plus/)
