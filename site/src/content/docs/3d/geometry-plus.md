---
title: Geometry+
description: Add eight procedural 3D meshes (Rounded Box, Polyhedron, Cone, Capsule, Tube, Gear, Helix, and Spline) to a 3D Scene.
---
Use **Geometry+** to add eight procedural 3D meshes to any 3D Scene without importing external 3D models.

## Add a Geometry+ mesh

1. In **Plugins**, enable **Geometry+**.
2. Open the scene's **Objects** picker and choose a mesh under **GEOMETRY+**.
3. Edit the mesh's parameters in Properties.
4. Assign a material (see [Material+](/docs/3d/material-plus/) for PBR+ and Node Materials).

Use **Tube** for a hollow cylinder, or **Spline** for a swept 3D curve with up to 32 control points and optional thickness tapering.

## Mesh reference

Each object also keeps native **Position**, **Rotation**, **Scale**, **Rotation order**, and material controls. Numeric counts round to integers.
Across the tables: **Segments** subdivide profiles, **Radial segments** ring circumferences, **Path segments** step along paths, **Shading** picks **flat** or **smooth** normals, **End caps** (**closed** or **open**) toggles end faces, and **Bevel size** is capped by object dimensions.

### Rounded Box

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 3D vector | ≥ 0.1 | `[40, 24, 6]` | Width, height, and depth in object units. |
| **Corner radius** | Number | ≥ 0 | `3` | Corner radius (capped at half the width and height). |
| **Corner segments** | Number | `1` to `32` | `6` | Subdivisions around each corner. |
| **Bevel size** | Number | ≥ 0 | `0.6` | Bevel depth. |
| **Bevel segments** | Number | `0` to `8` | `2` | Bevel subdivisions. |

### Polyhedron

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Shape** | Choice | **tetrahedron**, **octahedron**, **icosahedron**, **dodecahedron** | **tetrahedron** | Base polyhedron family. |
| **Radius** | Number | ≥ 0.1 | `12` | Radius. |
| **Detail** | Number | `0` to `5` | `0` | Subdivision level. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |

### Cone

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Top radius** | Number | ≥ 0 | `0` | Radius at the top (`0` makes a pointed cone). |
| **Bottom radius** | Number | ≥ 0 | `16` | Radius at the bottom. |
| **Height** | Number | ≥ 0.1 | `32` | Height along the object axis. |
| **Segments** | Number | `3` to `64` | `24` | Radial subdivisions. |
| **End caps** | Choice | **closed**, **open** | **closed** | Toggles top and bottom faces. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |

### Capsule

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius** | Number | ≥ 0.1 | `8` | End-hemisphere and cylinder radius. |
| **Height** | Number | ≥ 0.1 | `32` | Total height. |
| **Segments** | Number | `2` to `32` | `8` | Cap profile subdivisions. |
| **Radial segments** | Number | `3` to `64` | `16` | Circumference subdivisions. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |

### Tube

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Outer radius** | Number | ≥ 0.1 | `12` | Outer radius. |
| **Inner radius** | Number | ≥ 0.01 | `8` | Inner hole radius (capped by outer radius). |
| **Height** | Number | ≥ 0.1 | `24` | Tube height. |
| **Radial segments** | Number | `3` to `64` | `24` | Circumference subdivisions. |
| **End caps** | Choice | **closed**, **open** | **closed** | Toggles end rings. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |

### Gear

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Teeth** | Number | `3` to `64` | `12` | Tooth count. |
| **Inner radius** | Number | ≥ 0.1 | `10` | Inner radius (capped by outer radius). |
| **Outer radius** | Number | ≥ 0.1 | `16` | Outer tooth radius. |
| **Thickness** | Number | ≥ 0.1 | `6` | Extrusion depth. |
| **Tooth width** | Number | `0.1` to `0.9` | `0.55` | Fraction of pitch occupied by each tooth. |
| **Bevel size** | Number | ≥ 0 | `0.3` | Bevel depth. |
| **Bevel segments** | Number | `0` to `8` | `2` | Bevel subdivisions. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |

### Helix

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius** | Number | ≥ 0.1 | `14` | Coil radius. |
| **Height** | Number | ≥ 0.1 | `32` | Total coil height. |
| **Turns** | Number | `0.25` to `32` | `3` | Number of coil revolutions. |
| **Tube radius** | Number | ≥ 0.05 | `2` | Cross-section radius. |
| **Path segments** | Number | `8` to `256` | `64` | Steps along the coil. |
| **Radial segments** | Number | `3` to `32` | `8` | Cross-section subdivisions. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |

### Spline

**Point 1** through **Point 32** are unbounded, animatable 3D vectors (active count set by **Points**). New splines start at `[-20, 0, 0]`, `[0, 20, 0]`, and `[20, 0, 0]`; additional points default to `[0, 0, 0]`.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Points** | Number | `2` to `32` | `3` | Active control-point count. |
| **Interpolation** | Choice | **Linear**, **Cubic**, **Akima**, **B-Spline** | **Cubic** | Curve interpolation model. |
| **Closed** | Choice | **off**, **on** | **off** | Connects the last point back to the first. |
| **Start**, **End** | Number | `0` to `1` | `0`, `1` | Trims the visible curve range. |
| **Thickness** | Number | ≥ 0 | `2` | Base tube radius. |
| **Thickness map** | Gradient | Editable stops | White | Scales thickness along the curve using the gradient's red channel and alpha. |
| **Gradient space** | Choice | **Curve**, **Trimmed** | **Curve** | Maps **Thickness map** over the full curve or trimmed span. |
| **Tension** | Number | `0` to `2` | `1` | Cubic spline tension. |
| **Path segments** | Number | `1` to `256` | `16` | Steps along the curve. |
| **Radial segments** | Number | `3` to `32` | `8` | Cross-section subdivisions. |
| **Caps** | Choice | **None**, **Both**, **Start**, **End** | **Both** | Which ends get caps. |
| **Cap style** | Choice | **Flat**, **Round** | **Flat** | Flat or rounded end caps. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Normal shading mode. |
