---
title: Native FX transitions
description: Exact Native FX controls, defaults, output, and limits.
sidebar:
  label: Native FX transitions
  order: 75
---
[Native FX overview](/docs/reference/native-fx/) lists every effect.

Numeric ranges are the minimum and maximum in the property definitions. Color defaults are RGB component values.

## CC Page Turn

Curls the current input around a cylindrical fold with a shaded back page.

Editor location: **Effects** picker > **NATIVE FX** > **CC Page Turn**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Fold Position** | Vector2 | See component rows | `(0.7, 0.7)` | Fold point in normalized image coordinates, with the origin at the top left. |
| **Fold Position.X** | Number | 0 to 1 | 0.7 | Horizontal component of Fold Position. |
| **Fold Position.Y** | Number | 0 to 1 | 0.7 | Vertical component of Fold Position. |
| **Fold Direction** | Number | -360 to 360 | 315 | Fold-line direction in degrees. |
| **Fold Radius** | Number | 0 to 1000 | 20 | Curl radius in layer pixels. The shader keeps a minimum radius of half a pixel. |
| **Light Direction** | Number | -360 to 360 | -45 | Shading-light direction in degrees. |
| **Render** | Option | **Front & Back Page**, **Back Page**, **Front Page** | **Front & Back Page** | Selects both page faces, the back only, or the front only. |
| **Back Page** | Option | **Mirrored Layer**, **Paper Color** | **Mirrored Layer** | Mirrored Layer uses sampled source color mixed with Paper Color. Paper Color uses only the solid paper color. |
| **Back Opacity** | Number | 0 to 100 | 75 | Percentage source-color contribution on the mirrored back. Zero uses Paper Color. This does not change back-face alpha. |
| **Paper Color** | Color | No effect-specific numeric bounds | `[1, 1, 1]` | Solid back color or tint used by the mirrored back. |

### Rendering and limits

The effect samples only the current input. It has no automatic transition clock or simulation history.
The fold is an analytic cylinder, clipped to the input and effect buffer.
**Back Opacity** blends source color with **Paper Color**. It does not make the back face transparent.
The paper back still uses the source alpha, so transparent input areas remain transparent.
This is one shader pass with no scratch targets.

## Card Wipe

Flips the current input as a grid of cards in a selected order.

Editor location: **Effects** picker > **NATIVE FX** > **Card Wipe**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Transition Completion** | Number | 0 to 100 | 0 | Flip progress as a percentage. Zero copies the input exactly. At 100, the card backs face the viewer. |
| **Transition Width** | Number | 1 to 100 | 50 | Percentage of the transition occupied by each card's flip. Larger values overlap more flips. |
| **Rows** | Number | 1 to 64 | 8 | Grid row count, rounded to an integer. |
| **Columns** | Number | 1 to 64 | 8 | Grid column count, rounded to an integer. |
| **Card Scale** | Number | 0.01 to 10 | 1 | Scale of each card around its own center. |
| **Flip Axis** | Option | **X**, **Y**, **Random** | **X** | Rotation axis, or a seeded per-card choice of X or Y. |
| **Flip Direction** | Option | **Positive**, **Negative**, **Random** | **Positive** | Rotation sign, or a seeded per-card sign. |
| **Flip Order** | Option | **Left to Right**, **Right to Left**, **Top to Bottom**, **Bottom to Top**, **Top Left to Bottom Right**, **Top Right to Bottom Left**, **Bottom Left to Top Right**, **Bottom Right to Top Left**, **Gradient** | **Left to Right** | Spatial flip order. Gradient uses the source luminance at each card's center. |
| **Timing Randomness** | Number | 0 to 1 | 0 | Seeded variation in each card's starting progress. |
| **Random Seed** | Number | 0 to 10000 | 1 | Repeatable seed for random axes, directions, and timing. |
| **Back Layer** | Option | **Color**, **Transparent** | **Transparent** | Color uses Back Color. Transparent removes the back-facing card. No other-layer input is provided. |
| **Back Color** | Color | No effect-specific numeric bounds | `[0, 0, 0]` | Color of opaque card backs before shading. |
| **Camera Distance** | Number | 1 to 20 | 2 | Perspective camera distance in layer-height units. Larger values reduce perspective distortion. |
| **Light Intensity** | Number | 0 to 4 | 1 | Directional card-shading intensity. |
| **Ambient Light** | Number | 0 to 2 | 0.25 | Mixes the angular shading factor toward 1 before multiplication by Light Intensity. |

### Rendering and limits

**Transition Completion** controls the transition explicitly. There is no automatic time advance or earlier-frame capture.
Random axes, directions, and timing derive from the seed and card index.
At 0% completion, the input passes through before shading or scaling.
At 100%, **Back Layer** selects **Back Color** or transparency for the backs.

The grid is capped at 64 × 64 cards.
Each output pixel belongs to its own grid cell. Cards rotate in place and cannot overlap neighboring cells.
Values of **Card Scale** above 1 magnify the sampled image within the cell rather than expanding card geometry across cells.
The implementation uses a float RGBA data texture for per-card randomness.

## CC Pixel Polly

Breaks the current input into moving polygon or square pieces.

Editor location: **Effects** picker > **NATIVE FX** > **CC Pixel Polly**.

| Property | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Option | **off**, **on** | **on** | off bypasses the effect. on applies it. |
| **Force** | Number | -1000 to 1000 | 100 | Signed outward speed scale from Force Center. Negative values pull pieces inward. |
| **Gravity** | Number | -20 to 20 | 1 | Vertical acceleration scale. Positive values move pieces downward. |
| **Spinning** | Number | -720 to 720 | 0 | Additional angular speed in degrees per second on top of seeded per-piece spin. |
| **Force Center** | Vector2 | See component rows | `(0.5, 0.5)` | Force origin in normalized image coordinates. |
| **Force Center.X** | Number | 0 to 1 | 0.5 | Horizontal component of Force Center. |
| **Force Center.Y** | Number | 0 to 1 | 0.5 | Vertical component of Force Center. |
| **Direction Randomness** | Number | 0 to 100 | 10 | Percentage of seeded angular variation in each piece's initial direction. |
| **Speed Randomness** | Number | 0 to 100 | 10 | Percentage of seeded variation in piece speed. |
| **Grid Spacing** | Number | 1 to 500 | 10 | Requested piece-grid spacing in layer pixels, rounded to an integer. |
| **Object** | Option | **Polygon**, **Textured Polygon**, **Square**, **Textured Square** | **Polygon** | Polygon modes split each cell into two triangles. Square modes use one square. Textured choices retain the image within each piece. |
| **Enable Depth Sort** | Option | **off**, **on** | **on** | on orders pieces by depth before drawing. |
| **Start Time (sec)** | Number | -1000 to 1000 | 0 | Start time in seconds on the evaluated effect clock. |
| **Random Seed** | Number | 0 to 10000 | 1 | Repeatable seed for piece direction, speed, depth, and spin. |

### Temporal behavior and limits

Elapsed time is `evaluatedFrame / projectFps - Start Time (sec)`.
At or before zero elapsed time, the effect copies the input.
After the start, piece position and rotation are calculated directly from elapsed time and the current property values.
Pieces sample the current input, not an image frozen at the start. No earlier or later source frames are captured.
Seeking produces the same piece plan without replaying a simulation.
The clip's output range controls visibility. No wrap or separate end-of-clip sample is used.

The plan is capped at 8,192 pieces.
If the requested grid exceeds this cap, spacing increases by factors of 1.25 until the plan fits.
The renderer rebuilds the mesh when resolution, grid spacing, or object type changes.
It updates piece vertices for the current frame and draws one merged mesh with 16-bit indices.
**Polygon** and **Square** use each piece's center color. Their **Textured** variants sample across the piece.
