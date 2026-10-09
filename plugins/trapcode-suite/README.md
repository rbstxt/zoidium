# Rowbyte & Red Giant Suite

A Zoidium `object` plugin. It adds the OpenZoid Trapcode 3D objects with
their original behavior preserved, plus C4D-style lights.

- Trapcode Particular (type 10) — full 3D particle system with emitter,
  physics, fields, layer maps, audio reactors, and per-system presets
  (burst, fountain, snow). Streak controls: velocity inherited from
  emitter motion, mass / air-resistance families (random, size-affects,
  rotational), spin (rotate, degrees/sec, random) with orient-to-motion
  blending, and motion-direction stretch rendered as elongated sprites.
- Trapcode Form (type 11) — static particle lattice with disperse, twist,
  spherical, fractal, and fluid deformation.
- Plexus (type 12) — points connected as lines, facets, triangulation,
  and beams with geometry sources and effectors.
- Trapcode Lights — replaces the Light picker with 8 C4D types (Spot,
  Point, Infinite, Area, Dome, Photometric IES, Physical Sun, Portal),
  extra light properties, per-frame THREE sync, and legacy Hemisphere
  migration.
- Trapcode designer — fullscreen preset/block/transport/parameter windows
  for the three object families, opened from the object-panel gear button
  (`designer.openFirst(kind)` is also available once enabled). The windows
  share the SaaS theme of the Legacy setup editors (Inter type, silk
  backdrop, gold suite accents, pill controls) with a bundled Inter
  variable font the runtime installs on enable. The presets
  column includes a PALETTE section with shared color schemes (Fire,
  Sunset, Ocean, Ice, Forest, Neon, Candy, Royal, Toxic, Smoke) that apply
  to the current system: color gradients for Particular/Form and base +
  secondary colors for Plexus effectors/renderers.
- Expression upgrade — the OpenZoid expression methods stock CM3 lacks
  (`wiggle` and companions: `loopIn`/`loopOut`/`pingPong`, `toFixed`,
  `radiansToDegrees`/`degreesToRadians`, `easeIn`/`easeOut`/`easeInOut`,
  `valueAtTime`, `property`), plus the evaluation context (current
  frame/property/value) and the property passthrough it depends on. Methods
  install missing-only; everything restores when the pack is disabled.

The `trapcode-runtime` module evaluates the bundled sources in dependency
order through the plugin bundle asset API, so enabling the pack never fans
out into runtime fetches, and teaches `PZ.object3d.create` the Trapcode
numeric types. The picker entries are declared in the manifest and owned by
the plugin manager: disabling the pack removes them and restores the
original Light entry.

Optical Flares (type 13) is a separate pack and is not part of this plugin.

Known limitations (later phases):

- Projects that use Trapcode objects record a plugin dependency and prompt
  to enable this pack; loading such data with the pack disabled still
  fails, as with any unknown numeric type in vanilla CM3. C4D light ids
  are not recorded: keep the pack enabled for those scenes.
- Do not enable Light+ at the same time: both providers replace the Light
  entry and the last one enabled wins the picker.
- Particle sprite names resolve through the CM3 asset pipeline; names the
  upstream runtime does not ship fall back to whatever the host provides.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
