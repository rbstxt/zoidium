---
title: Trapcode light properties
description: Eight suite light types, visible controls, defaults, and IES restrictions.
sidebar:
  label: Trapcode lights
---
The suite registers eight light types under **Trapcode Lights**. These are separate from Light+ native variants.


## Light types

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


## Shared controls

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | No declared bounds | `[0, 10, 0]` | Light position in scene units. |
| **Target** | 3D vector | No declared bounds | `[0, 0, 0]` | Point toward which the light aims. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Light RGB color. |
| **Sky color** | RGB color | 0 to 1 | `[1, 1, 1]` | Color from above. |
| **Ground color** | RGB color | 0 to 1 | `[1, 1, 1]` | Color from below. |
| **Intensity** | Number | 0 to 100 | `1` | Multiplier of light output. |
| **Angle** | Number | 0 to 90 | `60` | Spot cone angle in degrees. |


## Suite additions

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Distance** | Number | 0 to 5000 | `0` | Distance cutoff. Zero has no finite cutoff. |
| **Decay** | Number | 0 to 4 | `1` | Distance attenuation exponent. |
| **Penumbra** | Number | 0 to 1 | `0.5` | Softness of the spot cone edge. |
| **Width** | Number | 0.1 to 200 | `10` | Rectangular emitter width. |
| **Height** | Number | 0.1 to 200 | `10` | Rectangular emitter height. |
| **Sun Elevation** | Number | -10 to 90 | `45` | Sun elevation in degrees. |
| **Sun Azimuth** | Number | -180 to 180 | `0` | Sun azimuth in degrees. |
| **Temperature (K)** | Number | 1000 to 12000 | `6500` | Color temperature multiplier in kelvin. |
| **Shadow Softness** | Number | 0 to 10 | `1` | Shadow-map filtering radius. |
| **Shadow Coverage** | Number | 10 to 2000 | `200` | Directional shadow camera coverage. |
| **IES Profile** | Text | Text | `Downlight` | Built-in or imported angular light profile. |
| **IES File** | Text | Text | Empty | Local IES file, with load and removal controls. |


## IES, area lights, and shadows

IES imports accept LM-63 Type C profiles with `TILT=NONE`. The profile modifies angular light intensity. Unsupported files leave the previous profile intact.

Area Light and Portal Light use rectangular emitters with standard or physical materials. Without the required floating-point texture filtering, they use nine one-sided spot samples. They do not provide path-traced indirect lighting.

[Add suite objects and lights](/docs/features/trapcode-suite/)
