---
title: Expressions+ and Sequence Controls
description: Add deterministic expressions to native properties, create reusable Sequence Controls, and access sequence frame rate and shader includes.
---
Use **Expressions+** (enabled by default) to drive any native animatable property with JavaScript-like expressions, link properties to shared **Sequence Controls**, and unlock helper includes in Custom Shaders.

## Add an expression to a property

1. Confirm **Expressions+** is enabled in **Plugins**.
2. Alt-click the property's animation button.
3. Write the expression in the **Expression** editor.
4. Click **Apply**.
5. Scrub the playhead to inspect the evaluated value.

For full syntax, property navigation, animation helpers, and world or camera links, see the [Expression reference](/docs/development/expressions/).

## Sequence Controls

Expressions+ adds a **Controls** list to each sequence so you can drive multiple properties from one place. Each sequence supports up to `256` controls, and every control can be keyframed.

### Control kinds

| Control | Type | Range or options | Default | Behavior |
| --- | --- | --- | --- | --- |
| **Slider** | Number | `0` to `100` (configurable) | `0` | Numeric slider. Initial step is `0.01`. |
| **Angle** | Number | — | `0` | Displays degrees. |
| **Checkbox** | Choice | **off**, **on** | **off** | Evaluates to `0` for off and `1` for on. |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Three-channel RGB value. |
| **Point 2D** | 2D vector | — | `[0, 0]` | Two numeric components. |
| **Point 3D** | 3D vector | — | `[0, 0, 0]` | Three numeric components. |

### Manage and link controls

- **Rename…** requires a nonempty name that is unique within the sequence.
- **Move up**, **Move down**, and **Remove control** reorder or delete controls (all support Undo).
- **Slider settings…** configures **min**, **max**, and **step** (`max` must be at least `min`, and `step` must be positive).
- **Link to control…** shows controls matching the target property type (numeric properties also accept **Checkbox** controls) and inserts a `control(name, id)` expression. Generated control links survive control renames and reordering.

## Drive shape position with a group property

1. In **Objects**, select the **Rectangle 1** group in a new Shape+ layer.
2. Click **Add group property** (+).
3. Name the property `Travel`. Choose **Slider**, set **Maximum** to `200`, and click **Add**.
4. Select the rectangle inside **Rectangle 1**. Alt-click the animation button for **Position**.
5. Enter this expression and click **Apply**.

   ```js
   [thisLayer.content("Rectangle 1").param("Travel"), value[1]]
   ```

6. Select **Rectangle 1** again and drag **Travel**. The rectangle moves horizontally.

To read the same control from another layer, replace `thisLayer` with `layer("Shape+")`.
Use the source layer's name if you renamed it. For nested groups, add a `.content("Group name")` call for each level.
Names are case-sensitive. If siblings share a name, `content()` uses the first match.
If you rename a group or control, update its name in the expression.
`param()` returns the current value. Use `property("Travel")` for methods such as `valueAtTime()`.

## Frame rate and shader helpers

- In expressions, `fps` returns the owning sequence's frame rate (including at frame `0`).
- In Custom Shaders with Expressions+ enabled, declaring `uniform float zFps;` exposes the same sequence frame rate.
- Export frame rate overrides change output sampling without changing `fps`, `zFps`, or clip time.
- Expressions+ also provides noise, hash, color, and signed-distance shader includes. See [Shader includes](/docs/reference/shader/#includes).
