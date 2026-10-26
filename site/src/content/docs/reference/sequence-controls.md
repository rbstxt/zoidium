---
title: Expressions+ Sequence Controls
description: Control kinds, defaults, slider settings, naming rules, and links.
sidebar:
  label: Sequence Controls
---
Expressions+ adds a **Controls** list to each sequence. A sequence accepts at most 256 controls. Every control is a native animated property.


## Control kinds

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Slider** | Number | 0 to 100 | `0` | Numeric control. Initial step is 0.01. |
| **Angle** | Number | No declared bounds | `0` | Displays degrees and stores radians. |
| **Checkbox** | Choice | **off**, **on** | **off** | Returns 0 for off and 1 for on. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | RGB value. |
| **Point 2D** | 2D vector | No declared bounds | `[0, 0]` | Two numeric components. |
| **Point 3D** | 3D vector | No declared bounds | `[0, 0, 0]` | Three numeric components. |


## Names, ranges, and links

**Rename…** requires a nonempty, unique name within the sequence. **Move up** and **Move down** change order. **Remove control** removes the control. These commands support native undo.

**Slider settings…** exposes **min**, **max**, and **step**. Values must be finite, max must be at least min, and step must be positive.

**Link to control…** lists matching property types. Numeric properties also accept Checkbox controls. Linking installs a `control(name, id)` expression. The stable ID preserves the link through renaming.

[Use Expressions+](/docs/features/expressions-plus/)
