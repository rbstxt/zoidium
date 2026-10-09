# Optical Flares

A Zoidium `object` plugin. It adds the OpenZoid Optical Flares 3D object
with its original behavior preserved.

- Optical Flares (type 13) — screen-space lens flare stack with 12 element
  types (Glow, Streak, Iris, Multi Iris, Shimmer, Glint, Spike Ball,
  Sparkle, Ring, Hoop, Caustic, Orbs), up to 24 elements, light tracking,
  positioning modes, flicker, and motion blur. Ships with five presets:
  Default, Anamorphic Blue, Sparkle Burst, Cinematic Warm, Sci-Fi Plasma.
- Options window — Preview, Stack, Editor, and Browser panels through
  `PZ.opticalflares.open(root, designer)` and the object-panel gear button
  (installed by the Rowbyte & Red Giant Suite pack). The window shares the
  SaaS theme of the Legacy setup editors (Inter type, silk backdrop, blue
  flare accents, pill controls) with a bundled Inter variable font the
  runtime installs on enable. Registers itself with
  the Trapcode designer when that pack is (or becomes) available, whatever
  order the packs are enabled in.

The `optical-flares-runtime` module evaluates the bundled sources in
dependency order through the plugin bundle asset API, so enabling the pack
never fans out into runtime fetches, and teaches `PZ.object3d.create` the
Optical Flares numeric type. The picker entry is declared in the manifest
and owned by the plugin manager: disabling the pack removes it. The
create wrapper survives out-of-order disables against sibling packs.

Works with or without Trapcode Suite (shared helpers are bundled in both).

Known limitations (later phases):

- Projects that use Optical Flares record a plugin dependency and prompt
  to enable this pack; loading such data with the pack disabled still
  fails, as with any unknown numeric type in vanilla CM3.
- Object-panel gear wiring for the Options window lives in the Rowbyte &
  Red Giant Suite pack; enable it alongside this pack for the gear button.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
