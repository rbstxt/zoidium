---
title: Text+ character properties
description: Defaults and ranges for character transforms, shake, scatter, material slots, and 2D categories.
sidebar:
  label: Text+ reference
---
Text+ adds six character animation modes and the **Character Material** parent for 3D Text. 2D Text has the same animation modes in its **Character** categories. A — range means no declared minimum or maximum.


## 2D Character categories

**Mode** is a static choice. Its default is **None**. Options are **None**, **Character Transform**, **Gradient Transform**, **Character Shake**, **Selected Character Transform**, **Selected Character Shake**, and **Random Scatter**.

There are at most three categories: **Character**, **Character 2**, and **Character 3**. A later category appears when the previous category or its own Mode is active. Categories apply in order to the previous result.

In 2D, position and scale have X and Y components. Rotation is a scalar angle in the layer plane. **Rotation order** and **Axis** are absent. The tables below describe the 3D parent controls.


## Character Transform

The Selected variant adds **Characters**, default `1`. Empty selection affects no characters. Delay and phase order count only the selected characters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Characters** | Text | Text | `1` | One-based character numbers. Spaces count. Invalid entries are ignored. |
| **Position** | 3D vector | — | `[0, 0, 0]` | Per-character position offset. |
| **Scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Per-character scale multiplier. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Per-character Euler rotation in degrees. |
| **Rotation order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of the three rotation axes. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Rotation and scale pivot at the character or the whole text. |
| **Delay** | Number | ≥ 0 | `0` | Frame delay between characters. |
| **Delay order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order in which characters receive the delay. |
| **Seed** | Number | — | `1` | Seed for Random delay order. |


## Gradient Transform

Intermediate characters linearly blend the First and Last values. One character uses the First values.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **First position** | 3D vector | — | `[0, 0, 0]` | Position offset at the first character. |
| **First scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Scale multiplier at the first character. |
| **First rotation** | 3D vector | — | `[0, 0, 0]` | Rotation at the first character in degrees. |
| **Last position** | 3D vector | — | `[0, 0, 0]` | Position offset at the last character. |
| **Last scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Scale multiplier at the last character. |
| **Last rotation** | 3D vector | — | `[0, 0, 0]` | Rotation at the last character in degrees. |
| **Rotation order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of the three rotation axes. |


## Character Shake

The Selected variant adds **Characters**, default `1`. Empty selection affects no characters. Delay and phase order count only the selected characters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Characters** | Text | Text | `1` | One-based character numbers. Spaces count. Invalid entries are ignored. |
| **Amplitude** | Number | 0 to 360 | `0` | Maximum angular displacement in degrees. |
| **Period** | Number | ≥ 0 | `24` | Length of a shake cycle in Phase units. |
| **Phase** | Number | — | `0` | Explicit shake progress. A constant Phase produces a static pose. |
| **Axis** | 3D vector | — | `[0, 0, 1]` | Axis of the per-character rotation. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Rotation and scale pivot at the character or the whole text. |
| **Phase offset** | Number | ≥ 0 | `0` | Phase offset between characters. |
| **Offset order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order in which characters receive phase offsets. |
| **Seed** | Number | — | `1` | Seed for Random offset order. |


## Random Scatter

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amount** | Number | ≥ 0 | `0` | Blends from the original text toward seeded random transforms. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Rotation and scale pivot at the character or the whole text. |
| **Min position** | 3D vector | — | `[-10, -10, -10]` | Lower bound of random character translation. |
| **Max position** | 3D vector | — | `[10, 10, 10]` | Upper bound of random character translation. |
| **Min rotation** | 3D vector | — | `[0, 0, 0]` | Lower bound of random character rotation in degrees. |
| **Max rotation** | 3D vector | — | `[0, 0, 0]` | Upper bound of random character rotation in degrees. |
| **Min scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Lower bound of random character scale. |
| **Max scale** | 3D vector | ≥ 0.001 | `[1, 1, 1]` | Upper bound of random character scale. |
| **Seed** | Number | — | `1` | Seed for repeatable random values. |


## Character Material

**Characters** is text, default empty. An empty field selects every character. A nonempty field uses one-based character numbers such as `1,3,4`.

**Front material** and **Side material** are material slots, both empty by default. Front material covers both caps. Side material covers extrusion walls and bevels. Empty slots use the source Text material.

The closest Character Material parent that selects a character controls both slots. Other object types keep their materials.


## 3D Text additions

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Horizontal spacing** | Number | -200 to 200 | `0` | Additional horizontal character spacing. |
| **Index offset** | Number | ≥ 0 | `0` | Offset of this Text within a shared character sequence. |
| **Total characters** | Number | ≥ 0 | `0` | Character count used for delay and gradient math. Zero uses the local count. |
| **Bevel size** | 2D vector | ≥ 0 | `[0.1, 0.5]` | Thickness and width of the bevel. |
| **Bevel side** | Choice | **outside**, **inside** | **outside** | Direction of the bevel relative to the outline. |
| **Bevel subdivision** | Number | 1 to 100 | `3` | Number of bevel subdivisions. |
| **Cap profile** | Choice | **flat**, **round** | **round** | Flat or rounded cap profile. |
| **Bevel tension** | Number | 0 to 1 | `0.5` | Curvature of the rounded bevel profile. |


## Timing and composition

Nested animation parents compose transforms. New scale controls multiply the source Text scale.

[Change the frame rate without changing timing](/docs/how-to/change-sequence-frame-rate/)

[Animate characters with Text+](/docs/features/text-plus/)
