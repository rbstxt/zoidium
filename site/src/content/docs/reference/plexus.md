---
title: Plexus properties
description: Plexus controls, ranges, defaults, audio behavior, and evaluation limits.
sidebar:
  label: Plexus
---
Plexus is a suite object with properties in its designer and property panel. A — range means no declared minimum or maximum.


## Object

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Choice | **off**, **on** | **on** | Enables this block. |


## Geometry

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Geometry type** | Choice | **layers**, **paths**, **obj**, **primitives**, **instances**, **slicer** | **instances** | Source of the point cloud. |
| **Primitive** | Choice | **box**, **sphere**, **cylinder**, **plane**, **ring** | **box** | Shape of generated primitive points. |
| **Count** | Number | 0 to 60000 | `200` | Requested number of generated points. |
| **Size** | 3D vector | ≥ 0 | `[500, 500, 500]` | Dimensions of the generated point cloud. |
| **Position** | 3D vector | — | `[0, 0, 0]` | Position in scene units. |
| **Path turns** | Number | 0 to 10 | `3` | Turns of the procedural path source. |
| **Layer** | Asset | image/* | None | Image source for points. |
| **OBJ file** | Asset | .obj | None | Imported point geometry. |
| **Random seed** | Number | — | `0` | Seed for repeatable random values. |


## Effector

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Effector type** | Choice | **noise**, **spherical field**, **container**, **transform**, **color map**, **shade**, **sound** | **noise** | Operation applied to source points. |
| **Amount** | Number | — | `100` | Overall effector amount. |
| **Noise amount** | Number | — | `40` | Noise displacement amplitude. |
| **Noise scale** | Number | ≥ 0.0001 | `1` | Spatial scale of noise. |
| **Strength[%]** | Number | — | `50` | Strength of the spherical field in percent. |
| **Radius** | Number | ≥ 0 | `300` | Radius of the spherical field. |
| **Position** | 3D vector | — | `[0, 0, 0]` | Position in scene units. |
| **Container size** | 3D vector | ≥ 0 | `[500, 500, 500]` | Dimensions of the point container. |
| **Transform scale** | Number | — | `100` | Point-cloud scale in percent. |
| **Transform rotation** | 3D vector | — | `[0, 0, 0]` | Point-cloud rotation in degrees. |
| **Color map by** | Choice | **index**, **height**, **distance** | **index** | Coordinate used to blend Color and Color 2. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Base RGB color. |
| **Color 2** | RGB color | 0 to 1 | `[0, 0.3, 1]` | Second point color. |
| **Audio layer** | Asset | audio/*,video/* | None | Audio or video asset for offline audio analysis. |
| **Audio offset (seconds)** | Number | ≥ 0 | `0` | Delay of the reactor's audio window in seconds. |
| **Audio trim in (seconds)** | Number | ≥ 0 | `0` | First media time in seconds. |
| **Audio trim out (seconds)** | Number | ≥ 0 | `0` | Last media time in seconds. Zero uses the available end. |
| **Sound strength** | Number | ≥ 0 | `100` | Strength of the sound effector. |


## Renderer

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Renderer type** | Choice | **points**, **lines**, **facets**, **triangulation**, **beams** | **lines** | Point, line, facet, triangulation, or beam rendering. |
| **Point size** | Number | 0 to 10 | `4` | Point size. |
| **Line type** | Choice | **distance**, **adjacency**, **shape** | **distance** | Distance, adjacency, or shape connectivity. |
| **Max distance** | Number | ≥ 0 | `200` | Maximum distance between connected points. |
| **Max connections** | Number | 0 to 10 | `5` | Maximum connections considered per point. |
| **Opacity** | Number | 0 to 100 | `80` | Particle opacity in percent. |
| **Ambient** | Number | 0 to 100 | `25` | Ambient shading contribution in percent. |
| **Diffuse** | Number | 0 to 100 | `75` | Diffuse shading contribution in percent. |
| **Specular** | Number | 0 to 100 | `0` | Specular lighting contribution. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Base RGB color. |


## Evaluation and limits

Lines use at most 12,000 link points. Facets and triangulation use at most 4,000 mesh points and 20,000 triangles. Geometry input rejects text over 16 MiB or more than 500,000 vertices.

Without an Audio layer, the Sound effector follows a built-in time-based wave. With an asset, it follows the audio in the offset and trim window.

[Add suite objects and lights](/docs/features/trapcode-suite/)
