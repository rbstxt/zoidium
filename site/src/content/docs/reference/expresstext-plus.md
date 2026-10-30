---
title: ExpressText+ effector stack
description: Defaults and ranges for the ExpressText+ container and its Shake, Plain, Random, Formula, Delay, Spline, Orbit, Repeater, Twist, Wrap, and Voronoi sections.
sidebar:
  label: ExpressText+ reference
---
Put an **ExpressText+** container above a 3D Text object to split its letters into tracked letters, then drive them with the eleven sections below (added from the **Custom properties +** row). Each section evaluates per letter per frame. A **Delay** section trails the whole stack.

When a Text+ container owns the text, ExpressText+ steps aside and leaves the letters to Text+.

A — range accepts any value.


## Container

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Rotation order** | Choice | **XYZ**, **XZY**, **YXZ**, **YZX**, **ZXY**, **ZYX** | **XYZ** | Order of the three rotation axes. |


## Shared section controls

Every section has an enable switch, a letter selection, a strength, a per-letter stagger, and a field. Empty **Letters** selects every letter. Letters number from 1 across every text under one container. Selections accept numbers, ranges such as `2-6`, `+` separators, and `kind-N` tokens.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enable** | Choice | **off**, **on** | **on** | Switches the section off without deleting its rows. |
| **Letters** | Text | Text | empty | One-based letter numbers. Blank selects every letter. |
| **Strength** | Number | 0 to 100 for most sections; **Random Strength** is unbounded. | `100` | Scales the section from off to full. |
| **Delay** | Number | ≥ 0 | `0` | Per-letter stagger in frames. |
| **Delay order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order in which letters receive the stagger. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Present in **Shake**, **Plain**, and **Random**. Rotation and scale pivot at the letter or the whole text. |
| **Field** | Choice | **Infinite**, **Linear**, **Box**, **Sphere** | **Infinite** | Gates letters by position. |
| **Field position** | 3D vector | — | `[0, 0, 0]` | Center of the field volume. |
| **Field scale** | 3D vector | — | `[100, 100, 100]` | Size of the field volume. |

The **Delay** section replaces the stagger rows with channel picks.


## Shake

Sinusoidal position, rotation, and scale. **Offset** shifts the phase in cycles.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | — | `[0, 0, 0]` | Shake amplitude per axis. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Shake amplitude in degrees per axis. |
| **Scale** | 3D vector | — | `[1, 1, 1]` | Shake amplitude as a scale multiplier per axis. |
| **Frequency** | Number | ≥ 0 | `1` | Oscillation speed in cycles per second. |
| **Offset** | Number | — | `0` | Phase offset in cycles. |
| **Seed** | Number | — | `1` | Seed for Random delay order. |


## Plain

Static pose for the selected letters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | — | `[0, 0, 0]` | Static position offset. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Static rotation in degrees. |
| **Scale** | 3D vector | — | `[1, 1, 1]` | Static scale multiplier. |
| **Invert odd** | Choice | **off**, **on** | **off** | Mirrors position and rotation on odd-numbered letters. |


## Random

Per-letter values in the Min and Max ranges, rescaled by **Minimum** and **Maximum** percent.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Random**, **Gaussian**, **Noise**, **Turbulence**, **Sorted** | **Random** | Distribution of the per-letter values. |
| **Minimum** | Number | — | `0` | Lower rescale bound in percent. |
| **Maximum** | Number | — | `100` | Upper rescale bound in percent. |
| **Synchronized** | Choice | **off**, **on** | **off** | Shares one value across position, rotation, and scale. |
| **Indexed** | Choice | **off**, **on** | **on** | Samples each axis separately for Noise and Turbulence. |
| **Seed** | Number | — | `1` | Reseeds every value. |
| **Space** | Choice | **Global**, **UV** | **Global** | Pins noise to the world or to the letter. |
| **Animation speed** | Number | ≥ 0 | `0` | Advances Noise and Turbulence by `value / 100` units per 30 frames. |
| **Noise scale** | Number | ≥ 0 | `100` | Feature size of Noise and Turbulence. |
| **Min position** | 3D vector | — | `[-10, -10, -10]` | Lower bound of random translation. |
| **Max position** | 3D vector | — | `[10, 10, 10]` | Upper bound of random translation. |
| **Min rotation** | 3D vector | — | `[0, 0, 0]` | Lower bound of random rotation in degrees. |
| **Max rotation** | 3D vector | — | `[0, 0, 0]` | Upper bound of random rotation in degrees. |
| **Min scale** | 3D vector | — | `[1, 1, 1]` | Lower bound of random scale. |
| **Max scale** | 3D vector | — | `[1, 1, 1]` | Upper bound of random scale. |


## Formula

One typed expression drives every letter. Variables: `px`, `py`, `pz` letter base position; `rx`, `ry`, `rz` incoming rotation; `sx`, `sy`, `sz` incoming scale; `u`, `v`, `w` letter position across the line from 0 to 1; `id` zero-based letter index; `count` letter total; `falloff` field weight; `t` time in seconds; `f` the **Frequency** row. `t` is measured in seconds after the per-letter stagger. Functions take degrees. Unknown names, empty input, and non-finite results read as `0`.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Minimum** | Number | — | `0` | Lower rescale bound in percent. |
| **Maximum** | Number | — | `100` | Upper rescale bound in percent. |
| **Expression** | Text | Text | `sin(u*360*f+t*90)` | Scalar expression evaluated per letter. |
| **Time** | Number | — | `1` | Multiplier on the `t` variable. |
| **Frequency** | Number | — | `1` | Free constant read as the `f` variable. |
| **Position** | 3D vector | — | `[0, 10, 0]` | Amplitudes that multiply the output for position. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Amplitudes that multiply the output for rotation in degrees. |
| **Scale** | 3D vector | — | `[1, 1, 1]` | Amplitudes that multiply the output for scale. |


## Delay

Each letter chases its own target with a trail driven by the field sweep or animated values. Static poses hold still.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Strength** | Number | 0 to 100 | `100` | Trail length from exact follow to full trail. |
| **Mode** | Choice | **Even**, **Blend**, **Spring** | **Even** | Even closes in at uniform speed. Blend merges fast, then slow. Spring rides a spring. |
| **Position** | Choice | **off**, **on** | **on** | Trails the position channel. |
| **Scale** | Choice | **off**, **on** | **on** | Trails the scale channel. |
| **Rotation** | Choice | **off**, **on** | **on** | Trails the rotation channel. |


## Spline

Arranges letters along a built-in path. Inverted ends flip the direction.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Step**, **Falloff**, **Relative** | **Step** | Letter spacing along the path. |
| **Transform** | Choice | **Absolute**, **Relative** | **Absolute** | Path coordinates in world space or relative to the letters. |
| **Path** | Choice | **Line**, **Circle**, **Helix** | **Line** | Built-in path shape. |
| **Length** | Number | ≥ 0 | `100` | Path length. |
| **Radius** | Number | ≥ 0 | `50` | Circle and helix radius. |
| **End radius** | Number | ≥ 0 | `50` | Helix radius at the far end. |
| **Height** | Number | ≥ 0 | `100` | Helix height. |
| **Turns** | Number | — | `1` | Helix revolutions. |
| **Plane** | Choice | **XY**, **XZ**, **YZ** | **XY** | Plane of the path. |
| **Tilt** | 3D vector | — | `[0, 0, 0]` | Path tilt in degrees. |
| **Reverse** | Choice | **off**, **on** | **off** | Reverses the path direction. |
| **Offset** | Number | — | `0` | Letter travel along the path. |
| **Start** | Number | — | `0` | Fenced area start in percent. |
| **End** | Number | — | `100` | Fenced area end in percent. |
| **Clamp** | Choice | **off**, **on** | **on** | Piles overflow at the ends instead of wrapping. |
| **Position** | Choice | **off**, **on** | **on** | Follows the path position. |
| **Rotation** | Choice | **off**, **on** | **on** | Turns letters to the path tangent. |
| **Heading** | Number | — | `0` | Added orientation in degrees. |
| **Pitch** | Number | — | `0` | Added orientation in degrees. |
| **Bank** | Number | — | `0` | Added orientation in degrees. |


## Orbit

Revolves the selected letters rigidly about their own center. A lone letter spins in place.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Angle** | 3D vector | — | `[0, 0, 0]` | Orbit angle in degrees. Animate for revolutions. |
| **Radius** | Number | — | `100` | Orbit size in percent. Zero gathers letters at the center. |


## Repeater

Multiplies every letter into ghosts. Ghosts hide with unselected, weak, or disabled letters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Linear**, **Random**, **Echo** | **Linear** | Ghost arrangement. Echo smears copies along the letter motion by **Lag** frames. |
| **Copies** | Number | 0 to 64 | `3` | Ghost count per letter. |
| **Offset** | 3D vector | — | `[10, 0, 0]` | Linear step per copy. |
| **Min range** | 3D vector | — | `[-10, -10, -10]` | Lower bound of the Random scatter volume. |
| **Max range** | 3D vector | — | `[10, 10, 10]` | Upper bound of the Random scatter volume. |
| **Seed** | Number | — | `1` | Reseeds the Random scatter. |
| **Lag** | Number | ≥ 0 | `2` | Echo smear in frames. Still letters show no spread. |
| **Fade** | Number | 0 to 100 | `50` | Ghost opacity decay in percent. |


## Twist

Turns each letter about the chosen axis in proportion to its position. The middle letter holds still and the ends counter-rotate. A lone letter holds still.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Angle** | Number | — | `0` | Total end-to-end twirl in degrees. |
| **Axis** | Choice | **X**, **Y**, **Z** | **Z** | Twirl axis. |


## Wrap

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Amplitude** | Number | — | `0` | Wave height. Zero is the identity. |
| **Frequency** | Number | ≥ 0 | `1` | Wave cycles across the run. |
| **Phase** | Number | — | `0` | Wave phase in degrees. Animate for travel. |
| **Direction** | Choice | **X**, **Y**, **Z** | **Y** | Displacement direction. |


## Voronoi

Shatters each selected letter into seeded cells, then explodes the pieces outward and spins them. The base letter hides while its chunks displace at full strength.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Chunks** | Number | 1 to 64 | `8` | Cell count per letter. |
| **Explode** | Number | — | `0` | Outward travel of the pieces. |
| **Spin** | 3D vector | — | `[0, 0, 0]` | Piece spin in degrees. |
| **Seed** | Number | — | `1` | Reseeds the cells. |
