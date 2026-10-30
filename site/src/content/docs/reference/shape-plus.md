---
title: Shape+ contents and properties
description: Property types, defaults, ranges, and paint order for every Shape+ contents item.
sidebar:
  label: Shape+ reference
---
Shape+ coordinates are composition pixels, centered at the origin with positive Y upward. Native layer transforms apply to the rendered layer.


## Contents order and animation

A paint draws enabled paths above it in the same group, including paths inside earlier nested groups. Modifiers act on earlier paths in their scope.

Every item has **Enabled**, an **off**, **on** choice that defaults to **on**. Numbers, vectors, colors, and gradients animate. Choices stay fixed.


## Group

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Anchor** | 2D vector | No declared bounds | `[0, 0]` | Pivot for the group or repeated transform. |
| **Position** | 2D vector | No declared bounds | `[0, 0]` | Translation in the containing coordinate space. |
| **Scale** | 2D vector | No declared bounds | `[1, 1]` | Axis scale factors. 1 preserves size. |
| **Rotation** | Number | No declared bounds | `0` | Rotation in degrees. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |


## Rectangle

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | No declared bounds | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | No declared bounds | `[0, 0]` | Translation in the containing coordinate space. |
| **Roundness** | Number | ≥ 0 | `0` | Corner radius, limited to half the smaller rectangle dimension. |


## Ellipse

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | No declared bounds | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | No declared bounds | `[0, 0]` | Translation in the containing coordinate space. |


## Polystar

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **star**, **polygon** | **star** | Star or regular polygon. |
| **Points** | Number | 3 to 128 | `5` | Point count. |
| **Position** | 2D vector | No declared bounds | `[0, 0]` | Translation in the containing coordinate space. |
| **Inner radius** | Number | ≥ 0 | `50` | Radius of the star's inner vertices. |
| **Outer radius** | Number | ≥ 0 | `100` | Radius of the outer vertices. |
| **Inner roundness** | Number | 0 to 100 | `0` | Rounding of the inner corners. |
| **Outer roundness** | Number | 0 to 100 | `0` | Rounding of the outer corners. |
| **Rotation** | Number | No declared bounds | `0` | Rotation in degrees. |


## Path

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Closed** | Choice | **off**, **on** | **on** | Connects the last vertex to the first. |
| **Path** | Number | No declared bounds | Four-vertex rectangle | Tangents are relative to the vertex. |


## Fill

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | No declared bounds | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Fill rule** | Choice | **nonzero**, **even-odd** | **nonzero** | Winding rule for overlapping contours. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |


## Stroke

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | No declared bounds | `[1, 1, 1]` | Paint RGB color. |
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
| **Dash offset** | Number | No declared bounds | `0` | Moves the dash pattern along the path. |
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
| **Wave phase (degrees)** | Number | No declared bounds | `0` | Phase of stroke-width modulation in degrees. |


## Gradient Fill

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Opacity** | Number | 0 to 1 | `1` | Opacity multiplier. |
| **Fill rule** | Choice | **nonzero**, **even-odd** | **nonzero** | Winding rule for overlapping contours. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |
| **Type** | Choice | **linear**, **radial** | **linear** | Linear or radial gradient geometry. |
| **Start point** | 2D vector | No declared bounds | `[-100, 0]` | Gradient start or radial center. |
| **End point** | 2D vector | No declared bounds | `[100, 0]` | Gradient endpoint or radial radius handle. |
| **Highlight length (%)** | Number | -99 to 99 | `0` | Radial gradient focal-point displacement as a percentage of its radius. |
| **Highlight angle** | Number | No declared bounds | `0` | Direction of the radial focal-point displacement in degrees. |
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
| **Dash offset** | Number | No declared bounds | `0` | Moves the dash pattern along the path. |
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
| **Wave phase (degrees)** | Number | No declared bounds | `0` | Phase of stroke-width modulation in degrees. |
| **Type** | Choice | **linear**, **radial** | **linear** | Linear or radial gradient geometry. |
| **Start point** | 2D vector | No declared bounds | `[-100, 0]` | Gradient start or radial center. |
| **End point** | 2D vector | No declared bounds | `[100, 0]` | Gradient endpoint or radial radius handle. |
| **Highlight length (%)** | Number | -99 to 99 | `0` | Radial gradient focal-point displacement as a percentage of its radius. |
| **Highlight angle** | Number | No declared bounds | `0` | Direction of the radial focal-point displacement in degrees. |
| **Colors** | Gradient | Editable stops | Orange to blue | Color and opacity stops along the gradient. |


## Trim Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Start (%)** | Number | 0 to 100 | `0` | Beginning of the retained path interval. |
| **End (%)** | Number | 0 to 100 | `100` | End of the retained path interval. |
| **Offset (degrees)** | Number | No declared bounds | `0` | Shifts the retained interval around the path in degrees. |
| **Trim multiple shapes** | Choice | **Simultaneously**, **Individually** | **Simultaneously** | Simultaneously trims each path, or individually distributes the trim over combined path length. |


## Repeater

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Copies** | Number | 0 to 128 | `3` | Copy count, including fractional final-copy opacity. |
| **Offset** | Number | No declared bounds | `0` | Shifts the index used for repeated transforms. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint or copy order relative to earlier items in the same group. |
| **Anchor** | 2D vector | No declared bounds | `[0, 0]` | Pivot for the group or repeated transform. |
| **Position** | 2D vector | No declared bounds | `[100, 0]` | Translation added per copy. |
| **Scale** | 2D vector | No declared bounds | `[1, 1]` | Scale multiplied per copy. |
| **Rotation** | Number | No declared bounds | `0` | Rotation added per copy in degrees. |
| **Start opacity** | Number | 0 to 1 | `1` | Opacity of the first copy. |
| **End opacity** | Number | 0 to 1 | `1` | Opacity of the last copy. |


## Round Corners

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius** | Number | ≥ 0 | `10` | Corner-rounding radius in pixels. |


## Twist

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Angle** | Number | No declared bounds | `0` | Twist rotation in degrees. |
| **Center** | 2D vector | No declared bounds | `[0, 0]` | Center of the deformation. |


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
| **Temporal phase (degrees)** | Number | No declared bounds | `0` | Temporal noise phase in degrees. |
| **Spatial phase (degrees)** | Number | No declared bounds | `0` | Spatial noise phase in degrees. |
| **Random seed** | Number | No declared bounds | `1` | Seed for repeatable random values. |


## Wiggle Transform

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Wiggles / second** | Number | 0 to 100 | `1` | Noise cycles per second. |
| **Correlation (%)** | Number | 0 to 100 | `50` | Correlation of neighboring wiggle samples. |
| **Temporal phase (degrees)** | Number | No declared bounds | `0` | Temporal noise phase in degrees. |
| **Spatial phase (degrees)** | Number | No declared bounds | `0` | Spatial noise phase in degrees. |
| **Random seed** | Number | No declared bounds | `1` | Seed for repeatable random values. |
| **Anchor offset** | 2D vector | No declared bounds | `[0, 0]` | Maximum anchor offset. |
| **Position offset** | 2D vector | No declared bounds | `[20, 20]` | Maximum random translation. |
| **Scale offset (%)** | 2D vector | No declared bounds | `[0, 0]` | Maximum scale deviation as a percentage. |
| **Rotation offset** | Number | No declared bounds | `0` | Maximum random rotation in degrees. |


## Offset Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amount** | Number | No declared bounds | `10` | Signed path expansion distance. |
| **Join** | Choice | **miter**, **round**, **bevel** | **miter** | Shape where stroke segments meet. |
| **Miter limit** | Number | 1 to 100 | `4` | Maximum miter extension relative to stroke width. Larger joins fall back to bevels. |

An open path is offset on both sides into a closed outline. A **round** join gives round ends, and the other joins give flat ends. On an open path, a negative **Amount** gives the same result as a positive one.


## Merge Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **merge**, **add**, **subtract**, **intersect**, **exclude** | **add** | Merge preserves contours. Add, subtract, intersect, and exclude perform Boolean path operations. |


## Limits and related references

Path tangents are relative to their vertices. New native Contents paths start as four-vertex rectangles. Pen paths start open with one vertex.

SVG import and native conversion create editable vector contents. Text+ character animation has no equivalent in the converted Shape+ outlines.

[Create paths with Shape+](/docs/features/shape-plus/)
