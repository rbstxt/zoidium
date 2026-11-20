---
title: Optical Flares
description: Place 3D lens flares in a scene, build an element stack up to 24 elements, enable depth occlusion, and load custom textures.
---
Use **Optical Flares** to place a 3D lens flare projected through the active scene camera and customize its element stack in a floating options window.

## Add and place a flare

1. In **Plugins**, enable **Optical Flares**.
2. Open the scene's 3D object picker, open **Optical Flares**, and pick **Optical Flares** or a preset (**Default Lens Flare**, **Anamorphic Blue**, **Sparkle Burst**, **Cinematic Warm**, or **Sci-Fi Plasma**).
3. Select the flare object and click **Open Optical Flares**.
4. In **Source**, keep **Source** at **Object 3D** and move the object in 3D space to place the flare.

To follow a scene light instead, set **Source** to **Light** and set **Light index** to that light's zero-based index in the same layer. **Screen (2D)** keeps a fixed screen-offset source for older projects.

## Build the element stack

The renderer reads at most the first `24` elements in stack order. Elements beyond `24` do not render. An empty saved stack stays empty.

1. In **Browser > Elements**, click an element tile to add it to the stack.
2. Select an element in the **Elements** list and edit **Size**, **Brightness**, **Position**, and **Color** under **Selected element**.
3. Drag rows (or use **Move Up** / **Move Down**) to reorder the stack.
4. Enable **Solo** to isolate an element while tuning, then turn off every **Solo** switch before export (**Solo** is saved with the project and affects exports).

## Hide behind geometry and use custom textures

- **Depth occlusion:** Under **Source**, turn on **Occlude** and set **Fade amount** (`100` hides covered pixels completely; lower values let partial flare pass through foreground meshes).
- **Custom element images:** Expand **Custom Layers** and assign images to **Custom Layer 1**, **Custom Layer 2**, or **Custom Layer 3**. Then select an element, open **Shape**, and set **Texture** to **Custom 1**, **Custom 2**, or **Custom 3**.

## Control reference

Labels below match the **Optical Flares** options window (native property-panel labels can differ slightly).

### Source

The active scene camera projects 3D sources; a source behind the camera or past **Edge margin** disappears. Elements arrange along the axis from the source through **Center**. Camera-distance scaling clamps to `0.05` through `20`.

| Window control | Meaning and limits |
| --- | --- |
| **Source** | **Object 3D** (object world position), **Light** (same-layer light), or **Screen (2D)** (**2D Position** offset). |
| **Light index** | Zero-based light index (`0` to `32`; higher values use the last available light). |
| **Occlude** | Depth-tests a 3D source against foreground geometry (default off; unused by Screen sources). |
| **Fade amount** | Occlusion strength (`0` to `100`). |
| **Edge margin** | Fade distance beyond the screen edge (`0` to `2` NDC, default `0.25`). |
| **Distance falloff** | Exponent for camera-distance size scaling (`0` to `2`, default `0` disables). |
| **Reference distance** | Reference distance for camera-distance scaling (`0.01` to `1000`, default `10`). |

### Global and Advanced

New flares start with overall **Brightness** `70` and **Scale** `75`.

| Section | Window controls | Scope |
| --- | --- | --- |
| **Global** | **Center**, **Brightness**, **Scale**, **Color**, **Color mode**, **Rotation offset** | Overall layout and color (**Tint**, **RGB**, or **Alpha**). |
| **Global** | **Scale offset** | Shrinks elements farther along the positive flare axis. |
| **Global** | **Evolution**, **Flicker**, **Flicker speed**, **High quality** | Time-based animation and render quality (flicker is seeded from project time). |
| **Advanced** | **Element scale**, **Aspect ratio**, **Blend mode**, **Color**, **Seed** | Shared multipliers and blending (**Add**, **Screen**, **Normal**). |
| **Advanced** | **Scale with distance** | Same shared axis scaling as **Scale offset** (enabling either applies it once). |
| **Advanced** | **Render mode** | **On Black** or **Transparent**. |

### Selected element

| Window controls | Meaning |
| --- | --- |
| **Type**, **Enabled**, **Solo** | Element type and visibility. If any of the first 24 elements has **Solo** on, only soloed, enabled elements in that range render. |
| **Color**, **Size**, **Brightness** | Color, scale, and opacity (`0` to `100`). |
| **Position**, **Rotation**, **Aspect ratio** | Position along flare axis (`-300` to `500`), angle, and width/height ratio. |
| **Blend mode** | Per-element **Add**, **Screen**, or **Normal**. |
| **Scale with distance** | Per-element size falloff along the positive flare axis (independent of the shared switch). |
| **Animate**, **Seed** | Element animation toggle and seed. |
| **Shape**: **Texture**, **Illumination**, **Falloff** | Texture (**None**, **Soft**, **Hex**, **Ring**, **Streak**, **Spikes**, **Orbs**, **Custom 1–3**) and shape controls. |
| **Shape**: **Matte shape**, **Matte start**, **Matte fade** | Matte shape and transition range. |

**Animate** affects only **Sparkle** and **Hoop** elements. **Falloff** affects only the **Ring** texture. **Illumination** has no effect on **None** and **Orbs**.

### Element catalogue

Default values when adding an element:

<!-- elements:start -->
| Element | Size | Position | Aspect ratio |
| --- | --- | --- | --- |
| **Glow** | 100 | 5 | 1 |
| **Multi Iris** | 60 | 38.5 | 1 |
| **Iris** | 85 | 75 | 1 |
| **Streak** | 90 | 0 | 6 |
| **Shimmer** | 60 | 0 | 1 |
| **Glint** | 55 | 0 | 1 |
| **Spike Ball** | 55 | 0 | 1 |
| **Sparkle** | 70 | 0 | 1 |
| **Ring** | 85 | 120 | 1 |
| **Hoop** | 150 | 95 | 1.8 |
| **Caustic** | 90 | 110 | 1 |
| **Lens Orbs** | 100 | 150 | 1 |
<!-- elements:end -->

Element edits, **Solo**, source settings, and custom layer assets save with the project, and reordering and resets support Undo. Favorites and **Preview bg** stay local to your machine.
