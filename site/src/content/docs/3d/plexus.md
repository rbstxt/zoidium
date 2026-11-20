---
title: Plexus
description: Connect 3D point clouds from primitives, images, paths, or OBJ files with lines, facets, triangulation, and audio-reactive effectors.
---
Use **Plexus** (inside **Rowbyte & Red Giant Suite**) to generate a 3D point cloud, deform it with effectors, and connect nearby points with points, lines, facets, triangulation, or beams.

## Add Plexus

1. In **Plugins**, enable **Rowbyte & Red Giant Suite**.
2. Open the scene's **Objects** picker and choose **Plexus**.
3. Open its designer window or edit **Geometry**, **Effector**, and **Renderer** in Properties.

A dash (`—`) in the tables below means no declared minimum or maximum.

## Object

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Choice | **off**, **on** | **on** | Enables this block. |

## Geometry

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Geometry type** | Choice | **layers**, **paths**, **obj**, **primitives**, **instances**, **slicer** | **instances** | Source of the point cloud. |
| **Primitive** | Choice | **box**, **sphere**, **cylinder**, **plane**, **ring** | **box** | Shape of generated primitive points. |
| **Count** | Number | `0` to `60000` | `200` | Requested generated point count. |
| **Size** | 3D vector | ≥ 0 | `[500, 500, 500]` | Dimensions of the point cloud. |
| **Position** | 3D vector | — | `[0, 0, 0]` | Position in scene units. |
| **Path turns** | Number | `0` to `10` | `3` | Turns of the procedural path source. |
| **Layer** | Asset | `image/*` | None | Image source for points. |
| **OBJ file** | Asset | `.obj` | None | Imported OBJ point geometry. |
| **Random seed** | Number | — | `0` | Seed for repeatable random values. |

## Effector

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Effector type** | Choice | **noise**, **spherical field**, **container**, **transform**, **color map**, **shade**, **sound** | **noise** | Operation applied to source points. |
| **Amount** | Number | — | `100` | Overall effector strength. |
| **Noise amount** | Number | — | `40` | Noise displacement amplitude. |
| **Noise scale** | Number | ≥ 0.0001 | `1` | Spatial scale of noise. |
| **Strength[%]** | Number | — | `50` | Spherical field strength in percent. |
| **Radius** | Number | ≥ 0 | `300` | Spherical field radius. |
| **Position** | 3D vector | — | `[0, 0, 0]` | Position in scene units. |
| **Container size** | 3D vector | ≥ 0 | `[500, 500, 500]` | Dimensions of the point container. |
| **Transform scale** | Number | — | `100` | Point-cloud scale in percent. |
| **Transform rotation** | 3D vector | — | `[0, 0, 0]` | Point-cloud rotation in degrees. |
| **Color map by** | Choice | **index**, **height**, **distance** | **index** | Coordinate used to blend **Color** and **Color 2**. |
| **Color**, **Color 2** | RGB color | `0` to `1` | `[1, 1, 1]`, `[0, 0.3, 1]` | First and second point colors. |
| **Audio layer** | Asset | `audio/*`, `video/*` | None | Audio or video asset for offline audio analysis. |
| **Audio offset (seconds)** | Number | ≥ 0 | `0` | Delay of the audio analysis window in seconds. |
| **Audio trim in (seconds)** | Number | ≥ 0 | `0` | Start media time in seconds. |
| **Audio trim out (seconds)** | Number | ≥ 0 | `0` | End media time in seconds (`0` uses the available end). |
| **Sound strength** | Number | ≥ 0 | `100` | Sound effector strength. |

## Renderer

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Renderer type** | Choice | **points**, **lines**, **facets**, **triangulation**, **beams** | **lines** | Drawing mode. |
| **Point size** | Number | `0` to `10` | `4` | Point size. |
| **Line type** | Choice | **distance**, **adjacency**, **shape** | **distance** | Connectivity rule. |
| **Max distance** | Number | ≥ 0 | `200` | Max distance between connected points. |
| **Max connections** | Number | `0` to `10` | `5` | Max connections per point. |
| **Opacity** | Number | `0` to `100` | `80` | Opacity in percent. |
| **Ambient**, **Diffuse**, **Specular** | Number | `0` to `100` | `25`, `75`, `0` | Lighting contributions in percent. |
| **Color** | RGB color | `0` to `1` | `[1, 1, 1]` | Base RGB color. |

## Evaluation and limits

- **Lines** connect at most `12,000` points. **Facets** and **triangulation** use at most `4,000` mesh points and `20,000` triangles.
- Imported geometry rejects files over `16` MiB or more than `500,000` vertices.
- Without an **Audio layer**, the **sound** effector follows a built-in time wave; with an asset, it analyzes audio inside the offset and trim window.

Related suite tools: [Trapcode Particular](/docs/3d/trapcode-particular/), [Trapcode Form](/docs/3d/trapcode-form/), and [Lights](/docs/3d/lights/).
