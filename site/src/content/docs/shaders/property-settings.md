---
title: Property groups and settings
description: Add typed Shader+ controls, organize properties into collapsible locked groups, and configure Reset, Visible when, Rename when, Toggle display, and Snap.
---
Use **Shader+** (enabled by default) to add typed controls to any native **Custom Shader** effect, organize custom properties into collapsible groups, and control visibility, dynamic labels, and numeric snapping.
All settings, groups, and display options survive save, reopen, duplication, Undo, and Redo.

## Add a Shader+ control

1. Add a native **Custom Shader** effect to a clip.
2. Open **Shader properties**, click **+**, and pick a kind under **ZOIDIUM**.
3. Name the property, open the code editor, declare the matching GLSL uniform, and click **Apply**.

- For a native number without kind metadata, **Property settings** displays **Slider** with **Minimum** and **Maximum** (clicking **Apply** without edits leaves the property unchanged). Other native types show **Native** until you select a kind.
- With **Expressions+** enabled, declare `uniform float zFps;` to read the sequence frame rate (unaffected by export frame-rate overrides).
- See [Property kinds and formats](/docs/development/shader-properties/) for each kind's editor and saved format, [GLSL examples by kind](/docs/shaders/kind-examples/) for code snippets, and [Saved rendering compatibility](/docs/development/project-compatibility/#shader-property-kinds) for plugin requirements.

## Organize properties into groups

Grouping works on **Shader+** and on other objects or effects that expose a **Custom properties** list, without changing property names or shader uniforms.

### Create and populate a group

- **From one row:** Right-click a custom property row, choose **Group…**, enter a **Group** name, and click **Apply**. Repeat with the same name or drag other properties onto an unlocked group heading or row. To ungroup a property, open **Group…**, clear **Group**, and click **Apply**.
- **From selected Shader properties (+ list):** Select one or more Shader property rows, click **+** on the **Shader properties** heading, search for `group`, choose **Group**, enter an unused **Name**, and click **Apply**. Undo restores all moved rows in one step.

Groups are stored on their member properties, so an empty group has no heading. New properties start outside existing groups.

### Rename, reorder, collapse, and lock groups

1. Click **Settings** beside a group heading to edit its **Name** or turn on **Lock**, then click **Apply**.
2. Click a group heading to collapse or expand it (saved with the project without creating an Undo step).
3. Drag an unlocked group heading to change display order without changing native property order or uniform names.

A locked group blocks heading drags and property drags into or out of the group while still letting you edit and animate its values. Unlock any locked group before moving its rows.
To lock a 3D object group in the **Objects** panel, click **Lock** on its row (click **Locked** to unlock); it blocks panel drags and drops while transforms and animation continue rendering. Older builds open saved projects without enforcing locks.

## Reset buttons

- The native **Properties** reset on a Shader effect preserves your fragment shader code while resetting other native properties (including **Name** and **Enabled**).
- **Reset custom properties to defaults** (on the **Shader properties** heading) resets every custom control in one Undo step: it clears keyframes and expressions and restores static values at frame `0`. Undo restores all values, keys, and expressions together.
- The reset reads `zoidiumShader.default` when present, falling back to the definition value or native default across every Shader+ kind (including vectors and Gradient, Curve, Palette, and Text JSON values), while preserving property definitions, names, and groups.

## Visible when and Has value

Use **Visible when** to show a property (or a whole group) only when another controller property in the same effect matches **Has value**.

| **Has value** syntax | Matches |
| --- | --- |
| `> 5.5`, `>= 1`, `< 0`, `<= 2`, `!= 3`, `= 4` | Numeric comparisons against the controller's evaluated number (including animation and expressions). |
| `1..5` | Inclusive numeric range (`1` through `5`). |
| `1; 2; > 5.5` | Semicolon-separated OR alternatives. |

- Invalid operators, operands, or reversed ranges block **Apply** with an error. Existing exact string matches stay strict.
- An unreachable Toggle or Dropdown condition shows a warning in the settings panel while still allowing **Apply** (expressions and interpolated animation skip this warning).
- Click the **Show hidden** eye button on the **Shader properties** heading to reveal hidden rows and groups dimmed so you can still open their settings. **Show hidden** does not expand collapsed groups and is local panel state (not saved, no Undo step).
- **Group visibility:** Right-click a grouped row and choose **Group settings…** to pick an ungrouped controller in the same effect. A row shows only when both its own condition and its group condition pass. Moving a property into or out of a group adds or removes that group's condition. If a group's controller is deleted or renamed, the group stays hidden until **Show hidden** is enabled.
- Visibility affects editor rows only; hidden properties still supply their live values to shaders, Preview cache frames, and exports.

## Rename when

**Rename when** changes only a property's displayed row label without altering its uniform name, saved value, keyframes, expressions, links, or export output.

- Each rule uses the same controller picker and **Has value** syntax as **Visible when** and sets the displayed label.
- The first matching rule from top to bottom wins; if none match (or if the controller is missing), the property's own name displays. Use **Move up**, **Move down**, and **Remove** to manage rules.
- Rules follow the controller's evaluated value at the current frame, save in `zoidiumShader.renameWhen`, and are ignored by older builds.

## Toggle display

**Toggle** defaults to an **Off/on menu** and also supports **Display = Checkbox** in **Property settings…** for one-click switching.
Both displays write native `NUMBER` values `0` and `1` (new keys use Hold), keep existing values, fractional keys, and expressions intact, and follow the editor theme.

## Minimum, Maximum, Step, Decimals, and Snap

- **Slider**, **Seed**, **Time sample**, and **Angle** expose **Decimals** (`0` to `100` displayed decimal places) and **Snap**. **Time sample** also exposes **Minimum**, **Maximum**, and **Step**. **Toggle** and **Dropdown** hide these fields.
- **Minimum** and **Maximum** clamp row edits; **Step** sets the drag multiplier and arrow-key increment.
- **Snap** rounds committed row edits to multiples of **Snap** starting from **Minimum** (or `0` when unbounded), rounding half-way values away from zero. Clearing **Snap** or setting `0` restores native editing. Arrow keys step by **Step** first and then snap, so a **Step** smaller than **Snap** can stay on the same grid line.
- These fields affect row edits only and never alter saved values or keyframes retroactively.
- Converting another kind to **Time sample** clears stale numeric bounds and uses the unit default step (`1` for Frames, `0.01` for Seconds). Clear **Minimum** or **Maximum** to unbind, or clear **Step** to restore the unit default.
