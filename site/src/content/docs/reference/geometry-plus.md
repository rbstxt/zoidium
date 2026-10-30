---
title: Geometry+ properties
description: Defaults, ranges, and output behavior for all eight procedural mesh types.
sidebar:
  label: Geometry+ reference
---
Geometry+ adds eight procedural mesh types. Geometry properties below are separate from the native object controls **Position**, **Rotation**, **Scale**, **Rotation order**, and material.


## Rounded Box

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 3D vector | ≥ 0.1 | `[40, 24, 6]` | Width, height, and depth in object units. |
| **Corner radius** | Number | ≥ 0 | `3` | Radius of rounded corners, capped by half the width and height. |
| **Corner segments** | Number | 1 to 32 | `6` | Subdivisions around each corner. |
| **Bevel size** | Number | ≥ 0 | `0.6` | Bevel thickness and width, limited by object dimensions. |
| **Bevel segments** | Number | 0 to 8 | `2` | Subdivisions across the bevel. |


## Polyhedron

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Shape** | Choice | **tetrahedron**, **octahedron**, **icosahedron**, **dodecahedron** | **tetrahedron** | Polyhedron family. |
| **Radius** | Number | ≥ 0.1 | `12` | Radius of the generated geometry. |
| **Detail** | Number | 0 to 5 | `0` | Polyhedron subdivision level. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Cone

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Top radius** | Number | ≥ 0 | `0` | Cone radius at the top. |
| **Bottom radius** | Number | ≥ 0 | `16` | Cone radius at the bottom. |
| **Height** | Number | ≥ 0.1 | `32` | Height along the object's axis. |
| **Segments** | Number | 3 to 64 | `24` | Longitudinal or profile subdivision count. |
| **End caps** | Choice | **closed**, **open** | **closed** | Includes the end faces. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Capsule

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius** | Number | ≥ 0.1 | `8` | Radius of the generated geometry. |
| **Height** | Number | ≥ 0.1 | `32` | Height along the object's axis. |
| **Segments** | Number | 2 to 32 | `8` | Longitudinal or profile subdivision count. |
| **Radial segments** | Number | 3 to 64 | `16` | Segments around the circumference. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Tube

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Outer radius** | Number | ≥ 0.1 | `12` | Outer radius. |
| **Inner radius** | Number | ≥ 0.01 | `8` | Inner radius, limited by the outer radius. |
| **Height** | Number | ≥ 0.1 | `24` | Height along the object's axis. |
| **Radial segments** | Number | 3 to 64 | `24` | Segments around the circumference. |
| **End caps** | Choice | **closed**, **open** | **closed** | Includes the end faces. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Gear

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Teeth** | Number | 3 to 64 | `12` | Rounded integer tooth count. |
| **Inner radius** | Number | ≥ 0.1 | `10` | Inner radius, limited by the outer radius. |
| **Outer radius** | Number | ≥ 0.1 | `16` | Outer radius. |
| **Thickness** | Number | ≥ 0.1 | `6` | Extrusion depth or spline tube radius. |
| **Tooth width** | Number | 0.1 to 0.9 | `0.55` | Fraction of each gear pitch occupied by a tooth. |
| **Bevel size** | Number | ≥ 0 | `0.3` | Bevel thickness and width, limited by object dimensions. |
| **Bevel segments** | Number | 0 to 8 | `2` | Subdivisions across the bevel. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Helix

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius** | Number | ≥ 0.1 | `14` | Radius of the generated geometry. |
| **Height** | Number | ≥ 0.1 | `32` | Height along the object's axis. |
| **Turns** | Number | 0.25 to 32 | `3` | Number of helix turns. |
| **Tube radius** | Number | ≥ 0.05 | `2` | Radius of the helix tube. |
| **Path segments** | Number | 8 to 256 | `64` | Samples along the path. |
| **Radial segments** | Number | 3 to 32 | `8` | Segments around the circumference. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Spline

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Points** | Number | 2 to 32 | `3` | Number of spline control points. |
| **Interpolation** | Choice | **Linear**, **Cubic**, **Akima**, **B-Spline** | **Cubic** | Spline interpolation model. |
| **Closed** | Choice | **off**, **on** | **off** | Connects the end of the spline to its start. |
| **Start** | Number | 0 to 1 | `0` | Normalized start of the visible spline. |
| **End** | Number | 0 to 1 | `1` | Normalized end of the visible spline. |
| **Thickness** | Number | ≥ 0 | `2` | Extrusion depth or spline tube radius. |
| **Thickness map** | Gradient | Editable stops | White | Gradient red channel multiplied by alpha scales tube thickness. |
| **Gradient space** | Choice | **Curve**, **Trimmed** | **Curve** | Samples thickness over the full curve or trimmed interval. |
| **Tension** | Number | 0 to 2 | `1` | Tension for cubic spline interpolation. |
| **Path segments** | Number | 1 to 256 | `16` | Samples along the path. |
| **Radial segments** | Number | 3 to 32 | `8` | Segments around the circumference. |
| **Caps** | Choice | **None**, **Both**, **Start**, **End** | **Both** | Ends that receive caps. |
| **Cap style** | Choice | **Flat**, **Round** | **Flat** | Flat or rounded spline caps. |
| **Shading** | Choice | **flat**, **smooth** | **flat** | Flat or smooth vertex normals. |


## Spline points and evaluation

**Point 1** through **Point 32** are animated 3D vectors with no declared numeric bounds. The active count comes from **Points**. New splines start at `[-20, 0, 0]`, `[0, 20, 0]`, and `[20, 0, 0]`. Additional points default to `[0, 0, 0]`.

Numeric counts round to integers. Source dimensions and radii can impose tighter limits than the listed ranges.

[Add Geometry+ objects](/docs/features/geometry-plus/)
