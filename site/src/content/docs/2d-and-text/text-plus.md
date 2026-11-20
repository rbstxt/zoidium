---
title: Text+
description: Animate native 2D Text and 3D Text per character, stack up to three 2D animators, assign 3D character materials, and tune 3D bevels.
---
Use **Text+** (enabled by default) to animate individual characters on native 2D **Text** layers or native **3D Text** objects, assign separate front and side materials to chosen 3D characters, and control 3D text spacing and bevels.

For a 3D text container with 11 reorderable effectors (including Formula, Spline, Orbit, Repeater, and Voronoi) or to split a **3D Text** object into separate per-character objects, see [ExpressText+](/docs/2d-and-text/expresstext-plus/). Note that when a Text+ container owns a 3D Text object, ExpressText+ yields to Text+.

## Animate a native 2D Text layer

1. Confirm **Text+** is enabled in **Plugins**.
2. Add **Text** from **LAYERS** and select it.
3. Open the **Character** category in the native Properties panel.
4. Set **Mode** to **Character Transform**, **Gradient Transform**, **Character Shake**, **Selected Character Transform**, **Selected Character Shake**, or **Random Scatter**.
5. Set **Position**, **Scale**, **Rotation**, **Delay**, and **Delay order**, then keyframe the controls.

- **Specific characters:** Pick a **Selected** mode and enter one-based character numbers such as `1,4,5` in **Characters** (spaces count as slots).
- **Stacking up to three animators:** Once **Character > Mode** is active, **Character 2** appears below it; **Character 3** appears the same way. Each category transforms the output of the earlier ones (for example, shake in **Character**, then scatter in **Character 2**).
- **2D controls vs whole text:** In 2D, Position and Scale use X and Y, Rotation turns in the layer plane, and **Rotation order** and **Axis** are omitted. Keep using native **Text**, **Font**, **Size**, **Fill**, **Stroke**, and top-level **Position**, **Rotation**, and **Scale** for the whole layer. Imported fonts appear under **Project fonts** in **Font**.
- **Turning off or converting:** Set every **Mode** to **None** to disable character animation (do this before converting a 2D Text layer to Shape+, because converted Shape+ outlines have no Text+ character controls). If you disable **Text+** in **Plugins**, native Text still renders and keeps your saved settings until you re-enable **Text+**.

## Animate 3D Text through a parent

1. Open a 3D Scene's **Objects** panel and add a **Text+** animation parent (such as **Character Transform**, **Gradient Transform**, **Character Shake**, **Selected Character Transform**, **Selected Character Shake**, or **Random Scatter**).
2. Place a native **3D Text** object inside that parent.
3. Open the parent's **Character** category and animate its properties.

Nested animation parents compose their transforms. New scale controls multiply the source Text scale.

## Assign materials to selected 3D characters

1. In a 3D Scene's **Objects** panel, add **Character Material** from **Text+**.
2. Put a native **3D Text** object inside it.
3. Enter one-based numbers such as `1,3,4` in **Characters** (leave empty to affect all characters).
4. Open **Front material** (both caps) and **Side material** (extrusion walls and bevels) and choose materials. Delete a slot's material to keep the source Text material on that face.
5. Edit or keyframe each material's native properties.

To swap materials on a specific letter, nest a second **Character Material** parent inside the first and select that letter in the inner parent's **Characters** field. The innermost parent selecting a character controls both slots (an empty inner slot uses the source Text material).
You can nest **Character Material** with any Text+ animation parent and keep non-text objects in the group (Character Material affects only 3D Text). Opening the project without Text+ renders the source Text materials while preserving saved slots.

## Property reference

The tables below describe the 3D parent controls. In 2D, Position and Scale are 2D vectors, Rotation is a scalar angle, and **Rotation order** and **Axis** do not appear. A dash (`—`) means no declared minimum or maximum.

### Character Transform (and Selected Character Transform)

The **Selected** variant adds **Characters** (default `1`; empty affects no characters; delay counts only selected characters).

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Characters** | Text | Text | `1` | One-based character numbers (Selected variant only). Spaces count. |
| **Position** | 3D vector | — | `[0, 0, 0]` | Per-character position offset. |
| **Scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Per-character scale multiplier. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Per-character Euler rotation in degrees. |
| **Rotation order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of the three rotation axes. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Pivot at each character or the whole text. |
| **Delay** | Number | ≥ 0 | `0` | Frame delay between characters. |
| **Delay order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order in which characters receive the delay. |
| **Seed** | Number | — | `1` | Seed for **Random** delay order. |

### Gradient Transform

Intermediate characters linearly blend **First** and **Last** values (a single character uses **First**).

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **First position**, **Last position** | 3D vector | — | `[0, 0, 0]` | Position offset at the first and last characters. |
| **First scale**, **Last scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Scale multiplier at the first and last characters. |
| **First rotation**, **Last rotation** | 3D vector | — | `[0, 0, 0]` | Rotation at the first and last characters in degrees. |
| **Rotation order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of the three rotation axes. |

### Character Shake (and Selected Character Shake)

Animate **Phase** to drive motion; a constant **Phase** produces a static pose. The **Selected** variant adds **Characters** (default `1`).

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Characters** | Text | Text | `1` | One-based character numbers (Selected variant only). |
| **Amplitude** | Number | `0` to `360` | `0` | Maximum angular displacement in degrees. |
| **Period** | Number | ≥ 0 | `24` | Length of one shake cycle in **Phase** units. |
| **Phase** | Number | — | `0` | Explicit shake progress. |
| **Axis** | 3D vector | — | `[0, 0, 1]` | Rotation axis (3D only). |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Pivot at each character or the whole text. |
| **Phase offset** | Number | ≥ 0 | `0` | Phase offset between characters. |
| **Offset order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order in which characters receive phase offsets. |
| **Seed** | Number | — | `1` | Seed for **Random** offset order. |

### Random Scatter

Animate **Amount** to scatter characters toward seeded random transforms.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amount** | Number | ≥ 0 | `0` | Blends from original text toward random transforms. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Pivot at each character or the whole text. |
| **Min position**, **Max position** | 3D vector | — | `[-10, -10, -10]`, `[10, 10, 10]` | Random translation bounds. |
| **Min rotation**, **Max rotation** | 3D vector | — | `[0, 0, 0]` | Random rotation bounds in degrees. |
| **Min scale**, **Max scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Random scale bounds. |
| **Seed** | Number | — | `1` | Seed for repeatable random values. |

### 3D Text additions

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Horizontal spacing** | Number | `-200` to `200` | `0` | Extra horizontal spacing between characters. |
| **Index offset** | Number | ≥ 0 | `0` | Starting index of this 3D Text inside a shared character sequence. |
| **Total characters** | Number | ≥ 0 | `0` | Total count for delay and gradient math (`0` uses local count). |
| **Bevel size** | 2D vector | ≥ 0 | `[0.1, 0.5]` | Bevel thickness and width. |
| **Bevel side** | Choice | **outside**, **inside** | **outside** | Bevel direction relative to the letter outline. |
| **Bevel subdivision** | Number | `1` to `100` | `3` | Bevel segment count. |
| **Cap profile** | Choice | **flat**, **round** | **round** | Flat or rounded cap profile. |
| **Bevel tension** | Number | `0` to `1` | `0.5` | Curvature of the rounded bevel profile. |

When you change the sequence frame rate, Text+ timing updates automatically in seconds. See [Timeline and frame rate](/docs/workflow/timeline/).
