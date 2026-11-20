---
title: Shape+ and layer masks
description: Build animated vector layers, draw pen masks on Scene and Adjustment clips, and animate 2D vector text with Shape+.
---
Use **Shape+** (enabled by default) to build vector shape layers with editable paths and modifiers, draw pen masks on **Scene** and **Adjustment** layers, and lay out or animate 2D vector text.
Shape+ coordinates use composition pixels centered at `(0, 0)` with positive Y upward. Native layer transforms apply to the rendered layer.

## Create a vector shape layer

1. Drag the **Shape+** Media preset onto the timeline and select the clip.
2. Open **Objects**, then click **+** on **Contents**.
3. Choose **Rectangle**, **Ellipse**, **Polystar**, or **Path**, and edit its properties.
4. Select a path in **Contents** and use the selection or pen tool in the main preview to reshape vertices and tangents.
5. To animate a path, enable its native **Path** keyframe switch, move the playhead, and edit the path at the new frame.

A paint item (**Fill**, **Stroke**, **Gradient Fill**, **Gradient Stroke**) paints every enabled path above it in the same group (including paths inside earlier nested groups). Modifiers act on earlier paths in their scope.
Drag items in **Contents** to reorder or group them, and click an item's eye button to hide it.
Every item has an **Enabled** choice (default **on**). Numbers, vectors, colors, and gradients can be animated; choice dropdowns stay static.

## Mask a Scene or Adjustment layer

1. Select a **Scene** or **Adjustment** clip on the timeline.
2. Click the **Mask pen (q)** toolbar button or press `Q` to open the pen overlay.
3. Click in the preview to place mask vertices, then press Enter to finish.
4. Press `Q` again to edit vertices (drag anchors to reshape; press Ctrl+Z to undo). Press `Q` a third time to exit mask editing.
5. In **Properties**, open the **Masks** group under the layer. Each mask provides mode cycling (**Add**, **Subtract**, **Intersect**), **Feather**, **Opacity**, invert and enable toggles, a path keyframe toggle, **Edit**, and **Delete**.
6. To animate a mask, move the playhead, enable the path keyframe toggle, and reshape the vertices.

When mask editing is off, preview drags return to normal viewport orbit and transform controls. Selecting another clip also exits mask editing.
Masks multiply layer alpha by their coverage after all effects run: on a **Scene** layer they cut the layer to transparent, and on an **Adjustment** layer they limit the effects to the masked region. An open path closes for coverage and stays open for shader sampling. Masks save with the layer without altering older projects.

## Add, edit, and animate 2D vector text

1. Select a **Shape+** clip, open **Objects**, click the **Contents +** menu, and choose **Text**.
2. Choose **Font Family** and edit **Source Text** in Properties (the multiline field follows the theme and grows as you type).
3. To edit directly in the preview, double-click the text. The rendered text stays visible with a caret and selection highlight. Type to replace text, press Enter for a new line, use arrow keys, Home, and End to move, double-click to select a word, and press Escape or click outside to commit one undo step.

- **Fonts:** Pickers list built-in fonts first, then imported fonts under **Project fonts** sorted by family name, then **custom...**. For Japanese text, pick a font with Japanese glyphs, or set **Fallback Font** for missing glyphs.
- **Variable fonts:** Most built-in fonts are static and display `"Static font: no variable axes"` beside the item in **Objects**. The built-in **Geist**, **Geist Mono**, and **Inter** fonts expose a weight axis, and **Geist Serif** exposes an `ELSH` shape axis. To use other variable axes, import a variable TTF, OTF, or WOFF1 font in [Assets](/docs/workflow/assets/) and choose it in **Font Family**. Its axes appear as named rows (such as **Weight (wght)**) directly below **Style**.
- **Paragraph text:** Set **Text Mode** to **box** and adjust **Box Size**.
- **Text Animators:** Select a **Text** item, open the preview context menu, and choose **Add Text Animator** and a property. Animate the property and **Range Selector** bounds, use **Add Property** on the animator for additional channels, or choose **Add Wiggly Selector** for noise-driven variation. Each animator affects every **Text** item above it in the same group, and stacked animators combine top to bottom.
- **Convert text to outlines:** Select a **Text** item and choose **Convert to Path** from the preview context menu (or **Create Shapes from Text** on the Objects row). Conversion bakes the current frame (including active Text Animators) into editable character **Group** and **Path** items in one undo step.

## Contents reference

A dash (`—`) in the range column means no declared minimum or maximum.

### Group

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Anchor** | 2D vector | — | `[0, 0]` | Pivot for the group or repeated transform. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Scale** | 2D vector | — | `[1, 1]` | Axis scale factors (`1` preserves size). |
| **Rotation** | Number | — | `0` | Rotation in degrees. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |

### Rectangle

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | — | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Roundness** | Number | ≥ 0 | `0` | Corner radius, capped at half the smaller dimension. |

### Ellipse

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | — | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |

### Polystar

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **star**, **polygon** | **star** | Star or regular polygon. |
| **Points** | Number | `3` to `128` | `5` | Point count. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Inner radius** | Number | ≥ 0 | `50` | Radius of the star's inner vertices. |
| **Outer radius** | Number | ≥ 0 | `100` | Radius of the outer vertices. |
| **Inner roundness** | Number | `0` to `100` | `0` | Rounding of the inner corners. |
| **Outer roundness** | Number | `0` to `100` | `0` | Rounding of the outer corners. |
| **Rotation** | Number | — | `0` | Rotation in degrees. |

### Path

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Closed** | Choice | **off**, **on** | **on** | Connects the last vertex to the first. |
| **Path** | Number | — | Four-vertex rectangle | Tangents are relative to each vertex. Pen paths start open with one vertex. |

### Fill

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | — | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Fill rule** | Choice | **nonzero**, **even-odd** | **nonzero** | Winding rule for overlapping contours. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint order relative to earlier items in the same group. |

### Stroke

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | — | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Width** | Number | ≥ 0 | `10` | Stroke width in composition pixels. |
| **Cap** | Choice | **butt**, **round**, **square** | **butt** | Shape at an open stroke's ends. |
| **Join** | Choice | **miter**, **round**, **bevel** | **miter** | Shape where stroke segments meet. |
| **Miter limit** | Number | ≥ 1 | `4` | Max miter extension relative to width before falling back to bevel. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint order relative to earlier items in the same group. |
| **Dash / gap pairs** | Choice | **0**, **1**, **2**, **3** | **0** | Number of active dash and gap pairs. |
| **Dash 1** – **Dash 3** | Number | ≥ 0 | `20` | Length of each dash in pixels. |
| **Gap 1** – **Gap 3** | Number | ≥ 0 | `10` | Length of each gap in pixels. |
| **Dash offset** | Number | — | `0` | Shifts the dash pattern along the path. |
| **Start length (%)**, **End length (%)** | Number | `0` to `100` | `0` | Percentage of the path covered by start or end taper. |
| **Start width (%)**, **End width (%)** | Number | ≥ 0 | `0` | Width at start or end as a percentage of **Width**. |
| **Start ease**, **End ease** | Number | `-100` to `100` | `0` | Shape of start or end taper transition. |
| **Wave amount (%)** | Number | `0` to `100` | `0` | Amount of width modulation along the stroke. |
| **Wave units** | Choice | **cycles**, **length** | **cycles** | Uses a cycle count or a pixel wavelength. |
| **Wavelength** | Number | ≥ 0.01 | `100` | Distance per wave when **Wave units** is **length**. |
| **Cycles** | Number | ≥ 0 | `3` | Number of waves when **Wave units** is **cycles**. |
| **Wave phase (degrees)** | Number | — | `0` | Phase of width modulation in degrees. |

### Gradient Fill and Gradient Stroke

**Gradient Fill** uses **Opacity** (`0` to `1`, default `1`), **Fill rule** (**nonzero** or **even-odd**), **Composite**, plus the gradient geometry controls below.
**Gradient Stroke** shares every **Stroke** control except solid **Color**, plus the gradient geometry controls below.

| Gradient control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **linear**, **radial** | **linear** | Linear or radial gradient geometry. |
| **Start point** | 2D vector | — | `[-100, 0]` | Gradient start or radial center. |
| **End point** | 2D vector | — | `[100, 0]` | Gradient endpoint or radial radius handle. |
| **Highlight length (%)** | Number | `-99` to `99` | `0` | Radial focal-point offset as a percentage of radius. |
| **Highlight angle** | Number | — | `0` | Direction of radial focal-point offset in degrees. |
| **Colors** | Gradient | Editable stops | Orange to blue | Color and opacity stops along the gradient. |

### Modifiers

#### Trim Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Start (%)** | Number | `0` to `100` | `0` | Start of the retained path interval. |
| **End (%)** | Number | `0` to `100` | `100` | End of the retained path interval. |
| **Offset (degrees)** | Number | — | `0` | Shifts the retained interval around the path. |
| **Trim multiple shapes** | Choice | **Simultaneously**, **Individually** | **Simultaneously** | Trims each path together or distributes the trim across combined path length. |

#### Repeater

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Copies** | Number | `0` to `128` | `3` | Copy count (fractional values fade the last copy's opacity). |
| **Offset** | Number | — | `0` | Shifts the transform index for repeated copies. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Copy stacking order. |
| **Anchor** | 2D vector | — | `[0, 0]` | Pivot for repeated transforms. |
| **Position** | 2D vector | — | `[100, 0]` | Translation added per copy. |
| **Scale** | 2D vector | — | `[1, 1]` | Scale multiplied per copy. |
| **Rotation** | Number | — | `0` | Rotation added per copy in degrees. |
| **Start opacity**, **End opacity** | Number | `0` to `1` | `1` | Opacity of the first and last copies. |

#### Round Corners, Twist, Zig Zag, and Pucker & Bloat

- **Round Corners:** **Radius** (≥ 0, default `10` px).
- **Twist:** **Angle** (degrees, default `0`), **Center** (2D vector, default `[0, 0]`).
- **Zig Zag:** **Size** (≥ 0, default `10` px), **Points** (**corner** or **smooth**, default **corner**), **Ridges per segment** (`1` to `64`, default `3`).
- **Pucker & Bloat:** **Amount (%)** (`-100` to `100`, default `0`) pulls vertices inward or pushes them outward relative to the path center.

#### Wiggle Paths and Wiggle Transform

Both share **Wiggles / second** (`0` to `100`, default `1`), **Correlation (%)** (`0` to `100`, default `50`), **Temporal phase (degrees)** (default `0`), **Spatial phase (degrees)** (default `0`), and **Random seed** (default `1`).

- **Wiggle Paths** adds **Size** (≥ 0, default `10` px), **Points** (**corner** or **smooth**, default **corner**), and **Detail** (`1` to `100`, default `5`).
- **Wiggle Transform** adds **Anchor offset** (`[0, 0]`), **Position offset** (`[20, 20]`), **Scale offset (%)** (`[0, 0]`), and **Rotation offset** (`0` degrees).

#### Offset Paths and Merge Paths

- **Offset Paths:** **Amount** (default `10`), **Join** (**miter**, **round**, or **bevel**, default **miter**), **Miter limit** (`1` to `100`, default `4`). Open paths offset on both sides into a closed outline (**round** gives round ends, other joins give flat ends, and negative **Amount** matches positive).
- **Merge Paths:** **Mode** (**merge**, **add**, **subtract**, **intersect**, **exclude**; default **add**). **merge** keeps contours separate; the other four perform Boolean path operations.

SVG import and native conversion produce editable vector contents. Native Text+ character animation does not transfer when converting a Text layer to Shape+.

## Text and Text Animator reference

### Text

**Text** supplies glyph contours to modifiers and paints below it in the same group. Discrete text properties use hold keys and support expressions.

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Source Text** | Dynamic text | `Text` | Multiline string; supports hold keys and expressions. |
| **Font Family** | Dynamic font asset | Native default | Primary font reference. |
| **Fallback Font** | Dynamic font asset | None | Explicit fallback for unmapped grapheme clusters (no implicit fallback). |
| **Style** | Dynamic choice | Default | Writes a named instance's axis values (leaves expression-driven axes unchanged and shows a notice). |
| Variable axes (e.g. **Weight (wght)**) | Dynamic number | Font default | One row per axis directly below **Style**, bounded by the font. |
| **Size** | Dynamic number | `100` | Composition pixels per em. |
| **Tracking** | Dynamic number | `0` | Thousandths of **Size** between glyphs. |
| **Leading** | Dynamic number | `120` | Baseline distance in composition pixels. |
| **Baseline Shift** | Dynamic number | `0` | Positive values move glyphs upward. |
| **Horizontal Scale (%)**, **Vertical Scale (%)** | Dynamic number | `100` | Glyph scale. |
| **Caps** | Dynamic choice | `normal` | `normal`, `all`, or `small` (uppercase at 75% size). |
| **Position** | Dynamic vector | `[0, 0]` | Baseline origin. |
| **Alignment** | Dynamic choice | `left` | `left`, `center`, `right`, `justifyLeft`, `justifyCenter`, `justifyRight`, `justifyAll`. |
| **Text Mode** | Dynamic choice | `point` | `point` (no wrap) or `box`. |
| **Box Size** | Dynamic vector | `[600, 400]` | Wrap width and visible height (overflow lines are hidden). |
| **First-Line Indent** | Dynamic number | `0` | Indent on the first line of each paragraph. |
| **Space Before**, **Space After** | Dynamic number | `0` | Paragraph spacing in composition pixels. |

- **Formats:** TTF, OTF, variable TrueType, CFF2, and WOFF1 are supported. WOFF2 shows an unsupported-format status while retaining the asset reference. Missing fonts show a status beside the item.
- **Wrapping:** Box text wraps Latin words (breaking oversized words per grapheme) and breaks CJK per grapheme. Newlines start paragraphs. Justification expands spaces, or distributes width between grapheme clusters on space-free CJK lines.
- **Variable axes:** Animated **Style** sets axes that have no animation of their own; animated axis channels keep their own values. Inactive axes stay in `axisStore` and return if you switch back to a font with that axis tag. The optional text engine bundle loads on first text use (Electron is untested).

### Text Animator

A **Text Animator** affects every **Text** item above it in the same group (including earlier nested groups) and stacks top to bottom. An animator with no text above it displays `"No text above this animator"`.
Each enabled property applies `neutral + (value - neutral) * s`, where `s` is the combined selector weight for each unit. Toggle properties with **Add Property** and **Remove Property** in the animator's context menu. Per-character Opacity, Fill Color, Stroke Color, and Stroke Width are not yet supported.

| Property | Type | Default | Effect |
| --- | --- | --- | --- |
| **Anchor Point** | Dynamic vector | `[0, 0]` | Pivot offset for scale, rotation, and skew. |
| **Position** | Dynamic vector | `[0, 0]` | Added to glyph position (positive Y is up). |
| **Scale (%)** | Dynamic vector | `[100, 100]` | Neutral is `100`. |
| **Skew**, **Skew Axis** | Dynamic number | `0` | Degrees. Applied after scale and before rotation. |
| **Rotation** | Dynamic number | `0` | Degrees. |
| **Tracking Amount** | Dynamic number | `0` | Adds `value * s * Size / 1000` after each affected character (alignment runs before this shift). |
| **Character Offset** | Dynamic number | `0` | Integer wraparound shift within `a–z`, `A–Z`, or `0–9`. Ligatures shift every letter of their cluster and reshape as one unit using the first character's weight. The new advance replaces the old one, and kerning stays from the base shaping. |
| **Grouping Alignment (%)** | Dynamic vector | `[0, 0]` | Shifts pivot as a percentage of the group box (advance span horizontally, ascent to descent vertically). |
| Variable axis (tag) | Dynamic number | `0` | Offset added to the glyph's axis coordinate, clamped to axis bounds. |
| **Anchor Point Grouping** | Static choice | `Character` | Pivot unit: `Character`, `Word`, `Line`, or `All` (centered horizontally on the unit's advance span on the first baseline). |

#### Range Selector

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Units** | Static choice | `Percentage` | `Percentage` or `Index` across the whole item. |
| **Range Start**, **Range End**, **Range Offset** | Dynamic number | `0`, `100`, `0` | Under `Index`, an unkeyed, expression-free default `End` of `100` selects through the last unit; otherwise `End` counts literally. Equal bounds select nothing. |
| **Based On** | Static choice | `Characters` | `Characters`, `Characters Excluding Spaces`, `Words`, or `Lines`. Spaces get `0` except under `Characters` and `Lines`. |
| **Mode** | Static choice | `Add` | `Add`, `Subtract`, `Intersect`, `Min`, `Max`, or `Difference`, clamped to `[-1, 1]`. |
| **Amount (%)** | Dynamic number | `100` | `-100` to `100`; multiplies selector weight. |
| **Shape** | Static choice | `Square` | `Square` covers unit span fractionally; `Ramp Up`, `Ramp Down`, `Triangle`, `Round`, and `Smooth` sample unit centers. |
| **Ease High (%)**, **Ease Low (%)** | Dynamic number | `0` | Reshapes weights toward `1` or `0` (`0` is unchanged). |
| **Randomize Order**, **Random Seed** | Static switch, dynamic number | `Off`, `0` | Deterministic seeded unit permutation. |

#### Wiggly Selector

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Wiggly Mode** | Static choice | `Add` | Same combination modes as **Range Selector**. |
| **Maximum Amount (%)**, **Minimum Amount (%)** | Dynamic number | `100`, `-100` | Smooth noise scaled into this range. |
| **Wiggly Based On** | Static choice | `Characters` | Independent unit counting for noise. |
| **Wiggles / Second** | Dynamic number | `2` | Noise rate in cycles per second. |
| **Correlation (%)** | Dynamic number | `50` | `100` shares one value across units; `0` is independent. |
| **Temporal Phase (degrees)**, **Spatial Phase (degrees)** | Dynamic number | `0` | Offsets in time and per unit. |
| **Lock Dimensions** | Static switch | `Off` | Shares one noise value across vector components. |
| **Wiggly Random Seed** | Dynamic number | `0` | Deterministic frame-based noise seed. |

### Conversion and text cache limits

- **Create Shapes from Text:** Replaces **Text** with character groups at the current frame (each contour as a separate **Path**; spaces make no group; ligature outlines go to the first character with empty named groups for the rest; combining marks stay with their base character). Winding, parent paint order, and existing animator rows are preserved, and one Undo restores live text.
- **Cache budgets:** Text layout caches key on font identities, evaluated text and paragraph properties, and variation coordinates. Replacing a font file invalidates the old result. A layer transform reuses layout and geometry unless it changes the flattening tolerance. Accounting limits are `8` MiB each for layouts, glyph geometry, and glyph paint; `2` MiB each for parsed contours and shaped runs; `512` KiB for fallback coverage; `1` MiB for engine shaping results; and `4` MiB for outlines. These limits do not measure the full browser heap. Touching or overlapping glyphs use compound fills, and sloped and curved contours also keep the compound slab arrangement to preserve subpixel rasterization. Individual-mode **Trim Paths** and transformed **Repeater** views bypass per-glyph fill reuse.
