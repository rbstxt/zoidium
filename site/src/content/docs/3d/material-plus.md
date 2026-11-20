---
title: Material+
description: Shade 3D objects with PBR+, Node Material, Matcap, UV Custom, and Image+ materials with corrected 3D Text UVs.
---
Use **Material+** to replace or extend CM3's default materials with five material types (**PBR+**, **Node Material**, **Matcap**, **UV Custom**, and **Image+**).
On 3D Text and extruded shapes, Material+ applies a corrected UV layout: front and back caps map cleanly to the text bounds, and side walls unwrap smoothly along the outline without shearing.

## Choose and set up a material

1. In **Plugins**, enable **Material+**.
2. Select a 3D object and open its material in the native Properties panel.
3. Choose the material type that fits your look:
   - **PBR+:** Physically based lighting with separate texture maps, Color Ramp, Fresnel, cel shading, clearcoat, and optional node graph.
   - **Node Material:** Procedural GPU node graph baked into surface maps (opens with **Use node graph** on).
   - **Matcap:** View-dependent shading from a Matcap image (ignores scene lights).
   - **UV Custom:** Native Custom Material controls paired with Material+'s corrected UV layout.
   - **Image+:** Unlit image surface with opacity and UV controls.

### Add a Color Ramp (PBR+ and Node Material)

1. Turn **Color Ramp** to **on**.
2. Edit the **Color Ramp Curve** gradient.
3. Choose **Color Ramp Source** (**luminance**, **u**, or **v**).
4. Set **Color Ramp Interpolation** and **Color Ramp Factor** to blend the ramp into the base color.

### Build a Node Material

1. Choose **Node Material** (or enable **Use node graph** on **PBR+**).
2. Click **Open Node Editor**.
3. Add nodes from the searchable menu (or pick a starter recipe) and connect them to **Output**.
4. For **Image** or **Texture** nodes, assign the asset in **Selected node image**.
5. Choose **Bake Resolution** and inspect the result in the viewport. **Undo** restores the previous graph.

See [Material+ node reference](/docs/3d/material-nodes/) for every node's inputs, outputs, and limits.

## Property reference

A dash (`—`) means no declared minimum or maximum.

### PBR+

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Base-color multiplier. |
| **Texture (Base color)** | Asset | `image/*` | None | Base-color image multiplied by **Color**. |
| **Emissive** | RGB color | `0` to `1` | `[0, 0, 0]` | Light-independent surface color. |
| **Emissive intensity** | Number | ≥ 0 | `1` | Multiplier for emissive color and map. |
| **Emissive map** | Asset | `image/*` | None | Image modulating emission. |
| **Roughness** | Number | `0` to `1` | `0.5` | Surface roughness (lower gives sharper highlights). |
| **Roughness map** | Asset | `image/*` | None | Image modulating roughness. |
| **Metalness** | Number | `0` to `1` | `0` | Dielectric-to-metallic blend. |
| **Metalness map** | Asset | `image/*` | None | Image modulating metalness. |
| **Normal map** | Asset | `image/*` | None | Tangent-space normal image. |
| **Normal scale** | Number | ≥ 0 | `1` | Normal-map strength. |
| **Alpha map** | Asset | `image/*` | None | Image modulating surface alpha. |
| **Alpha threshold** | Number | `0` to `1` | `0` | Discards pixels below this alpha. |
| **Reflection** | Choice | **off**, **on** | **off** | Uses the scene environment unless **Environment image** overrides it. |
| **Reflection intensity** | Number | ≥ 0 | `1` | Multiplier for environment reflection. |
| **Transparency** | Choice | **off**, **on** | **off** | Enables alpha transparency. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Blending** | Choice | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | Blend operation against the destination image. Usually has no visible effect while **Transparency** is off. |
| **Render side** | Choice | **front**, **back**, **both** | **front** | Faces rendered. |
| **Wrap** | Choice | **none**, **tile**, **reflect** | **tile** | Clamps, tiles, or mirrors texture coordinates. |
| **Repeat** | 2D vector | — | `[1, 1]` | U and V texture repetition. |
| **Offset** | 2D vector | — | `[0, 0]` | U and V texture translation. |
| **Center** | 2D vector | — | `[0, 0]` | Pivot for texture transform. |
| **Rotation** | Number | — | `0` | Texture rotation in degrees. |

### Shared PBR+ and Node Material surface controls

**Node Material** starts with these defaults, plus **Bump Strength** `1` and **Use node graph** **on**.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Bake Resolution** | Choice | **128**, **256**, **512**, **1024**, **2048** | **256** | Square baked map size. |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Surface color. |
| **Luminance Color** | RGB color | `0` to `1` | `[0, 0, 0]` | Light-independent surface color. |
| **Color Ramp** | Choice | **off**, **on** | **off** | Enables the surface color ramp. |
| **Color Ramp Curve** | Gradient | Editable stops | Black to white | Color stops for Color Ramp. |
| **Color Ramp Source** | Choice | **luminance**, **u**, **v** | **luminance** | Ramp input coordinate. |
| **Color Ramp Interpolation** | Choice | **linear**, **constant**, **ease** | **linear** | Stop interpolation mode. |
| **Color Ramp Factor** | Number | `0` to `1` | `1` | Ramp blend factor. |
| **Roughness** | Number | `0` to `1` | `0.5` | Surface roughness. |
| **Metalness** | Number | `0` to `1` | `0.5` | Dielectric-to-metallic blend. |
| **Texture** | Asset | `image/*` | None | Base-color image multiplied by **Color**. |
| **Bump Strength** | Number | `0` to `2` | `0` | Graph or procedural bump strength. |
| **Bump Noise** | Choice | **off**, **on** | **off** | Uses procedural noise instead of graph Bump output. |
| **Bump Noise Scale** | Number | `1` to `1024` | `4` | Procedural bump pattern scale. Values above 64 repeat a seamless noise tile at a higher frequency. |
| **Bump MIP Falloff** | Choice | **off**, **on** | **on** | Reduces bump detail at distance. |
| **Fresnel** | Choice | **off**, **on** | **off** | Enables view-angle rim tint. |
| **Fresnel Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Rim tint color. |
| **Fresnel Power** | Number | `0.1` to `8` | `4` | Rim falloff sharpness. |
| **Fresnel Mix Strength** | Number | `0` to `1` | `0.7` | Fresnel blend amount. |
| **Ambient occlusion map** | Choice | **off**, **on** | **off** | Enables image-based ambient occlusion (does not trace scene geometry). |
| **Ambient occlusion map texture** | Asset | `image/*` | None | Occlusion map image. |
| **Ambient Occlusion Intensity** | Number | `0` to `1` | `0.5` | Occlusion tint strength. |
| **Ambient occlusion exponent** | Number | `0.01` to `8` | `1` | Exponent on the occlusion map. |
| **Ambient Occlusion Color** | RGB color | `0` to `1` | `[0, 0, 0]` | Tint applied to occluded areas. |
| **Cel Renderer** | Choice | **off**, **on** | **off** | Enables stepped toon diffuse and specular shading. |
| **Cel Steps** | Number | `1` to `16` | `4` | Diffuse band count. |
| **Cel Smoothness** | Number | `0` to `1` | `0.1` | Softness between cel bands. |
| **Cel Specular Steps** | Number | `1` to `32` | `6` | Specular band count. |
| **Projection** | Choice | **uv**, **spherical**, **cylindrical**, **cubic** | **uv** | Texture projection mode. |
| **Projection Translation** | 3D vector | — | `[0, 0, 0]` | Projection frame translation. |
| **Projection Rotation** | 3D vector | — | `[0, 0, 0]` | Projection rotation in degrees. |
| **Projection Scale** | 3D vector | — | `[1, 1, 1]` | Projection scale per axis. |
| **Projection Lock Aspect Ratio** | Choice | **off**, **on** | **off** | Uses X scale for all axes. |
| **Reflection Layer** | Choice | **off**, **on** | **off** | Enables clearcoat reflection layer. |
| **Reflection Layer Strength** | Number | `0` to `1` | `1` | Clearcoat strength. |
| **Reflection Layer Opacity** | Number | `0` to `1` | `1` | Clearcoat opacity multiplier. |
| **Reflection Layer Roughness** | Number | `0` to `1` | `0` | Clearcoat roughness. |
| **Specular Layer** | Choice | **off**, **on** | **on** | Enables specular layer. |
| **Specular Strength** | Number | `0` to `2` | `1` | Specular strength. |
| **Specular Opacity** | Number | `0` to `1` | `1` | Specular opacity multiplier. |
| **Global Reflection Brightness** | Number | `0` to `2` | `1` | Overall reflection brightness multiplier. |
| **Emission strength** | Number | ≥ 0 | `1` | Strength of RGB Emission from the node graph. |
| **Clearcoat**, **Clearcoat roughness** | Number | `0` to `1` | `0` | Clearcoat controls when **Reflection Layer** is off. |
| **Reflectivity** | Number | `0` to `1` | `0.5` | Dielectric reflectivity. |
| **Environment image** | Asset | `image/*` | None | Equirectangular reflection map (overrides scene environment independently of **Reflection**). Must use power-of-two dimensions up to 4096×2048; HDR and EXR are unsupported. |
| **Environment intensity** | Number | ≥ 0 | `1` | Reflection map multiplier. |
| **Environment rotation** | Number | — | `0` | Environment rotation in degrees. |
| **Shadow side** | Choice | **Auto**, **Front**, **Back**, **Double** | **Auto** | Faces used to cast shadows (**Auto** uses **Back** on double-sided materials). |

### Matcap

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Matcap** | Asset | `image/*` | None | View-dependent shading sphere image (ignores scene lights). |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Tint multiplied by the Matcap image. |
| **Brightness** | Number | ≥ 0 | `1` | Brightness multiplier. |
| **Transparency** | Choice | **off**, **on** | **off** | Enables alpha transparency. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Blending** | Choice | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | Blend operation against the destination image. Usually has no visible effect while **Transparency** is off. |
| **Render side** | Choice | **front**, **back**, **both** | **front** | Faces rendered. |

### UV Custom

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Base-color multiplier. |
| **Emissive** | RGB color | `0` to `1` | `[0, 0, 0]` | Light-independent color. |
| **Roughness** | Number | `0` to `1` | `0.5` | Surface roughness. |
| **Metalness** | Number | `0` to `1` | `0.5` | Dielectric-to-metallic blend. |
| **Texture** | Asset | `image/*` | None | Base-color image. |
| **Transparency** | Choice | **off**, **on** | **off** | Enables alpha transparency. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Blending** | Choice | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | Blend operation against the destination image. Usually has no visible effect while **Transparency** is off. |
| **Render side** | Choice | **front**, **back**, **both** | **front** | Faces rendered. |
| **Normal map** | Asset | `image/*` | None | Tangent-space normal image. |
| **Normal scale** | Number | ≥ 0 | `1` | Normal-map strength. |
| **Wrap** | Choice | **none**, **tile**, **reflect** | **tile** | Texture coordinate wrap mode. |
| **Repeat**, **Offset**, **Center** | 2D vector | — | `[1, 1]`, `[0, 0]`, `[0, 0]` | Texture UV transform. |
| **Rotation** | Number | — | `0` | Texture rotation in degrees. |
| **Reflection** | Choice | **off**, **on** | **off** | Uses scene environment reflection. |

### Image+

**Image+** is unlit. Assign an image asset to **Image** (default empty). **Transparency**, **Opacity**, **Wrap**, **Repeat**, **Offset**, **Center**, **Rotation**, and **Render side** match the **PBR+** types, ranges, and defaults above.
