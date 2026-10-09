# Camera+

A Zoidium `extension` plugin. It ports the OpenZoid camera system with
original behavior preserved.

- C4D camera object — film system (projection, focal length, film gates,
  equivalent focal length, field of view, zoom, film offsets), camera
  vibrate, and depth-of-field properties (aperture, focus distance with
  Link/Set/Unlink buttons, focus area, near/far blur).
- Camera layers (type 9) — dedicated tracking-only layers whose camera
  drives every 3D-enabled scene through the shared camera.
- Shared-camera 3D tracking — scenes borrow the master camera, flat video
  layers follow through Transform effects or tracked-video rectangles,
  with 3D-card awareness and per-frame parallax without 1-frame lag.
- Depth of field — per-object SceneDof pass driven by the active camera,
  wired through the render pass. DOF lives on camera objects only: the
  sequence carries no DOF controls, and the global pass reads on/off,
  aperture, focus distance, and clip range from the shared (Camera layer)
  camera. With no master camera, or its DOF off, each scene falls back to
  its own camera-driven pass. Motion-blur track frames are unchanged.
- Focus tools — focus target menu, focusDistanceTo expression method, and
  the focus property-button actions.
- 3D toggle — track headers gain the 3D switch that bootstraps the
  Transform follow for the current clip.

The `camera-runtime` module evaluates the bundled sources through the
plugin bundle asset API and chains every patch with save-and-restore
semantics, so disabling the pack removes its classes, methods, and UI.

Known limitations (later phases):

- Opening a project that uses Camera layers or camera DOF without the
  pack enabled records the dependency and prompts to enable it; loading
  such data with the pack disabled still fails, as with any unknown
  numeric type in vanilla CM3.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
