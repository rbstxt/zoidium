---
title: Optical Flares controls and elements
description: Source placement, window controls, element defaults, and saved-state limits.
sidebar:
  label: Optical Flares reference
---
Optical Flares is a 3D object with a configurable element stack. The labels below refer to its options window. Native property-panel labels can differ.

## Source

| Window control | Meaning and limits |
| --- | --- |
| **Source** | **Object 3D** uses the flare object's world position. **Light** uses a light in the same layer. **Screen (2D)** uses the native **2D Position** offset. |
| **Light index** | Zero-based light index. The property accepts 0 to 32. Runtime selection clamps to the available lights. |
| **Occlude** | Depth-tests a 3D source against foreground geometry. Off by default. Screen sources do not use depth occlusion. |
| **Fade amount** | Occlusion strength, 0 to 100. At 100, covered pixels hide the flare fully. At 0, the flare remains visible through geometry. |
| **Edge margin** | Fade region beyond the screen edge, 0 to 2 in normalized device coordinates. Default 0.25. |
| **Distance falloff** | Exponent for size scaling by camera distance, 0 to 2. Default 0 disables this scaling. |
| **Reference distance** | Reference distance for camera-distance size scaling, 0.01 to 1000. Default 10. |

The active layer camera projects a 3D source. A source behind the camera or beyond the edge fade region disappears. Elements lie along the axis from the source through **Center**.

Camera-distance size scaling uses `(reference / distance) ^ falloff`. This is separate from the element-axis scaling switches below.

## Global and advanced controls

| Section | Window controls | Scope |
| --- | --- | --- |
| **Global** | **Center**, **Brightness**, **Scale**, **Color**, **Color mode**, **Rotation offset** | Flare layout and overall appearance. Color modes are **Tint**, **RGB**, and **Alpha**. |
| **Global** | **Scale offset** | Reduces element size as positive element-axis distance increases. |
| **Global** | **Evolution**, **Flicker**, **Flicker speed**, **High quality** | Time-based animation and rendering controls. Flicker depends on project time and seeds. |
| **Advanced** | **Element scale**, **Aspect ratio**, **Blend mode**, **Color**, **Seed** | Shared element multipliers and blending. Blend modes are **Add**, **Screen**, and **Normal**. |
| **Advanced** | **Scale with distance** | Enables the same shared element-axis size factor as Global's Scale offset. Either switch enables the factor once. |
| **Advanced** | **Render mode** | **On Black** or **Transparent**. |

New flares start with overall Brightness 70 and Scale 75. Saved values remain unchanged.

## Selected element

| Window controls | Meaning |
| --- | --- |
| **Type**, **Enabled**, **Solo** | Element type and visibility. If any of the first 24 elements has Solo enabled, only soloed, enabled elements in that range render. |
| **Color**, **Size**, **Brightness** | Per-element color, scale, and opacity. Brightness is 0 to 100. |
| **Position**, **Rotation**, **Aspect ratio** | Distance along the flare axis, rotation, and width relative to height. Position accepts -300 to 500. |
| **Blend mode** | Add, Screen, or Normal blending for the element. |
| **Scale with distance** | Per-element size reduction along the positive flare axis. Independent of the shared switch. |
| **Animate**, **Seed** | Element animation toggle and deterministic seed. |
| **Shape**: **Texture**, **Illumination**, **Falloff** | Optional texture and its shape controls. |
| **Shape**: **Matte shape**, **Matte start**, **Matte fade** | Matte shape and transition controls. |

Texture choices are **None**, **Soft**, **Hex**, **Ring**, **Streak**, **Spikes**, **Orbs**, **Custom 1**, **Custom 2**, and **Custom 3**. Custom choices read the assets in **Custom Layers**: **Custom Layer 1**, **Custom Layer 2**, and **Custom Layer 3**.

## Element catalogue

These defaults apply when an element is added. Preset stacks can override them. Size and Position use the options window's labels.

<!-- elements:start -->
| Element | Key | Size | Position | Aspect ratio |
| --- | --- | --- | --- | --- |
| **Glow** | `glow` | 100 | 5 | 1 |
| **Multi Iris** | `multiiris` | 60 | 38.5 | 1 |
| **Iris** | `iris` | 85 | 75 | 1 |
| **Streak** | `streak` | 90 | 0 | 6 |
| **Shimmer** | `shimmer` | 60 | 0 | 1 |
| **Glint** | `glint` | 55 | 0 | 1 |
| **Spike Ball** | `spikeball` | 55 | 0 | 1 |
| **Sparkle** | `sparkle` | 70 | 0 | 1 |
| **Ring** | `ring` | 85 | 120 | 1 |
| **Hoop** | `hoop` | 150 | 95 | 1.8 |
| **Caustic** | `caustic` | 90 | 110 | 1 |
| **Lens Orbs** | `lensorbs` | 100 | 150 | 1 |
<!-- elements:end -->

## Presets, limits, and saved state

The five base presets are **Default Lens Flare**, **Anamorphic Blue**, **Sparkle Burst**, **Cinematic Warm**, and **Sci-Fi Plasma**.

The renderer reads at most the first 24 elements in stack order. Elements beyond that range do not render. An empty saved stack stays empty.

Element changes, Solo, source settings, and custom layer assets are project state. Reordering and resets use native undo history. **Reset Element**, **Reset Source**, **Reset Global**, **Reset Advanced**, and **Reset All** each record one undo step.

Favorites and **Preview bg** choices **Black** and **Checker** persist locally. They do not change project data or export backgrounds.

For task steps, see [Add and edit an Optical Flares object](/docs/features/optical-flares/).
