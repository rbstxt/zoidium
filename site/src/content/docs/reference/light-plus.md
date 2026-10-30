---
title: Light+ lights
description: Light variants, defaults, ranges, and material response.
sidebar:
  label: Light+ reference
---
Light+ adds scene lights. Single Color, Image+, and Matcap materials do not respond to them.


## Light types

| Picker name | Visible controls |
| --- | --- |
| **Spot light** | **Position**, **Target**, **Color**, **Intensity**, **Angle** |
| **Point light** | **Position**, **Color**, **Intensity** |
| **Directional light** | **Position**, **Target**, **Color**, **Intensity** |
| **Hemisphere light** | **Sky color**, **Ground color**, **Intensity** |


## Shared controls

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | Any value | `[0, 100, 100]` | Light position in scene units. |
| **Target** | 3D vector | Any value | `[0, 0, 0]` | Point toward which the light aims. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Light RGB color. |
| **Sky color** | RGB color | 0 to 1 | `[1, 1, 1]` | Color from above. |
| **Ground color** | RGB color | 0 to 1 | `[1, 1, 1]` | Color from below. |
| **Intensity** | Number | 0 to 100 | `1` | Multiplier of light output. |
| **Angle** | Number | 0 to 90 | `60` | Spot cone angle in degrees. |

Spot, Point, and Directional presets override Position to `0, 100, 100`. Hemisphere has no Position or Target rows.

[Add native lights with Light+](/docs/features/light-plus/)
