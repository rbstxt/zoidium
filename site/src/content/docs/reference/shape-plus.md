---
title: Shape+ contents and properties
description: Property types, defaults, ranges, and paint order for every Shape+ contents item.
sidebar:
  label: Shape+ reference
---
Shape+ coordinates are composition pixels, centered at the origin with positive Y upward. Layer transforms apply to the rendered layer. A — range means no declared minimum or maximum.


## Contents order and animation

A paint draws enabled paths above it in the same group, including paths inside earlier nested groups. Modifiers act on earlier paths in their scope.

Every item has **Enabled**, an **off**, **on** choice that defaults to **on**. Numbers, vectors, colors, and gradients animate. Choices stay fixed.


## Group

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Anchor** | 2D vector | — | `[0, 0]` | Pivot for the group or repeated transform. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Scale** | 2D vector | — | `[1, 1]` | Axis scale factors. 1 preserves size. |
| **Rotation** | Number | — | `0` | Rotation in degrees. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |


## Rectangle

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | — | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Roundness** | Number | ≥ 0 | `0` | Corner radius, limited to half the smaller rectangle dimension. |


## Ellipse

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | — | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |


## Polystar

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **star**, **polygon** | **star** | Star or regular polygon. |
| **Points** | Number | 3 to 128 | `5` | Point count. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Inner radius** | Number | ≥ 0 | `50` | Radius of the star's inner vertices. |
| **Outer radius** | Number | ≥ 0 | `100` | Radius of the outer vertices. |
| **Inner roundness** | Number | 0 to 100 | `0` | Rounding of the inner corners. |
| **Outer roundness** | Number | 0 to 100 | `0` | Rounding of the outer corners. |
| **Rotation** | Number | — | `0` | Rotation in degrees. |


## Path

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Closed** | Choice | **off**, **on** | **on** | Connects the last vertex to the first. |
| **Path** | Number | — | Four-vertex rectangle | Tangents are relative to the vertex. |


## Fill

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | — | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Fill rule** | Choice | **nonzero**, **even-odd** | **nonzero** | Winding rule for overlapping contours. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |


## Stroke

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | — | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Width** | Number | ≥ 0 | `10` | Stroke width in composition pixels. |
| **Cap** | Choice | **butt**, **round**, **square** | **butt** | Shape at an open stroke's ends. |
| **Join** | Choice | **miter**, **round**, **bevel** | **miter** | Shape where stroke segments meet. |
| **Miter limit** | Number | ≥ 1 | `4` | Maximum miter extension relative to stroke width. Larger joins fall back to bevels. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |
| **Dash / gap pairs** | Choice | **0**, **1**, **2**, **3** | **0** | Number of active dash and gap pairs. |
| **Dash 1** | Number | ≥ 0 | `20` | Length of dash 1 in pixels. |
| **Gap 1** | Number | ≥ 0 | `10` | Length of gap 1 in pixels. |
| **Dash 2** | Number | ≥ 0 | `20` | Length of dash 2 in pixels. |
| **Gap 2** | Number | ≥ 0 | `10` | Length of gap 2 in pixels. |
| **Dash 3** | Number | ≥ 0 | `20` | Length of dash 3 in pixels. |
| **Gap 3** | Number | ≥ 0 | `10` | Length of gap 3 in pixels. |
| **Dash offset** | Number | — | `0` | Moves the dash pattern along the path. |
| **Start length (%)** | Number | 0 to 100 | `0` | Percentage of the path occupied by the start taper. |
| **End length (%)** | Number | 0 to 100 | `0` | Percentage of the path occupied by the end taper. |
| **Start width (%)** | Number | ≥ 0 | `0` | Width at the start as a percentage of Width. |
| **End width (%)** | Number | ≥ 0 | `0` | Width at the end as a percentage of Width. |
| **Start ease** | Number | -100 to 100 | `0` | Shape of the start taper transition. |
| **End ease** | Number | -100 to 100 | `0` | Shape of the end taper transition. |
| **Wave amount (%)** | Number | 0 to 100 | `0` | Amount of width modulation along the stroke. |
| **Wave units** | Choice | **cycles**, **length** | **cycles** | Uses a cycle count or a pixel wavelength. |
| **Wavelength** | Number | ≥ 0.01 | `100` | Distance per stroke-width wave when Wave units is length. |
| **Cycles** | Number | ≥ 0 | `3` | Number of stroke-width waves when Wave units is cycles. |
| **Wave phase (degrees)** | Number | — | `0` | Phase of stroke-width modulation in degrees. |


## Gradient Fill

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Fill rule** | Choice | **nonzero**, **even-odd** | **nonzero** | Winding rule for overlapping contours. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |
| **Type** | Choice | **linear**, **radial** | **linear** | Linear or radial gradient geometry. |
| **Start point** | 2D vector | — | `[-100, 0]` | Gradient start or radial center. |
| **End point** | 2D vector | — | `[100, 0]` | Gradient endpoint or radial radius handle. |
| **Highlight length (%)** | Number | -99 to 99 | `0` | Radial gradient focal-point displacement as a percentage of its radius. |
| **Highlight angle** | Number | — | `0` | Direction of the radial focal-point displacement in degrees. |
| **Colors** | Gradient | Editable stops | Orange to blue | Color and opacity stops along the gradient. |


## Gradient Stroke

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Width** | Number | ≥ 0 | `10` | Stroke width in composition pixels. |
| **Cap** | Choice | **butt**, **round**, **square** | **butt** | Shape at an open stroke's ends. |
| **Join** | Choice | **miter**, **round**, **bevel** | **miter** | Shape where stroke segments meet. |
| **Miter limit** | Number | ≥ 1 | `4` | Maximum miter extension relative to stroke width. Larger joins fall back to bevels. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |
| **Dash / gap pairs** | Choice | **0**, **1**, **2**, **3** | **0** | Number of active dash and gap pairs. |
| **Dash 1** | Number | ≥ 0 | `20` | Length of dash 1 in pixels. |
| **Gap 1** | Number | ≥ 0 | `10` | Length of gap 1 in pixels. |
| **Dash 2** | Number | ≥ 0 | `20` | Length of dash 2 in pixels. |
| **Gap 2** | Number | ≥ 0 | `10` | Length of gap 2 in pixels. |
| **Dash 3** | Number | ≥ 0 | `20` | Length of dash 3 in pixels. |
| **Gap 3** | Number | ≥ 0 | `10` | Length of gap 3 in pixels. |
| **Dash offset** | Number | — | `0` | Moves the dash pattern along the path. |
| **Start length (%)** | Number | 0 to 100 | `0` | Percentage of the path occupied by the start taper. |
| **End length (%)** | Number | 0 to 100 | `0` | Percentage of the path occupied by the end taper. |
| **Start width (%)** | Number | ≥ 0 | `0` | Width at the start as a percentage of Width. |
| **End width (%)** | Number | ≥ 0 | `0` | Width at the end as a percentage of Width. |
| **Start ease** | Number | -100 to 100 | `0` | Shape of the start taper transition. |
| **End ease** | Number | -100 to 100 | `0` | Shape of the end taper transition. |
| **Wave amount (%)** | Number | 0 to 100 | `0` | Amount of width modulation along the stroke. |
| **Wave units** | Choice | **cycles**, **length** | **cycles** | Uses a cycle count or a pixel wavelength. |
| **Wavelength** | Number | ≥ 0.01 | `100` | Distance per stroke-width wave when Wave units is length. |
| **Cycles** | Number | ≥ 0 | `3` | Number of stroke-width waves when Wave units is cycles. |
| **Wave phase (degrees)** | Number | — | `0` | Phase of stroke-width modulation in degrees. |
| **Type** | Choice | **linear**, **radial** | **linear** | Linear or radial gradient geometry. |
| **Start point** | 2D vector | — | `[-100, 0]` | Gradient start or radial center. |
| **End point** | 2D vector | — | `[100, 0]` | Gradient endpoint or radial radius handle. |
| **Highlight length (%)** | Number | -99 to 99 | `0` | Radial gradient focal-point displacement as a percentage of its radius. |
| **Highlight angle** | Number | — | `0` | Direction of the radial focal-point displacement in degrees. |
| **Colors** | Gradient | Editable stops | Orange to blue | Color and opacity stops along the gradient. |


## Trim Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Start (%)** | Number | 0 to 100 | `0` | Beginning of the retained path interval. |
| **End (%)** | Number | 0 to 100 | `100` | End of the retained path interval. |
| **Offset (degrees)** | Number | — | `0` | Shifts the retained interval around the path in degrees. |
| **Trim multiple shapes** | Choice | **Simultaneously**, **Individually** | **Simultaneously** | Simultaneously trims each path, or individually distributes the trim over combined path length. |


## Repeater

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Copies** | Number | 0 to 128 | `3` | Copy count, including fractional final-copy opacity. |
| **Offset** | Number | — | `0` | Shifts the index used for repeated transforms. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |
| **Anchor** | 2D vector | — | `[0, 0]` | Pivot for the group or repeated transform. |
| **Position** | 2D vector | — | `[100, 0]` | Translation added per copy. |
| **Scale** | 2D vector | — | `[1, 1]` | Scale multiplied per copy. |
| **Rotation** | Number | — | `0` | Rotation added per copy in degrees. |
| **Start opacity** | Number | 0 to 1 | `1` | Opacity of the first copy. |
| **End opacity** | Number | 0 to 1 | `1` | Opacity of the last copy. |


## Round Corners

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius** | Number | ≥ 0 | `10` | Corner-rounding radius in pixels. |


## Twist

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Angle** | Number | — | `0` | Twist rotation in degrees. |
| **Center** | 2D vector | — | `[0, 0]` | Center of the deformation. |


## Zig Zag

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | Number | ≥ 0 | `10` | Displacement amplitude in pixels. |
| **Points** | Choice | **corner**, **smooth** | **corner** | Corner or smooth displacement joins. |
| **Ridges per segment** | Number | 1 to 64 | `3` | Number of zigzags per segment. |


## Pucker & Bloat

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amount (%)** | Number | -100 to 100 | `0` | Pulls vertices inward or pushes them outward relative to the path center. |


## Wiggle Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | Number | ≥ 0 | `10` | Displacement amplitude in pixels. |
| **Points** | Choice | **corner**, **smooth** | **corner** | Corner or smooth displacement joins. |
| **Detail** | Number | 1 to 100 | `5` | Number of wiggle samples along each path. |
| **Wiggles / second** | Number | 0 to 100 | `1` | Noise cycles per second. |
| **Correlation (%)** | Number | 0 to 100 | `50` | Correlation of neighboring wiggle samples. |
| **Temporal phase (degrees)** | Number | — | `0` | Temporal noise phase in degrees. |
| **Spatial phase (degrees)** | Number | — | `0` | Spatial noise phase in degrees. |
| **Random seed** | Number | — | `1` | Seed for repeatable random values. |


## Wiggle Transform

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Wiggles / second** | Number | 0 to 100 | `1` | Noise cycles per second. |
| **Correlation (%)** | Number | 0 to 100 | `50` | Correlation of neighboring wiggle samples. |
| **Temporal phase (degrees)** | Number | — | `0` | Temporal noise phase in degrees. |
| **Spatial phase (degrees)** | Number | — | `0` | Spatial noise phase in degrees. |
| **Random seed** | Number | — | `1` | Seed for repeatable random values. |
| **Anchor offset** | 2D vector | — | `[0, 0]` | Maximum anchor offset. |
| **Position offset** | 2D vector | — | `[20, 20]` | Maximum random translation. |
| **Scale offset (%)** | 2D vector | — | `[0, 0]` | Maximum scale deviation as a percentage. |
| **Rotation offset** | Number | — | `0` | Maximum random rotation in degrees. |


## Offset Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amount** | Number | — | `10` | Signed path expansion distance. |
| **Join** | Choice | **miter**, **round**, **bevel** | **miter** | Shape where stroke segments meet. |
| **Miter limit** | Number | 1 to 100 | `4` | Maximum miter extension relative to stroke width. Larger joins fall back to bevels. |

An open path is offset on both sides into a closed outline. A **round** join gives round ends, and the other joins give flat ends. On an open path, a negative **Amount** gives the same result as a positive one.


## Merge Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **merge**, **add**, **subtract**, **intersect**, **exclude** | **add** | Merge preserves contours. Add, subtract, intersect, and exclude perform Boolean path operations. |


## Limits and related references

Path tangents are relative to their vertices. New Contents paths start as four-vertex rectangles. Pen paths start open with one vertex.

SVG import and native conversion create editable vector contents. Text+ character animation has no equivalent in the converted Shape+ outlines.

[Create paths with Shape+](/docs/features/shape-plus/)

## Text

Text supplies glyph contours to paints and modifiers above its following paints.

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Source Text** | Dynamic text | Text | Hold keys and expressions. The multiline field follows the theme and grows while editing. |
| **Font Family** | Dynamic font asset | Native default font | Primary font reference. |
| **Fallback Font** | Dynamic font asset | None | Explicit fallback for unmapped grapheme clusters. |
| **Style** | Dynamic choice | Default | Writes the named instance's axis values. |
| Axis name and tag, for example **Weight (wght)** | Dynamic number | Font default | One row per variable axis, directly below **Style**. Font-defined minimum and maximum. |
| **Size** | Dynamic number | 100 | Composition pixels per em. |
| **Tracking** | Dynamic number | 0 | Thousandths of Size between glyphs. |
| **Leading** | Dynamic number | 120 | Baseline distance in composition pixels. |
| **Baseline Shift** | Dynamic number | 0 | Positive values move glyphs upward. |
| **Horizontal Scale (%)**, **Vertical Scale (%)** | Dynamic number | 100 | Glyph scale. |
| **Caps** | Dynamic choice | normal | normal, all, or small. Small uses uppercase at 75 percent size. |
| **Position** | Dynamic vector | [0, 0] | Baseline origin. |
| **Alignment** | Dynamic choice | left | left, center, right, justifyLeft, justifyCenter, justifyRight, justifyAll. |
| **Text Mode** | Dynamic choice | point | point or box. |
| **Box Size** | Dynamic vector | [600, 400] | Wrap width and visible height. |
| **First-Line Indent** | Dynamic number | 0 | First line of each paragraph. |
| **Space Before**, **Space After** | Dynamic number | 0 | Paragraph spacing in composition pixels. |

Discrete text controls use hold keys and support expressions. Animated Style
sets coordinates for axes without their own animation. Animated axis channels
retain their own values.

TTF, OTF, variable TrueType, CFF2, and WOFF1 are supported. WOFF2 displays an
unsupported-format status and retains the font reference. Missing fonts show a
status beside the item. There is no implicit font fallback. Japanese text uses
the selected font's Japanese glyphs.

The built-in fonts are static and show no axis rows. A Text item with a
static font shows "Static font: no variable axes" beside it. Axes appear
only with an imported variable font chosen in **Font Family**.

Box text wraps Latin words and breaks CJK per grapheme. Oversized Latin words
break per grapheme. Newlines start paragraphs. Lines outside the box height
are hidden. Point text does not wrap. Justification expands spaces. CJK lines without spaces distribute the extra
width between grapheme clusters. Other lines without spaces retain their advances.

The optional engine bundle loads on the first text use. Electron is untested.

## Text Animator

A Text Animator acts on every Text item above it in the same group, including
text in nested groups above it. Animators stack in list order from top to
bottom. An animator with no text above it shows "No text above this animator".
Each animated property applies as neutral + (value - neutral) x s, where s is
the combined selector value for each unit. Disabled properties contribute
nothing and hide their rows; toggle them with Add Property and Remove Property
on the animator's context menu. Per-character Opacity, Fill Color, Stroke
Color and Stroke Width are not yet supported.

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Anchor Point** | Dynamic vector | [0, 0] | Pivot offset for scale, rotation and skew. |
| **Position** | Dynamic vector | [0, 0] | Added to the glyph position. Y is up. |
| **Scale (%)** | Dynamic vector | [100, 100] | Neutral 100. |
| **Skew**, **Skew Axis** | Dynamic number | 0 | Degrees. Skew applies after scale, before rotation. |
| **Rotation** | Dynamic number | 0 | Degrees. |
| **Tracking Amount** | Dynamic number | 0 | Adds value x s x Size / 1000 after each affected character. Alignment is computed before these shifts. |
| **Character Offset** | Dynamic number | 0 | Integer shift of letters within a-z, A-Z or 0-9 with wraparound. A ligature shifts every letter of its cluster and reshapes as one unit with its first character's selector value (AE breaks ligatures instead). The new advance replaces the old one; kerning stays from the base shaping. |
| **Grouping Alignment (%)** | Dynamic vector | [0, 0] | Pivot shift as a percentage of the group box. |
| Axis name (tag) | Dynamic number | 0 | Offset added to the glyph's axis coordinate, clamped to the axis range. Ligature glyphs reshape as one cluster. Later characters shift by the advance difference. |
| **Anchor Point Grouping** | Static choice | Character | Character, Word, Line or All pivot unit. |
| Enabled flags, **Wiggly Selector** switch | Static | Off | Context-menu toggles; hidden rows. |

The pivot is the horizontal centre of the unit's advance span: a character's
own advance, or a word, line or all span, on the group's first baseline.
Grouping Alignment moves the pivot by a percentage of the group box (advance
span horizontally, font ascent to descent vertically).

| Range Selector | Type | Default | Effect |
| --- | --- | --- | --- |
| **Units** | Static choice | Percentage | Percentage or Index units over the whole item. |
| **Range Start**, **Range End**, **Range Offset** | Dynamic number | 0, 100, 0 | In Index units an End with no keys, no expression, and the default 100 means the last unit; otherwise End counts literally. Equal bounds select nothing. |
| **Based On** | Static choice | Characters | Characters, Characters Excluding Spaces, Words or Lines. Spaces take 0 except under Characters and Lines. |
| **Mode** | Static choice | Add | Add, Subtract, Intersect, Min, Max or Difference against the running value from 0, clamped to [-1, 1]. |
| **Amount (%)** | Dynamic number | 100 | -100 to 100; multiplies the selector value. |
| **Shape** | Static choice | Square | Square covers the unit span fractionally; Ramp Up, Ramp Down, Triangle, Round and Smooth sample the unit centre. |
| **Ease High (%)**, **Ease Low (%)** | Dynamic number | 0 | Reshape toward 1 or 0; 0 is the identity. |
| **Randomize Order**, **Random Seed** | Static switch, dynamic number | Off, 0 | Deterministic seeded unit permutation. |

| Wiggly Selector | Type | Default | Effect |
| --- | --- | --- | --- |
| **Wiggly Mode** | Static choice | Add | Same combination modes as the Range Selector. |
| **Maximum Amount (%)**, **Minimum Amount (%)** | Dynamic number | 100, -100 | Smooth noise scaled into this range. |
| **Wiggly Based On** | Static choice | Characters | Independent unit counting for the noise. |
| **Wiggles / Second** | Dynamic number | 2 | Noise rate in cycles per second. |
| **Correlation (%)** | Dynamic number | 50 | 100 shares one value across units; 0 is independent. |
| **Temporal Phase (degrees)**, **Spatial Phase (degrees)** | Dynamic number | 0 | Offsets in time and per unit. |
| **Lock Dimensions** | Static switch | Off | On shares one value across vector components. |
| **Wiggly Random Seed** | Dynamic number | 0 | Deterministic frame-based noise. |

## Create Shapes from Text

**Convert to Path** in the preview and **Create Shapes from Text** on the Objects
row replace Text with character groups at the current frame. Each contour is
a separate Path. Spaces produce no group. A ligature's outline belongs to its
first character; its remaining characters have empty named groups. Combining
marks stay in their base character's grapheme group. Winding and parent paint
order are preserved. One history entry restores the live text on Undo.

Conversion bakes the displayed frame with Text Animators into static paths.
The animator items stay in the list.

## Text cache limits

Text layout caches use the font identities, evaluated text and paragraph
properties, and variation coordinates. Replacing a font file invalidates the
old result. A layer transform reuses layout and geometry unless it changes
the flattening tolerance.

Accounting limits are 8 MiB each for layouts, glyph geometry, and glyph paint;
2 MiB each for parsed contours and shaped runs; 512 KiB for fallback coverage;
1 MiB for engine shaping results; and 4 MiB for outlines. These limits do not
measure the browser's full heap.

Touching or overlapping glyphs use compound fills. Sloped and curved contours
also retain the compound slab arrangement to preserve subpixel rasterization.
Trim in individual mode and transformed Repeater views invalidate per-glyph
fill reuse.

Inactive axes remain in the serialized `axisStore`. Their keys and expressions
return when a font exposes the tag again. Selecting Style leaves
expression-driven axes unchanged and displays a notice.
