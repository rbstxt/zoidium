---
title: ExpressText+
description: Split 3D Text into tracked letters and stack Shake, Plain, Random, Formula, Delay, Spline, Orbit, Repeater, Twist, Wrap, and Voronoi effectors.
---
Use **ExpressText+** (enabled by default) to split a 3D Text object into individually tracked letters and drive them with a reorderable stack of 11 procedural effectors.
If a [Text+](/docs/2d-and-text/text-plus/) container owns the same 3D Text object, ExpressText+ steps aside and leaves those letters to Text+.

## Set up an ExpressText+ stack

1. In a 3D Scene's **Objects** panel, add an **ExpressText+** container.
2. Place one or more native **3D Text** objects inside the container.
3. On the container's **Custom properties +** row, add one or more effector sections (**Shake**, **Plain**, **Random**, **Formula**, **Delay**, **Spline**, **Orbit**, **Repeater**, **Twist**, **Wrap**, or **Voronoi**).
4. Drag section headers inside **Custom properties** to change evaluation order. Each drop is one undo step, and saved or duplicated containers keep the order. Changing order affects transform composition and `kind-N` letter selections.

Each section evaluates per letter per frame. A **Delay** section trails the whole upstream stack.

## Container and shared section controls

The container itself exposes **Rotation order** (**XYZ**, **XZY**, **YXZ**, **YZX**, **ZXY**, **ZYX**; default **XYZ**).
A dash (`—`) means no declared minimum or maximum.

Every effector section shares these controls (except **Delay**, which replaces the stagger rows with channel toggles):

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enable** | Choice | **off**, **on** | **on** | Disables the section without deleting its rows. |
| **Letters** | Text | Text | Empty | One-based letter numbers across all text in the container. Empty selects all. Accepts numbers, ranges (`2-6`), `+` separators, and `kind-N` tokens. |
| **Strength** | Number | `0` to `100` (**Random Strength** is unbounded) | `100` | Scales section effect from off to full. |
| **Delay** | Number | ≥ 0 | `0` | Per-letter time stagger in frames. |
| **Delay order** | Choice | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | Order of the per-letter stagger. |
| **Pivot** | Choice | **Character**, **Text** | **Character** | Present in **Shake**, **Plain**, and **Random**. Sets rotation and scale pivot. |
| **Field** | Choice | **Infinite**, **Linear**, **Box**, **Sphere** | **Infinite** | Gates letter weights by position. |
| **Field position** | 3D vector | — | `[0, 0, 0]` | Center of the field volume. |
| **Field scale** | 3D vector | — | `[100, 100, 100]` | Size of the field volume. |

- **Live values:** **Letters** and Formula **Expression** show their current evaluated text even between keyframes.
- **When Delay appears:** Per-letter **Delay** shifts evaluation time. Static **Plain** transforms and static **Random** ranges produce the same pose at every time; animate their transforms (or set **Animation speed** > `0` in **Random Noise** / **Turbulence**) to see the stagger.
- **Viewport field guides:** When the container is selected, each non-**Infinite** **Field** draws a wire box in the 3D editor in undeformed text coordinates (showing bounds for **Box** and **Sphere**, or the reference volume for **Linear**). Guides never appear in Preview cache frames or exports.

## Shake

**Sine** oscillates position, rotation, and scale sinusoidally. **Noise** uses seeded fractal noise. Both evaluate deterministically from the requested frame. Default amplitudes produce no motion; set at least one non-neutral amplitude to see **Delay** take effect.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Sine**, **Noise** | **Sine** | Oscillator type (existing sections retain Sine). |
| **Position** | 3D vector | — | `[0, 0, 0]` | Position shake amplitude per axis. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Rotation shake amplitude in degrees per axis. |
| **Scale** | 3D vector | — | `[1, 1, 1]` | Scale multiplier amplitude per axis. |
| **Frequency** | Number | ≥ 0 | `1` | Oscillation speed in cycles per second. |
| **Offset** | Number | — | `0` | Phase shift in cycles. |
| **Seed** | Number | — | `1` | Seed for Noise and Random delay order. |

## Plain

Applies a static (or keyframed) offset pose to selected letters.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Position** | 3D vector | — | `[0, 0, 0]` | Position offset. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Rotation in degrees. |
| **Scale** | 3D vector | — | `[1, 1, 1]` | Scale multiplier. |
| **Invert odd** | Choice | **off**, **on** | **off** | Mirrors position and rotation on odd-numbered letters. |

## Random

Generates per-letter values inside the Min/Max ranges, rescaled by **Minimum** and **Maximum** percent.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Random**, **Gaussian**, **Noise**, **Turbulence**, **Sorted** | **Random** | Value distribution across letters. |
| **Minimum**, **Maximum** | Number | — | `0`, `100` | Lower and upper rescale bounds in percent. |
| **Synchronized** | Choice | **off**, **on** | **off** | Uses one random value across position, rotation, and scale. |
| **Indexed** | Choice | **off**, **on** | **on** | Samples each axis independently for Noise and Turbulence. |
| **Seed** | Number | — | `1` | Reseeds all random values. |
| **Space** | Choice | **Global**, **UV** | **Global** | Pins noise to world space or letter coordinates. |
| **Animation speed** | Number | ≥ 0 | `0` | Advances Noise and Turbulence by `value / 100` units per 30 frames. |
| **Noise scale** | Number | ≥ 0 | `100` | Feature size of Noise and Turbulence. |
| **Min position**, **Max position** | 3D vector | — | `[-10, -10, -10]`, `[10, 10, 10]` | Translation range. |
| **Min rotation**, **Max rotation** | 3D vector | — | `[0, 0, 0]` | Rotation range in degrees. |
| **Min scale**, **Max scale** | 3D vector | — | `[1, 1, 1]` | Scale range. |

## Formula

Drives every letter from a single scalar expression.
Available variables: `px`, `py`, `pz` (base letter position); `rx`, `ry`, `rz` (incoming rotation); `sx`, `sy`, `sz` (incoming scale); `u`, `v`, `w` (normalized line position `0` to `1`); `id` (zero-based letter index); `count` (total letters); `falloff` (field weight); `t` (time in seconds after per-letter stagger); `f` (**Frequency**).
Trigonometric functions take degrees. Unknown names, empty input, and non-finite results evaluate to `0`.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Minimum**, **Maximum** | Number | — | `0`, `100` | Rescale bounds in percent. |
| **Expression** | Text | Text | `sin(u*360*f+t*90)` | Scalar expression evaluated per letter. |
| **Time** | Number | — | `1` | Multiplier on `t`. |
| **Frequency** | Number | — | `1` | Constant exposed as `f`. |
| **Position** | 3D vector | — | `[0, 10, 0]` | Position output multiplier. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Rotation output multiplier in degrees. |
| **Scale** | 3D vector | — | `[1, 1, 1]` | Scale output multiplier. |

## Delay

Makes each letter trail upstream animation or field sweeps. Static poses hold still.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Strength** | Number | `0` to `100` | `100` | Trail length from exact follow to full lag. |
| **Mode** | Choice | **Even**, **Blend**, **Spring** | **Even** | **Even** approaches linearly; **Blend** eases in fast then slows; **Spring** overshoots and settles. |
| **Position**, **Scale**, **Rotation** | Choice | **off**, **on** | **on** | Enables trailing on each transform channel. |

## Spline

Arranges letters along a built-in **Line**, **Circle**, or **Helix** path. Swapping **Start** and **End** flips direction.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Step**, **Falloff**, **Relative** | **Step** | Letter spacing along the path. |
| **Transform** | Choice | **Absolute**, **Relative** | **Absolute** | World-space path or path relative to letters. |
| **Path** | Choice | **Line**, **Circle**, **Helix** | **Line** | Built-in path shape. |
| **Length** | Number | ≥ 0 | `100` | Line length. |
| **Radius**, **End radius** | Number | ≥ 0 | `50`, `50` | Circle/helix start radius and helix far-end radius. |
| **Height**, **Turns** | Number | Height ≥ 0; Turns — | `100`, `1` | Helix height and revolutions. |
| **Plane** | Choice | **XY**, **XZ**, **YZ** | **XY** | Path plane. |
| **Tilt** | 3D vector | — | `[0, 0, 0]` | Path tilt in degrees. |
| **Reverse** | Choice | **off**, **on** | **off** | Reverses path direction. |
| **Offset** | Number | — | `0` | Shifts letters along the path. |
| **Start**, **End** | Number | — | `0`, `100` | Active path span in percent. |
| **Clamp** | Choice | **off**, **on** | **on** | Piles overflow at endpoints instead of wrapping around. |
| **Position**, **Rotation** | Choice | **off**, **on** | **on** | Follow path position and align rotation to tangent. |
| **Heading**, **Pitch**, **Bank** | Number | — | `0` | Added orientation angles in degrees. |

## Orbit, Repeater, Twist, Wrap, and Voronoi

### Orbit

Revolves selected letters rigidly around their combined center (a lone letter spins in place): **Angle** (3D vector in degrees, default `[0, 0, 0]`) and **Radius** (percent, default `100`; `0` gathers letters at the center).

### Repeater

Multiplies each letter into ghosts (hidden on unselected, weak, or disabled letters).

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **Linear**, **Random**, **Echo** | **Linear** | Ghost layout (**Echo** smears copies along motion by **Lag** frames). |
| **Copies** | Number | `0` to `64` | `3` | Ghosts per letter. |
| **Offset** | 3D vector | — | `[10, 0, 0]` | Linear step per copy. |
| **Min range**, **Max range** | 3D vector | — | `[-10, -10, -10]`, `[10, 10, 10]` | Random scatter bounds. |
| **Seed** | Number | — | `1` | Reseeds Random scatter. |
| **Lag** | Number | ≥ 0 | `2` | Echo smear in frames (still letters show no spread). |
| **Fade** | Number | `0` to `100` | `50` | Ghost opacity decay in percent. |

### Twist and Wrap

- **Twist:** Twirls each letter proportionally to its position along the line (middle holds still, ends counter-rotate; a lone letter holds still). Controls: **Angle** (degrees, default `0`) and **Axis** (**X**, **Y**, **Z**; default **Z**).
- **Wrap:** Applies a wave displacement across the run. Controls: **Amplitude** (default `0`), **Frequency** (≥ 0, default `1`), **Phase** (degrees, default `0`), and **Direction** (**X**, **Y**, **Z**; default **Y**).

### Voronoi

Shatters each selected letter into seeded fragments that explode outward and spin. The base letter hides once its chunks displace at full strength; toggle **Enable** off to show whole letters at any **Strength**.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Chunks** | Number | `1` to `64` | `8` | Fragment count per letter. |
| **Explode** | Number | — | `0` | Outward travel distance. |
| **Spin** | 3D vector | — | `[0, 0, 0]` | Fragment spin in degrees. |
| **Seed** | Number | — | `1` | Reseeds cell cuts. |
