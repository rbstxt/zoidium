# Effector

Effector is the Zoidium 3D object plugin for procedural scene copies and mesh
deformation. It keeps the published `zoidium:repeater/*` object namespace so
existing Repeater projects continue to load.

It provides:

- Repeater, Linear Repeater, Random Repeater, and Echo Repeater;
- Twist, which rotates descendant mesh positions around a selected axis;
- Warp, which bends descendant mesh positions with optional linear, box, or
  spherical falloff.

Twist and Warp expose the normal group `Properties` controls for visibility,
position, rotation, scale, and rotation order. Their `Curve quality` dropdown
offers `Low polygon` for the original mesh density or `Smooth` for triangle
subdivision before deformation. `Polygons per triangle` directly controls the
number of generated triangles for each source triangle (1–256), and Smooth is
the default for new effectors. Twist also treats offset-only changes as a
cached uniform rotation when possible, avoiding a full per-vertex twist
recalculation.

Effector applies deformation after the CM3 scene objects update and restores
the original mesh positions before evaluating each frame. Repeater output
meshes are treated as generated render output, so nested Repeater and Effector
objects do not deform hidden source templates.

The implementation is an external Zoidium extension layer around CM3. It does
not replace or copy the CM3 runtime.
