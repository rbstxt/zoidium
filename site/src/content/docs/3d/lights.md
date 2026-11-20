---
title: Lights (Light+ and Trapcode Lights)
description: Add native 3D lights with Light+ or extended Cinema 4D style lights (Area, Sun, IES, Portal) with Rowbyte & Red Giant Suite.
---
Zoidium offers two light providers for 3D Scenes: **Light+** for native CM3 light types, and **Trapcode Lights** (inside **Rowbyte & Red Giant Suite**) for extended light types, decay, penumbra, color temperature, and IES profiles.

Keep only one light provider enabled when adding lights if you want a single uncluttered light menu, since both add their own picker groups and controls.
Note that **Single Color**, **Image+**, and **Matcap** materials are unlit and do not respond to scene lights.

## Light+ (native lights)

1. In **Plugins**, enable **Light+**.
2. Open the scene's 3D object picker and open **Light+**.
3. Choose **Spot light**, **Point light**, **Directional light**, or **Hemisphere light**.
4. Adjust **Position**, **Target**, **Color** (or **Sky color** and **Ground color**), **Intensity**, and **Angle** in the native Properties panel.

### Light+ types

| Picker name | Visible controls |
| --- | --- |
| **Spot light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Cast shadows** |
| **Point light** | **Position**, **Color**, **Intensity**, **Cast shadows** |
| **Directional light** | **Position**, **Target**, **Color**, **Intensity**, **Cast shadows** |
| **Hemisphere light** | **Sky color**, **Ground color**, **Intensity** |

Spot, Point, and Directional lights default **Position** to `[0, 100, 100]` and have **Cast shadows** turned **on** by default (static switch; turn it off on lights that do not need shadows). Hemisphere lights have no **Position** or **Target** rows.

## Trapcode Lights (Rowbyte & Red Giant Suite)

1. In **Plugins**, enable **Rowbyte & Red Giant Suite**.
2. Open the scene's 3D object picker and open **Trapcode Lights**.
3. Choose one of the eight light types below. To import photometry, choose **Photometric IES Light** and select a local LM-63 Type C `.ies` file with `TILT=NONE` in **IES File**.

| Picker name | Visible controls |
| --- | --- |
| **Point Light (Omni)** | **Position**, **Color**, **Intensity**, **Distance**, **Decay** |
| **Spot Light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Penumbra**, **Distance**, **Decay** |
| **Infinite Light (Directional)** | **Position**, **Target**, **Color**, **Intensity**, **Temperature (K)**, **Shadow Softness**, **Shadow Coverage** |
| **Area Light** | **Position**, **Target**, **Color**, **Intensity**, **Width**, **Height** |
| **Hemisphere Light (Sky/Ground)** | **Sky color**, **Ground color**, **Intensity** |
| **Photometric IES Light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Penumbra**, **Distance**, **Decay**, **IES Profile**, **IES File** |
| **Sun (Directional)** | **Target**, **Color**, **Intensity**, **Sun Azimuth**, **Sun Elevation** |
| **Portal Light** | **Position**, **Target**, **Color**, **Intensity**, **Width**, **Height** |

### Trapcode Lights behavior and limits

- **IES profiles:** **Photometric IES Light** imports local LM-63 Type C `.ies` files with `TILT=NONE` to shape angular intensity. Unsupported files leave the previous profile unchanged.
- **Area and Portal lights:** Use rectangular emitters; they do not provide path-traced indirect lighting.
- **Shadows:** **Cast shadows** defaults to **on** for Spot, Point, Infinite, and Sun lights, and **off** for Area, Portal, and IES lights. On Area and Portal lights, shadows cast from the rectangle's center sample.

## Control reference

A dash (`—`) means no declared minimum or maximum.

### Shared light controls

| Control | Type | Range | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | — | `[0, 100, 100]` (Light+) / `[0, 10, 0]` (Suite) | Light position in scene units. |
| **Target** | 3D vector | — | `[0, 0, 0]` | Aim point for directional and spot lights. |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Light RGB color. |
| **Sky color** | RGB color | `0` to `1` | `[1, 1, 1]` | Upper hemisphere color. |
| **Ground color** | RGB color | `0` to `1` | `[1, 1, 1]` | Lower hemisphere color. |
| **Intensity** | Number | `0` to `100` | `1` | Light brightness multiplier. |
| **Angle** | Number | `0` to `90` | `60` | Spot cone angle in degrees. |

### Trapcode Lights additions

| Control | Type | Range | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Distance** | Number | `0` to `5000` | `0` | Distance cutoff (`0` disables cutoff). |
| **Decay** | Number | `0` to `4` | `1` | Distance falloff exponent. |
| **Penumbra** | Number | `0` to `1` | `0.5` | Softness of the spot cone edge. |
| **Width**, **Height** | Number | `0.1` to `200` | `10` | Rectangular emitter dimensions. |
| **Sun Elevation** | Number | `-10` to `90` | `45` | Sun elevation angle in degrees. |
| **Sun Azimuth** | Number | `-180` to `180` | `0` | Sun azimuth angle in degrees. |
| **Temperature (K)** | Number | `1000` to `12000` | `6500` | Color temperature tint in kelvin. |
| **Shadow Softness** | Number | `0` to `10` | `1` | Shadow-map filter radius. |
| **Shadow Coverage** | Number | `10` to `2000` | `200` | Directional shadow camera coverage area. |
| **IES Profile** | Text | Text | `Downlight` | Built-in or imported angular intensity profile. |
| **IES File** | Text | Text | Empty | Local `.ies` file loader and removal control. |
