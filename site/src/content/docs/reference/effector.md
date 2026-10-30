---
title: Effector objects, fields, and limits
description: Controls for all nine Effector types, including repeaters, fracture, Plain, and Delay.
sidebar:
  label: Effector reference
---
Effector objects affect source children in their hierarchy. Top-level siblings are outside that hierarchy.

## Object types

| Picker name | Purpose |
| --- | --- |
| **Repeater** | Copies sources by a fixed transform step. |
| **Linear Repeater** | Distributes copies between first and last transforms. |
| **Random Repeater** | Copies sources with seeded random transforms within ranges. |
| **Echo Repeater** | Evaluates copies at explicitly sampled earlier frames. |
| **Twist** | Twists descendant meshes around a local axis. |
| **Warp** | Bends descendant meshes in the effector frame. |
| **Voronoi Fracture** | Splits descendant meshes into seeded Voronoi pieces. |
| **Plain** | Applies field-weighted transforms to connected pieces or text characters. |
| **Delay** | Filters upstream motion through earlier-time samples. |

## Repeaters

Repeater controls appear in the **Repeater** property section. **Count** defaults to 5 and accepts 1 to 128.

| Type | Controls | Meaning |
| --- | --- | --- |
| **Repeater** | **Position**, **Rotation**, **Scale** | Per-copy transform step. Position defaults to 10, 0, 0. Scale defaults to 1, 1, 1. |
| **Linear Repeater** | **Position**, **Rotation**, **Scale** | Last-copy transform relative to the first. Position defaults to 40, 0, 0. Rotation defaults to 0, 0, 90 degrees. |
| **Random Repeater** | **Min position**, **Max position**, **Min rotation**, **Max rotation**, **Min scale**, **Max scale**, **Seed** | Seeded ranges. Seed defaults to 1. |
| **Echo Repeater** | **Offset** | Earlier-time spacing per copy, in frames. Default 5. Range 0 to 100000. |

Scale controls have a minimum of 0.001 per axis. Repeater rotation rows display degrees.

## Twist, Warp, and subdivision

| Type | Controls and defaults |
| --- | --- |
| **Twist** | **Axis** is X, Y, or Z, default Y. **Angle** defaults to 0 degrees and accepts -1440 to 1440. **Offset** moves the pivot along the axis. |
| **Warp** | **Axis** is X or Z, default X. **Strength** defaults to 0 degrees and accepts -720 to 720. **Offset** moves the bend pivot. |

**Subdivision** offers 1, 2, 4, 8, and 16 edge segments. The default is 4.

The subdivision budget is 400,000 triangles per mesh. Subdivision drops by whole levels to fit the budget. It does not simplify a source that already exceeds that count.

## Fields

Twist, Warp, Voronoi Fracture, and Plain share these field controls.

| Control | Meaning and default |
| --- | --- |
| **Field** | **infinite**, **linear**, **box**, **sphere**, **cylinder**, or **noise**. Default infinite. |
| **Field position** | Field offset in effector space. Default 0, 0, 0. |
| **Field rotation** | XYZ Euler rotation in degrees. Default 0, 0, 0. |
| **Field scale** | Percentage of pristine input extent. Default 100, 100, 100. Minimum 0.01 per axis. |
| **Falloff** | Soft transition width within the field, 0 to 100. Default 100. Zero gives a hard boundary. |
| **Falloff curve** | **linear**, **smooth**, **ease in**, or **ease out**. Default linear. |
| **Invert field** | Inverts the resulting weight. Default off. |
| **Sweep** | Linear field progress, 0 to 100. At 0, no positions are affected. At 100, all positions are affected. |
| **Noise scale** | Noise wavelength relative to field scale. Default 100. Range 0.01 to 10000. |
| **Noise evolution** | Continuous seeded-noise offset. Default 0. |

Each fracture fragment stays rigid. Cylinder fields point along field Y.

The editor shows field and falloff guides for linear, box, sphere, and cylinder fields. Infinite and noise fields have no boundary guide. Guides do not appear in exports.

A selection change or exit from the editing camera leaves the mode.

## Voronoi Fracture

| Controls | Meaning and limits |
| --- | --- |
| **Cells**, **Seed** | Cell count 1 to 1000, default 24. Seed defaults to 1. |
| **Distribution**, **Cell scale** | Distribution is **uniform**, **surface**, **center**, or **edges**. Cell scale changes axis proportions of the cells, default 100, 100, 100. |
| **Inner faces** | **open** or **closed**, default closed. Open source-mesh borders are not capped. |
| **Fragment colors** | **material** or **random**, default random. Random colors use the seed. |
| **Offset fragments** | Fragment gap control, 0 to 100. Default 0. |
| **Distance**, **Scatter**, **Spin** | Fragment displacement and rotation. Defaults are 0. Distance and Scatter accept -1000 to 1000. Spin accepts -3600 to 3600 degrees. |
| **Direction**, **Rotation**, **Fragment scale** | Additional piece translation, XYZ rotation in degrees, and scale percentage. Defaults are zero translation, zero rotation, and 100 percent. |
| **Gravity**, **Randomness** | Gravity moves pieces along effector -Y. Randomness reduces motion strength by seeded amounts, 0 to 100. Both default to 0. |
| **Characters**, **Invert selection** | One-based text ranges, such as `1,3-5`, and selection inversion. Spaces count. Newlines do not. Empty Characters selects all. Invalid nonempty ranges select none. |

At full field strength, **Fragment scale** reaches the specified percentage independently of **Randomness**. A value of 0 collapses every vertex of each affected fragment, including inner faces, to one point.

Character selection requires Text+. Non-text sources ignore character ranges. Invert selection does not change the empty selection's all-characters behavior.

Fracture limits are 160,000 source triangles and 1,600,000 output triangles. A build over those limits leaves the source unfractured.

Opaque fractured meshes overlap in source hierarchy order at equal depth. Transparent materials keep their existing sorting.

Built-in effector chains produce the same result in preview and export. After changes to Cells, Seed, or the source geometry, preview holds the last image and shows **Fracturing...** until the new result is ready. Playback can hold or drop frames. Scrubbing ends on the exact requested frame. Export and **Render once** wait for that exact result.

If evaluation fails, preview and export use the unbroken source and report a warning.

## Plain and Delay

Plain exposes **Position offset**, **Rotation offset**, **Scale offset**, and **Uniform scale**. Defaults are zero. Rotation uses degrees. A scale offset of 0 leaves an axis unchanged, and 1 doubles it.

Plain transforms separate connected pieces, text characters, or upstream fracture pieces. Delay sits inside an upstream effector's hierarchy, with the affected source inside Delay.

| Delay control | Meaning and default |
| --- | --- |
| **Mode** | **Blend** uses exponential weights. **Average** uses equal weights. **Spring** uses a damped oscillating kernel. Default Blend. |
| **Strength** | Blend with the filtered result, 0 to 100. Default 75. |
| **History frames** | Earlier samples at one-frame steps, 1 to 24. Default 12. |

Nested Delay histories share a total budget of 96 samples per mesh. Samples with different fracture topology are skipped.

## Legacy projects

Old projects keep working, with no new picker entries.

For task steps, see [Repeat and deform objects with Effector](/docs/features/effector/).
