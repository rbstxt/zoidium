---
title: Shader property settings
---
Shader+ stores control settings in each custom property's definition.
Settings, groups, and display choices survive save, reopen, duplication, Undo, and Redo.

## Reset buttons

The native **Properties** reset on a Shader effect preserves its fragment shader code.
It resets the other native properties, including Name and Enabled.

**Reset custom properties to defaults**, on the **Shader properties** heading, resets every custom control in one undo step.
It clears keyframes and expressions and restores a static value at frame 0, following After Effects' Reset behavior.
Undo restores the previous values, keys, and expression source together.

The custom reset uses `zoidiumShader.default` when present.
Otherwise, it uses the definition value or the native default.
This applies to every Shader+ kind, including vector components and the JSON values of Gradient, Curve, Palette, and Text.
The reset preserves property definitions, names, and groups.

## Group in the + list

The **Shader properties** **+** list includes a searchable **Group** entry.
It moves the selected property rows into a new named group in one undo step.
At least one property must be selected. The group name must be unused.
Locked groups block moves into or out of the group.

The shared group system controls collapse, locks, and display order.
Native property order and shader uniform names remain unchanged.
[Organize custom properties into groups](/docs/how-to/organize-property-groups/) gives the steps.

## Visible when and Has value

**Visible when** selects another property in the same effect.
**Has value** accepts exact values and the following numeric conditions.

| Input | Match |
| --- | --- |
| `> 5.5` | Greater than 5.5 |
| `>= 1` | At least 1 |
| `< 0` | Less than 0 |
| `<= 2` | At most 2 |
| `!= 3` | Different from 3 |
| `= 4` | Equal to 4 |
| `1..5` | Between 1 and 5, including both endpoints |
| `1; 2; > 5.5` | Equal to 1 or 2, or greater than 5.5 |

Semicolons join alternatives with OR.
Comparisons use the controller's evaluated number, including animation and expressions.
Invalid operands, operators, and reversed ranges show an error before Apply saves changes.
Existing saved exact values retain strict equality, including strings with operator characters.

Visibility affects editor rows only.
Hidden properties still supply their current values to shaders, Preview cache frames, and exports.

## Toggle display

Toggle uses the **Off/on menu** display by default.
Its **Property settings…** panel also offers **Display** = **Checkbox** for one-click changes.
Both displays write the same NUMBER values, 0 and 1. New keys use Hold.

Changing Display preserves values, keys, expressions, and shader output.
Existing fractional values and interpolation reach the shader unchanged.
An animated expression remains read-only, as with the native menu.
