---
title: Effector
description: Repeat, twist, bend, shear, fracture, transform, and delay 3D object hierarchies with Effector and Effector+ compatibility.
---
Use **Effector** (enabled by default) to make procedural copies or deform 3D objects placed inside its hierarchy. Top-level siblings outside the effector are not affected.

## Set up effectors

### Repeat source children

1. Open the scene's 3D object picker and choose **Effector > Repeater**, **Linear Repeater**, **Radial Repeater**, **Grid Repeater**, **Random Repeater**, or **Echo Repeater**.
2. Click **+** on the repeater's row to add a source object as its child.
3. In the **Repeater** section, set **Count** (`1` to `128`, or **Count X**, **Count Y**, and **Count Z** on **Grid Repeater**) and adjust the placement controls to separate copies.

Use **Linear Repeater** to distribute copies between start and end transforms, **Radial Repeater** to place copies on a circle, **Grid Repeater** to fill a three-axis grid, **Random Repeater** to scatter copies inside seeded ranges, and **Echo Repeater** to evaluate copies at earlier frames.

### Deform a mesh with Twist, Warp, or Shear

1. Add **Effector > Twist**, **Effector > Warp**, or **Effector > Shear** and place your mesh inside it.
2. Adjust **Axis** and **Angle** on **Twist**, **Axis** and **Strength** on **Warp**, or **Axis**, **Direction**, **Amount**, and **Pivot** on **Shear**.
3. To limit the deformation to a region, change **Field** from **infinite** to **linear**, **box**, **sphere**, **cylinder**, or **noise**, then tune **Field position**, **Field rotation**, **Field scale**, and **Falloff**.
4. Increase **Subdivision** if the deformation needs smoother geometry (within the 400,000-triangle budget).

The effector's own transform sets its local axis and field frame.

### Edit a field in the viewport

1. Select one effector while the 3D editing camera is active.
2. Beside **Field position**, turn on **Edit field in viewport**.
3. Drag to move the field on the camera plane, Shift-drag around its center to rotate, or Alt-drag right or up to scale uniformly.
4. Press Escape to cancel a drag or leave viewport field editing (changing selection or exiting the editing camera also exits).

Field and falloff guides display for **linear**, **box**, **sphere**, and **cylinder** fields (**infinite** and **noise** have no boundary guide). Guides never appear in exports.

### Break a mesh into fragments with Voronoi Fracture

1. Add **Effector > Voronoi Fracture** and place a closed mesh inside it (check the 160,000-source / 1,600,000-output triangle limits first on dense meshes).
2. Set **Cells**, **Seed**, and **Distribution**, and keep **Inner faces** at **closed** for capped cuts.
3. Animate **Distance**, **Scatter**, or **Spin** to separate fragments, or use **Field > linear** and animate **Sweep** to reveal motion across the mesh.
4. For 3D Text selection (requires **Text+**), enter one-based ranges such as `1,3-5` in **Characters** and optionally turn on **Invert selection**.

### Delay upstream motion with Plain and Delay

1. Add **Effector > Plain**, add **Delay** as a child of **Plain**, and place your source object inside **Delay**.
2. Animate **Plain**'s **Position offset**, **Rotation offset**, or **Scale offset**.
3. On **Delay**, choose **Mode** (**Blend**, **Average**, or **Spring**) and adjust **Strength** and **History frames**.
4. For stronger spring bounce: set **Mode** to **Spring**, set **Strength** to `100`, lower **Spring damping** for deeper overshoot, raise **History frames** for a longer tail, and raise **Spring cycles** for more oscillations.

## Object types and property reference

| Picker name | Purpose |
| --- | --- |
| **Repeater** | Copies sources by a fixed transform step. |
| **Linear Repeater** | Distributes copies between first and last transforms. |
| **Radial Repeater** | Places copies around a circle. |
| **Grid Repeater** | Places copies in a three-axis grid. |
| **Random Repeater** | Copies sources with seeded random transforms inside ranges. |
| **Echo Repeater** | Evaluates copies at explicitly sampled earlier frames. |
| **Twist** | Twists descendant meshes around a local axis. |
| **Warp** | Bends descendant meshes in the effector frame. |
| **Shear** | Offsets descendant meshes along a direction in proportion to distance along an axis. |
| **Voronoi Fracture** | Splits descendant meshes into rigid seeded Voronoi pieces. |
| **Plain** | Applies field-weighted transforms to connected pieces, text characters, or upstream fracture pieces. |
| **Delay** | Filters upstream motion through earlier-frame samples. |

### Repeaters

**Count** accepts `1` to `128` copies. It defaults to `8` on **Radial Repeater** and `5` on the other single-count repeaters. Scale controls have a minimum of `0.001` per axis, and rotations use degrees.

| Type | Controls | Meaning and defaults |
| --- | --- | --- |
| **Repeater** | **Position**, **Rotation**, **Scale** | Per-copy step. Position `[10, 0, 0]`, Scale `[1, 1, 1]`. |
| **Linear Repeater** | **Position**, **Rotation**, **Scale** | Last copy relative to first. Position `[40, 0, 0]`, Rotation `[0, 0, 90]`. |
| **Radial Repeater** | **Count**, **Radius**, **Plane**, **Start angle**, **Sweep**, **Align to circle**, **Rotation step**, **Scale end** | Copies on a circle. **Count** `8`, **Radius** `100` (min `0`), **Plane** **XY**, **XZ** (default), or **YZ**, **Start angle** `0`, **Sweep** `360` (`0` to `720`), **Align to circle** **off**, **Rotation step** `[0, 0, 0]`, **Scale end** `[1, 1, 1]`. |
| **Grid Repeater** | **Count X**, **Count Y**, **Count Z**, **Spacing**, **Centered** | Three-axis grid. **Count X** `3`, **Count Y** `3`, **Count Z** `1` (each `1` to `128`), **Spacing** `[50, 50, 50]`, **Centered** **on**. |
| **Random Repeater** | **Min/Max position**, **Min/Max rotation**, **Min/Max scale**, **Seed** | Seeded ranges. **Seed** defaults to `1`. |
| **Echo Repeater** | **Offset** | Earlier-time spacing per copy in frames (`0` to `100000`, default `5`). |

- **Radial Repeater spacing and orientation:** When **Sweep** is `360` degrees, the circle divides by **Count**, so the last copy stops one step before the first instead of overlapping it. For any other **Sweep**, the arc divides by `Count - 1` and places copies on both ends. **Align to circle** turns each copy around the circle normal by its angle on the circle. **Rotation step** adds a fixed rotation per copy index, and **Scale end** interpolates scale from `[1, 1, 1]` at the first copy to **Scale end** at the last.
- **Grid Repeater order and cap:** Copies fill X first, then Y, then Z. **Centered** places the grid symmetrically around the repeater origin instead of starting at the first cell. Total copies (`Count X × Count Y × Count Z`) cap at `128`.
- **Clone-position points:** While one repeater is selected, the 3D editing view shows a small blue point at each copy's position. The points follow the repeater transform and ignore effectors. They use the editor helper layer, so they never appear in renders, previews, or exports. Deselecting the repeater hides the points.

### Twist, Warp, Shear, and subdivision

- **Twist:** **Axis** (**X**, **Y**, **Z**; default **Y**), **Angle** (`-1440` to `1440` degrees, default `0`), **Offset** (pivot along axis).
- **Warp:** **Axis** (**X**, **Z**; default **X**), **Strength** (`-720` to `720` degrees, default `0`), **Offset** (bend pivot).
- **Shear:** **Axis** (**X**, **Y**, **Z**; default **Y**), **Direction** (**X**, **Y**, **Z**; default **X**), **Amount** (`-10` to `10`, default `0`), **Pivot** (`[0, 0, 0]` in effector space). Each vertex moves along **Direction** by **Amount** times its signed distance from **Pivot** along **Axis**, scaled by the field weight. **Amount** is the offset per unit of distance along **Axis**. A value of `1` shifts a point by its full distance from **Pivot** (a 45-degree shear), `0` leaves the mesh unchanged, and negative values reverse the offset. When **Direction** matches **Axis**, the mesh stretches along that axis. **Shear** uses the shared field properties below. Because **Shear** moves vertices rather than rigid pieces, **Delay** filters it with the vertex filter, the same as **Twist** and **Warp**.
- **Subdivision:** `1`, `2`, `4` (default), `8`, or `16` edge segments. Budget is `400,000` triangles per mesh; subdivision steps down by whole levels to stay within budget (and never simplifies a source already over the cap).

### Fields

Shared by **Twist**, **Warp**, **Shear**, **Voronoi Fracture**, and **Plain**:

| Control | Meaning and default |
| --- | --- |
| **Field** | **infinite** (default), **linear**, **box**, **sphere**, **cylinder** (aligned to field Y), or **noise**. |
| **Field position** | Offset in effector space, default `[0, 0, 0]`. |
| **Field rotation** | XYZ Euler degrees, default `[0, 0, 0]`. |
| **Field scale** | Percentage of undeformed input extent, default `[100, 100, 100]` (min `0.01` per axis). |
| **Falloff** | Soft transition width (`0` to `100`, default `100`; `0` is a hard edge). |
| **Falloff curve** | **linear** (default), **smooth**, **ease in**, or **ease out**. |
| **Invert field** | Inverts field weight (default **off**). |
| **Sweep** | Linear field progress (`0` to `100`). |
| **Noise scale** | Wavelength relative to field scale (`0.01` to `10000`, default `100`). |
| **Noise evolution** | Continuous seeded-noise offset, default `0`. |

### Voronoi Fracture

| Controls | Meaning and limits |
| --- | --- |
| **Cells**, **Seed** | `1` to `1000` cells (default `24`); **Seed** default `1`. |
| **Distribution**, **Cell scale** | **uniform**, **surface**, **center**, or **edges**. **Cell scale** defaults to `[100, 100, 100]`. |
| **Inner faces** | **open** or **closed** (default **closed**). Open source borders are not capped. |
| **Fragment colors** | **material** or **random** (default **random**, seeded). |
| **Offset fragments** | Fragment gap (`0` to `100`, default `0`). |
| **Distance**, **Scatter**, **Spin** | Fragment travel and spin (defaults `0`; Distance and Scatter `-1000` to `1000`; Spin `-3600` to `3600` degrees). |
| **Direction**, **Rotation**, **Fragment scale** | Extra translation (`[0, 0, 0]`), XYZ rotation (`[0, 0, 0]` deg), and scale % (`100`). At full field strength, **Fragment scale** reaches the target independently of **Randomness** (`0` collapses each fragment's vertices to one point). |
| **Gravity**, **Randomness** | Gravity pushes along effector `-Y`; **Randomness** (`0` to `100`) attenuates motion per piece. Both default `0`. |
| **Characters**, **Invert selection** | One-based text ranges such as `1,3-5` (requires **Text+**; spaces count, newlines do not; empty selects all; invalid nonempty selects none; **Invert selection** keeps empty as all). |

- **Limits and updates:** Max `160,000` source triangles and `1,600,000` output triangles (exceeding either leaves the mesh unbroken). Opaque pieces overlap in hierarchy order at equal depth; transparent materials keep normal sorting. After changing **Cells**, **Seed**, or source geometry, preview holds the last frame with **Fracturing...** until ready; scrubbing, **Render once**, and exports wait for the exact frame. Evaluation failures fall back to the unbroken source with a warning.

### Plain and Delay

**Plain** exposes **Position offset**, **Rotation offset** (degrees), **Scale offset** (`0` unchanged, `1` doubles axis), and **Uniform scale** (all default `0`).

| Delay control | Meaning and default |
| --- | --- |
| **Mode** | **Blend** (default, exponential), **Average** (equal weights), or **Spring** (damped oscillation). |
| **Strength** | Blend with filtered result (`0` to `100`, default `75`). |
| **History frames** | Earlier 1-frame samples (`1` to `120`, default `12`). |
| **Spring damping** | Spring decay rate (`0.25` to `12`, default `3`; lower overshoots more). **Spring** only. |
| **Spring cycles** | Oscillations across **History frames** (`0.25` to `8`, default `1`). **Spring** only. |

Spring overshoot after a step at **Strength** `100`, **Spring cycles** `1`, and `48` **History frames**: damping `3` -> 29%, `2` -> 58%, `1` -> 154%, `0.5` -> 352%, `0.25` -> 751%. **Spring** has no effect when its weights cancel (such as `1` or `2` **History frames** with **Spring cycles** `1`).

Nested **Delay** histories share a per-mesh budget of `96` samples, or `4 ×` the largest **History frames** if higher; samples with mismatched fracture topology are skipped.
Builds older than Effector v42 ignore **Spring damping** and **Spring cycles** and cap **History frames** evaluation at `24` (re-saving there drops those two Spring controls).

### Legacy Effector+ projects

Enable **Effector+** in **Plugins** only if you need to open older Effector+ projects that stored Twist, Warp, and Voronoi Fracture under numeric types 7, 8, and 9. It adds no picker entries and delegates directly to **Effector**.
