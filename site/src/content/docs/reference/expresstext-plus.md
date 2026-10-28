---
title: ExpressText+ effector stack
description: Defaults and ranges for the ExpressText+ container and its Shake, Plain, Random, Formula, Delay, Spline, Orbit, Repeater, Twist, Wrap, and Voronoi sections.
sidebar:
  label: ExpressText+ reference
---
ExpressText+ tracks the separate letters of native 3D Text and drives them with an effector stack. Put an **ExpressText+** container above a 3D Text object. The container splits the text into tracked letters. Effectors come from the stock **Custom properties +** row, which offers only the eleven sections below. Each section evaluates per letter per frame. Ancestor effectors evaluate outermost first. A **Delay** section trails the whole stack.

When a Text+ container owns the text, ExpressText+ steps aside and leaves the letters to Text+.


## Output changes in version 3

Existing projects change output in these cases:

- Cross-Text selections use every Text's current undeformed letter bases before any effector evaluates. **Orbit** now uses the complete selection center on the first render and immediately after source edits. Same-frame redraws produce the same transforms.
- When a Text leaves ExpressText+ or the plugin deactivates, its native geometry keeps the latest text, size, font, and bevel settings.
- Nested **Group** transforms apply once to split letters. Earlier versions applied the intermediate Group transforms twice.
- When a Text moves between Groups, its split letters follow the current parent. Reorder, undo, and redo keep the same parent relationship.
- Formula `t` and Shake **Frequency** use the owning sequence's frame rate. At rates other than 30 fps, their motion now follows seconds. Their 30 fps output stays identical. Random **Animation speed** keeps its frame-based unit.
- Frame-rate changes scale section **Delay** values and Repeater **Lag** values to preserve their durations in seconds. Constant values, animated values, curve tangents, stored compositions, undo, and redo use the same conversion. Frequencies, **Animation speed**, and sample counts keep their values.

Projects at 30 fps retain their transforms when they do not encounter these cases.


## Container

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Rotation order** | Choice | **XYZ**, **XZY**, **YXZ**, **YZX**, **ZXY**, **ZYX** | **XYZ** | Order of the three rotation axes. |


## Shared section controls

Every section has an enable switch, a letter selection, a strength, a per-letter stagger, and a field. Empty **Letters** selects every letter. Letters number from 1 across every text under one container. Selections accept numbers, ranges such as `2-6`, `+` separators, and `kind-N` tokens such as `plain-2` that reuse the Nth section of that kind.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enable** | Choice | **off**, **on** | **on** | Switches the section off without deleting its rows. |
| **Letters** | Text | Text | empty | One-based letter numbers. Blank selects every letter. |
| **Strength** | Number | 0 to 100 for most sections, no declared bounds for **Random Strength** | `100` | Scales the section from off to full. |
| **Delay** | Number | ≥ 0 | `0` | Per-letter stagger in frames. |
| **Delay order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order in which letters receive the stagger. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Present in **Shake**, **Plain**, and **Random**. Rotation and scale pivot at the letter or the whole text. |
| **Field** | Choice | **Infinite**, **Linear**, **Box**, **Sphere** | **Infinite** | Gates letters by position. |
| **Field position** | 3D vector | No declared bounds | `[0, 0, 0]` | Center of the field volume. |
| **Field scale** | 3D vector | No declared bounds | `[100, 100, 100]` | Size of the field volume. |

The **Delay** section replaces the stagger rows with channel picks. Its table lists the full row set.


## Shake

Sinusoidal position, rotation, and scale. **Frequency** counts cycles per second at the owning sequence's frame rate. **Offset** shifts the phase in cycles.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | No declared bounds | `[0, 0, 0]` | Shake amplitude per axis. |
| **Rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Shake amplitude in degrees per axis. |
| **Scale** | 3D vector | No declared bounds | `[1, 1, 1]` | Shake amplitude as a scale multiplier per axis. |
| **Frequency** | Number | ≥ 0 | `1` | Oscillation speed in cycles per second. |
| **Offset** | Number | No declared bounds | `0` | Phase offset in cycles. |
| **Seed** | Number | No declared bounds | `1` | Seed for Random delay order. |


## Plain

Static pose for the selected letters. Blank **Letters** selects every letter. **Invert odd** mirrors position and rotation on odd-numbered letters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | No declared bounds | `[0, 0, 0]` | Static position offset. |
| **Rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Static rotation in degrees. |
| **Scale** | 3D vector | No declared bounds | `[1, 1, 1]` | Static scale multiplier. |
| **Invert odd** | Choice | **off**, **on** | **off** | Mirrors position and rotation on odd-numbered letters. |


## Random

Deterministic per-letter values in the Min and Max ranges, rescaled by **Minimum** and **Maximum** percent. **Mode** picks the distribution. **Synchronized** shares one value across position, rotation, and scale. **Indexed** samples each axis separately for Noise and Turbulence. **Space** pins the noise to the world or to the letter. **Animation speed** advances Noise and Turbulence per frame. A value of `100` advances the noise time parameter by one unit per 30 frames at every sequence frame rate.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Random**, **Gaussian**, **Noise**, **Turbulence**, **Sorted** | **Random** | Distribution of the per-letter values. |
| **Minimum** | Number | No declared bounds | `0` | Lower rescale bound in percent. |
| **Maximum** | Number | No declared bounds | `100` | Upper rescale bound in percent. |
| **Synchronized** | Choice | **off**, **on** | **off** | Shares one value across position, rotation, and scale. |
| **Indexed** | Choice | **off**, **on** | **on** | Samples each axis separately for Noise and Turbulence. |
| **Seed** | Number | No declared bounds | `1` | Reseeds every value. |
| **Space** | Choice | **Global**, **UV** | **Global** | Pins noise to the world or to the letter. |
| **Animation speed** | Number | ≥ 0 | `0` | Advances Noise and Turbulence by `value / 100` units of the noise time parameter per 30 frames. |
| **Noise scale** | Number | ≥ 0 | `100` | Feature size of Noise and Turbulence. |
| **Min position** | 3D vector | No declared bounds | `[-10, -10, -10]` | Lower bound of random translation. |
| **Max position** | 3D vector | No declared bounds | `[10, 10, 10]` | Upper bound of random translation. |
| **Min rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Lower bound of random rotation in degrees. |
| **Max rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Upper bound of random rotation in degrees. |
| **Min scale** | 3D vector | No declared bounds | `[1, 1, 1]` | Lower bound of random scale. |
| **Max scale** | 3D vector | No declared bounds | `[1, 1, 1]` | Upper bound of random scale. |


## Formula

One typed expression drives every letter. Variables: `px`, `py`, `pz` letter base position; `rx`, `ry`, `rz` incoming rotation; `sx`, `sy`, `sz` incoming scale; `u`, `v`, `w` letter position across the line from 0 to 1; `id` zero-based letter index; `count` letter total; `falloff` field weight; `t` time in seconds; `f` the **Frequency** row. Formula measures `t` after the per-letter stagger using the owning sequence's frame rate. Functions take degrees for trigonometry. Unknown names, empty input, and non-finite results read as `0`.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Minimum** | Number | No declared bounds | `0` | Lower rescale bound in percent. |
| **Maximum** | Number | No declared bounds | `100` | Upper rescale bound in percent. |
| **Expression** | Text | Text | `sin(u*360*f+t*90)` | Scalar expression evaluated per letter. |
| **Time** | Number | No declared bounds | `1` | Multiplier on the `t` variable. |
| **Frequency** | Number | No declared bounds | `1` | Free constant read as the `f` variable. |
| **Position** | 3D vector | No declared bounds | `[0, 10, 0]` | Amplitudes that multiply the output for position. |
| **Rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Amplitudes that multiply the output for rotation in degrees. |
| **Scale** | 3D vector | No declared bounds | `[1, 1, 1]` | Amplitudes that multiply the output for scale. |


## Delay

Each letter chases its own target with a trail. The cascade comes from the field sweep or animated values. Static poses hold still. **Strength** paces the trail: `0` follows the target exactly. **Position**, **Scale**, and **Rotation** pick the trailed channels. **Letters** accepts letter lists and `kind-N` tokens.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Strength** | Number | 0 to 100 | `100` | Trail length from exact follow to full trail. |
| **Mode** | Choice | **Even**, **Blend**, **Spring** | **Even** | Even closes in at uniform speed. Blend merges fast, then slow. Spring rides a spring. |
| **Position** | Choice | **off**, **on** | **on** | Trails the position channel. |
| **Scale** | Choice | **off**, **on** | **on** | Trails the scale channel. |
| **Rotation** | Choice | **off**, **on** | **on** | Trails the rotation channel. |


## Spline

Arranges letters along a built-in path. **Mode** spaces letters evenly, flows them with the field weight, or keeps proportional spacing. **Start** and **End** fence the area. Inverted ends flip the direction. **Clamp** piles overflow at the ends instead of wrapping. **Strength** blends the distance to the path. **Position** and **Rotation** pick the followed channels. **Heading**, **Pitch**, and **Bank** add orientation on top.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Step**, **Falloff**, **Relative** | **Step** | Letter spacing along the path. |
| **Transform** | Choice | **Absolute**, **Relative** | **Absolute** | Path coordinates in world space or relative to the letters. |
| **Path** | Choice | **Line**, **Circle**, **Helix** | **Line** | Built-in path shape. |
| **Length** | Number | ≥ 0 | `100` | Path length. |
| **Radius** | Number | ≥ 0 | `50` | Circle and helix radius. |
| **End radius** | Number | ≥ 0 | `50` | Helix radius at the far end. |
| **Height** | Number | ≥ 0 | `100` | Helix height. |
| **Turns** | Number | No declared bounds | `1` | Helix revolutions. |
| **Plane** | Choice | **XY**, **XZ**, **YZ** | **XY** | Plane of the path. |
| **Tilt** | 3D vector | No declared bounds | `[0, 0, 0]` | Path tilt in degrees. |
| **Reverse** | Choice | **off**, **on** | **off** | Reverses the path direction. |
| **Offset** | Number | No declared bounds | `0` | Letter travel along the path. |
| **Start** | Number | No declared bounds | `0` | Fenced area start in percent. |
| **End** | Number | No declared bounds | `100` | Fenced area end in percent. |
| **Clamp** | Choice | **off**, **on** | **on** | Piles overflow at the ends instead of wrapping. |
| **Position** | Choice | **off**, **on** | **on** | Follows the path position. |
| **Rotation** | Choice | **off**, **on** | **on** | Turns letters to the path tangent. |
| **Heading** | Number | No declared bounds | `0` | Added orientation in degrees. |
| **Pitch** | Number | No declared bounds | `0` | Added orientation in degrees. |
| **Bank** | Number | No declared bounds | `0` | Added orientation in degrees. |


## Orbit

Revolves the selected letters rigidly about their own center. Glyphs turn with the orbit. **Radius** scales the orbit size as a percent. A lone letter spins in place.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Angle** | 3D vector | No declared bounds | `[0, 0, 0]` | Orbit angle in degrees. Animate for revolutions. |
| **Radius** | Number | No declared bounds | `100` | Orbit size in percent. Zero gathers letters at the center. |


## Repeater

Multiplies every letter into ghosts. **Mode** picks the arrangement. Copies cap at 64 per section. **Fade** decays ghost opacity. Ghosts hide with unselected, weak, or disabled letters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Linear**, **Random**, **Echo** | **Linear** | Ghost arrangement. Echo smears copies along the letter motion by **Lag** frames. |
| **Copies** | Number | 0 to 64 | `3` | Ghost count per letter. |
| **Offset** | 3D vector | No declared bounds | `[10, 0, 0]` | Linear step per copy. |
| **Min range** | 3D vector | No declared bounds | `[-10, -10, -10]` | Lower bound of the Random scatter volume. |
| **Max range** | 3D vector | No declared bounds | `[10, 10, 10]` | Upper bound of the Random scatter volume. |
| **Seed** | Number | No declared bounds | `1` | Reseeds the Random scatter. |
| **Lag** | Number | ≥ 0 | `2` | Echo smear in frames. Still letters show no spread. |
| **Fade** | Number | 0 to 100 | `50` | Ghost opacity decay in percent. |


## Twist

Turns each letter about the chosen axis in proportion to its position. The middle letter holds still and the ends counter-rotate. A lone letter holds still.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Angle** | Number | No declared bounds | `0` | Total end-to-end twirl in degrees. |
| **Axis** | Choice | **X**, **Y**, **Z** | **Z** | Twirl axis. |


## Wrap

Sine displacement along **Direction** with **Frequency** cycles across the run. **Phase** takes degrees.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amplitude** | Number | No declared bounds | `0` | Wave height. Zero is the identity. |
| **Frequency** | Number | ≥ 0 | `1` | Wave cycles across the run. |
| **Phase** | Number | No declared bounds | `0` | Wave phase in degrees. Animate for travel. |
| **Direction** | Choice | **X**, **Y**, **Z** | **Y** | Displacement direction. |


## Voronoi

Shatters each selected letter into seeded cells, then explodes the pieces outward and spins them. **Strength** blends the shatter. The base letter hides while its chunks displace at full strength.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Chunks** | Number | 1 to 64 | `8` | Cell count per letter. |
| **Explode** | Number | No declared bounds | `0` | Outward travel of the pieces. |
| **Spin** | 3D vector | No declared bounds | `[0, 0, 0]` | Piece spin in degrees. |
| **Seed** | Number | No declared bounds | `1` | Reseeds the cells. |
