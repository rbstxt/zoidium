# Effector+

A Zoidium `object` plugin. It adds the OpenZoid geometry deformers with
their original behavior preserved.

- Twist (type 7) — twists geometry around an axis with pivot and offset.
- Warp (type 8) — bends geometry with field-weighted falloff.
- Voronoi Fracture (type 9) — shatters geometry into cells.

The `effector-runtime` module evaluates the bundled deformer framework
(`PZ.object3d.deform`: mesh data, field weights, apply walk) plus the
three object classes through the plugin bundle asset API, teaches
`PZ.object3d.create` the deformer numeric types, and runs the deform
chain in the 3D Scene layer update. Picker entries are declared in the
manifest and owned by the plugin manager.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
