---
title: Add Trapcode-style objects
sidebar:
  label: Trapcode-style objects and lights
---
Add a particle system, point network, or light to a 3D Scene.

1. Enable **Rowbyte & Red Giant Suite** in Plugins.
2. Open the scene's **Objects** picker.
3. Choose **Trapcode Particular**, **Trapcode Form**, or **Plexus**.
4. Open the object's designer.
5. Edit its native parameters.
6. Inspect the result in the normal viewport.

Choose Particular for an emitter-based particle system. Choose Form for a
particle lattice. Choose Plexus to connect source points with lines or facets.

For suite lights, open **Trapcode Lights** in the picker. To import photometry,
choose Photometric IES and select a local LM-63 Type C file with TILT=NONE.

[Suite source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/trapcode-suite/README.md)
describes deterministic motion, audio analysis, light behavior, and limits.

Control reference: [trapcode-particular](/docs/reference/trapcode-particular/), [trapcode-form](/docs/reference/trapcode-form/), [plexus](/docs/reference/plexus/), [trapcode-lights](/docs/reference/trapcode-lights/).
