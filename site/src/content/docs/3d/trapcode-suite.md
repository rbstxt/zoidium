---
title: Trapcode Suite
description: Choose between Trapcode Particular, Trapcode Form, Plexus, and Trapcode Lights, hide 3D objects, and import photometric IES light files.
---
**Rowbyte & Red Giant Suite** adds particle systems, point networks, and extended lights to 3D Scenes.

## Choose a suite tool

Enable **Rowbyte & Red Giant Suite** in **Plugins**, then open the scene's **Objects** picker to add an object.

| Tool | Use it for | Guide and controls |
| --- | --- | --- |
| **Trapcode Particular** | Emitter-based particle systems with physics, fields, and audio reactors. | [Trapcode Particular](/docs/3d/trapcode-particular/) |
| **Trapcode Form** | Deformable 3D particle lattices, strings, fractal fields, and layer maps. | [Trapcode Form](/docs/3d/trapcode-form/) |
| **Plexus** | Connecting source points with points, lines, facets, triangulation, or beams. | [Plexus](/docs/3d/plexus/) |
| **Trapcode Lights** | Extended 3D lights including Area, Sun, Portal, and Photometric IES lights. | [Lights](/docs/3d/lights/) |

Choose **Particular** for an emitter-based particle system. Choose **Form** for a particle lattice. Choose **Plexus** to connect source points with lines or facets.

### Add a suite object

1. In **Plugins**, enable **Rowbyte & Red Giant Suite**.
2. Open the scene's **Objects** picker.
3. Choose **Trapcode Particular**, **Trapcode Form**, or **Plexus**.
4. Open the object's designer window or edit its native parameters in Properties.
5. Inspect the result in the viewport.

## Import photometric IES lights

1. Open **Trapcode Lights** in the scene's **Objects** picker.
2. Choose **Photometric IES Light**.
3. In **IES File**, select a local LM-63 Type C `.ies` file with `TILT=NONE`.

Unsupported files leave the previous profile unchanged. For all eight suite light types and controls, see [Lights](/docs/3d/lights/).

## Hide a 3D object

Set **Enabled** to **off** in the object properties to hide a 3D object and skip its update and preparation. Add keyframes to change **Enabled** over time.

When **Trapcode Particular** is enabled again, it evaluates the requested frame. Cameras do not have **Enabled** yet; switch to a different camera or use Camera+ **Active Camera** instead.
