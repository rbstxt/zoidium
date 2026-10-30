---
title: AfterClip effect catalogue
description: Registered effects, picker categories, and group presets.
sidebar:
  label: AfterClip catalogue
---
AfterClip registers 32 standalone effects and 11 group presets. A standalone effect inserts one shader. A group inserts a saved chain of child effects.

## Standalone effects

| Effect | Picker category | ID |
| --- | --- | --- |
| **Circle Dot Wave** | **SHADERS · REPEAT** | `afterclip-repeat-circle-dot-wave` |
| **Dot Wave** | **SHADERS · REPEAT** | `afterclip-repeat-dot-wave` |
| **Duplicate (Extended)** | **SHADERS · REPEAT** | `afterclip-repeat-duplicate-extended` |
| **Gradient Linear Repeat** | **SHADERS · REPEAT** | `afterclip-repeat-gradient-linear-repeat` |
| **Hex Dot Wave** | **SHADERS · REPEAT** | `afterclip-repeat-hex-dot-wave` |
| **Linear Repeat** | **SHADERS · REPEAT** | `afterclip-repeat-linear-repeat` |
| **Radial Repeat** | **SHADERS · REPEAT** | `afterclip-repeat-radial-repeat` |
| **Stroke (Extended)** | **SHADERS · REPEAT** | `afterclip-repeat-stroke-extended` |
| **Arrow Shape** | **SHADERS · SHAPE** | `afterclip-shape-arrow` |
| **Chevron** | **SHADERS · SHAPE** | `afterclip-shape-chevron` |
| **CLE** | **SHADERS · SHAPE** | `afterclip-shape-cle` |
| **Gradient (Easeable)** | **SHADERS · SHAPE** | `afterclip-shape-gradient-overlay-easeable` |
| **Hex Net** | **SHADERS · SHAPE** | `afterclip-shape-hex-net` |
| **Line Wave Mask** | **SHADERS · SHAPE** | `afterclip-shape-line-wave-mask` |
| **Line Wave** | **SHADERS · SHAPE** | `afterclip-shape-line-wave` |
| **Lines** | **SHADERS · SHAPE** | `afterclip-shape-lines` |
| **Net** | **SHADERS · SHAPE** | `afterclip-shape-net` |
| **PinWheel** | **SHADERS · SHAPE** | `afterclip-shape-pinwheel` |
| **Plain Wave Mask** | **SHADERS · SHAPE** | `afterclip-shape-plain-wave-mask` |
| **Plain Wave** | **SHADERS · SHAPE** | `afterclip-shape-plain-wave` |
| **Polygon Echo** | **SHADERS · SHAPE** | `afterclip-shape-polygon-echo` |
| **Polygon** | **SHADERS · SHAPE** | `afterclip-shape-polygon` |
| **Repeating Dots** | **SHADERS · SHAPE** | `afterclip-shape-repeating-dots` |
| **RoundedStar** | **SHADERS · SHAPE** | `afterclip-shape-roundedstar` |
| **Shockwave** | **SHADERS · SHAPE** | `afterclip-shape-shockwave` |
| **Triangle** | **SHADERS · SHAPE** | `afterclip-shape-triangle` |
| **Fractal Noise** | **SHADERS · WARP** | `afterclip-warp-fractal-noise` |
| **Fractal Warp** | **SHADERS · WARP** | `afterclip-warp-fractal-warp` |
| **Mirror (Fixed)** | **SHADERS · WARP** | `afterclip-warp-mirror-fixed-bugs` |
| **Polar Coordinates** | **SHADERS · WARP** | `afterclip-warp-polar-coordinates` |
| **Stretch** | **SHADERS · WARP** | `afterclip-warp-stretch` |
| **Wavy (Extended)** | **SHADERS · WARP** | `afterclip-warp-wavy-extended` |

## Group presets

| Preset | Direct children | ID |
| --- | --- | --- |
| **Circular DotWave** | 4 | `afterclip-group-dot-waves-circular-dotwave` |
| **Hex DotWave** | 5 | `afterclip-group-dot-waves-hex-dotwave` |
| **Square DotWave** | 5 | `afterclip-group-dot-waves-square-dotwave` |
| **Arrow Effect** | 11 | `afterclip-group-effects-arrow` |
| **Burst** | 3 | `afterclip-group-effects-burst` |
| **Fractal Burst** | 8 | `afterclip-group-effects-fractal-burst` |
| **Fireworks** | 4 | `afterclip-group-effects-fw` |
| **Line Waves** | 6 | `afterclip-group-effects-line-waves` |
| **Spiral** | 5 | `afterclip-group-effects-spiral` |
| **ChevSync** | 1 | `afterclip-group-synctools-chevron` |
| **SyncTools v2** | 1 | `afterclip-group-synctools-sync` |

## Properties and scope

Many shape effects expose **Position**, **Rotation**, **Scale**, and **Opacity**. Not every effect declares all four. Line Wave uses **Time**, **Delay**, **Power**, and **Step**.

Groups without root custom controls still contain child properties.

[AfterClip usage guide](/docs/features/afterclip/).
