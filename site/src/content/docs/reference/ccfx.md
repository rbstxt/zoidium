---
title: CCFX effect catalogue
description: Registered effects, picker categories, and group presets.
sidebar:
  label: CCFX catalogue
---
CCFX registers 12 standalone effects and 7 group presets. A standalone effect inserts one shader. A group inserts a saved chain of child effects.

## Standalone effects

| Effect | Picker category | ID |
| --- | --- | --- |
| **Sunburst V2** | **BACKGROUNDS** | `part-1-backgrounds-sunburst` |
| **Voronoi Cell Pattern** | **BACKGROUNDS** | `part-1-backgrounds-voronoi-cell-pattern` |
| **Puddle** | **DISTORT** | `part-1-distort-puddle` |
| **Skew V2** | **DISTORT** | `part-1-distort-skew-v2` |
| **Warp Waves** | **DISTORT** | `part-1-distort-warp-waves` |
| **Wipe Checker** | **TRANSITIONS** | `part-1-transitions-s-wipechecker` |
| **Wipe Dots** | **TRANSITIONS** | `part-1-transitions-s-wipedots` |
| **Wipe Rings** | **TRANSITIONS** | `part-1-transitions-s-wiperings` |
| **Wipe Stripes** | **TRANSITIONS** | `part-1-transitions-s-wipestripes` |
| **CC Light Sweep** | **PART 2** | `part-2-cc-light-sweep` |
| **Lens Flare Lite** | **PART 2** | `part-2-lens-flare-lite` |
| **Plexus V1** | **PART 2** | `part-2-plexus-v1` |

## Group presets

| Preset | Direct children | ID |
| --- | --- | --- |
| **MxsterFX Dot BG (By CCFX)** | 2 | `group-part-1-backgrounds-mxsterfx-halfdots-bg` |
| **MxsterFX Square BG (By CCFX)** | 2 | `group-part-1-backgrounds-mxsterfx-square-bg` |
| **Extrude** | 1 | `group-part-1-miscellaneous-extrude` |
| **CC Bend It** | 2 | `group-part-2-cc-bend-it` |
| **Hexagon Array** | 1 | `group-part-2-hexagon-array` |
| **Plexus V2** | 2 | `group-part-2-plexus-v2` |
| **AE Warp** | 1 | `group-part-2-warp` |

## Properties and scope

Controls vary by preset. Sunburst V2 exposes **rotation**, **speed**, **scale**, and **center**. The CC Bend It group exposes **Start**, **End**, and **Bend**.

Sunburst V2 drives **uTime** with `time`. Other presets can use manual values or different expressions. There is no pack-wide timing control.

[CCFX usage guide](/docs/features/ccfx/).
