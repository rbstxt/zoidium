# Rowbyte & Red Giant Suite

A Zoidium `object` plugin. It adds Trapcode-style 3D objects (Particular, Form,
Plexus) and C4D-style lights to the CM3 object picker, with floating designer
windows and the wiggle expression upgrade. It is an external extension layer
around CM3; it is not part of, and not endorsed by, Panzoid.

## Objects

- **Trapcode Particular** (type 10) — 3D particle system with emitter, physics,
  fields, layer maps, audio reactors, and per-system presets (burst, fountain,
  snow). Streaks: velocity inherited from emitter motion, mass / air-resistance
  families, spin with orient-to-motion blending, motion-direction stretch.
- **Trapcode Form** (type 11) — particle lattice (box, sphere, sphere grid,
  cylinder, circle, plane, 3D model, text/mask image) deformed by disperse,
  twist, spherical fields, a fractal field, fluid motion and kaleidospace
  mirrors. Layer maps drive color/alpha, displacement, size, fractal strength,
  disperse and rotate. Strings connect neighbouring points. The Shading group
  mirrors the donor controls; the Audio React group drives size, opacity,
  disperse, fractal and twist from offline audio analysis (see Audio).
- **Plexus** (type 12) — points connected as points, lines (line type
  distance/adjacency/shape), facets,
  triangulation or beams. Geometry sources (layers, paths, OBJ, primitives,
  instances, slicer), effectors (noise, spherical field, container, transform,
  color map, shade, sound) and renderers.

## Lights

The Trapcode Lights picker adds eight C4D-style types. Each name matches the
THREE backend that renders it:

| Picker name | Backend |
| --- | --- |
| Point Light (Omni) | PointLight |
| Spot Light | SpotLight |
| Infinite Light (Directional) | DirectionalLight |
| Area Light | RectAreaLight when THREE's LTC tables are installed; otherwise a PointLight approximation (named as such) |
| Hemisphere Light (Sky/Ground) | HemisphereLight |
| Photometric IES Light | SpotLight plus the IES profile label |
| Sun (Directional) | DirectionalLight tinted by sun elevation |
| Portal Light | RectAreaLight (6x8) when the LTC tables are installed; otherwise a DirectionalLight approximation (named as such) |
Stock CM3 Light types 1–3 keep their behavior; stock Hemisphere (type 4) keeps
its original type and sky tint on load. Disabling the pack
restores the stock Light methods and removes the added property definitions.
Scenes that use these lights need the pack enabled to render.

These lights illuminate lit materials throughout the scene, including CM3
Custom, PBR+, and Node Material. Single Color and Matcap are unlit materials.
New positional lights start at `[0, 100, 100]` and aim at the origin where
applicable, outside the default radius-10 Sphere. Saved light positions remain
unchanged. Light+ uses the same placement for its stock CM3 light backends.

## Designer

Each object opens a **floating window** from the object-panel gear button
(`designer.openFirst(kind)` is also available). The window follows the CM3
panel style and has the same layout for all three objects:

- **Target** — the system/object picker and the "add" buttons.
- **Presets** — preset list; a click applies the preset.
- **Palette** — shared color schemes (Fire, Sunset, Ocean, Ice, Forest, Neon,
  Candy, Royal, Toxic, Smoke) when the target has colors to set.
- **Parameters** — one tab per property group.

The editor viewport stays the live preview. Every edit is written through the
object's properties and recorded in CM3 history, so undo and redo work. Slider
drags preview live and record one undo step on release.

## Audio

Audio reactors and the Plexus sound effector read decoded audio at an explicit
media time through `T.audioAnalysis` (offline FFT, 0–1 level). They do not read
a live analyser, so a frame depends only on the project and the audio file.
Preview starts one cached asynchronous decode per asset. Export awaits the same
analysis in `prepare()`. Until a source is decoded,
its level is neutral (0.5); outside the clip window the level is 0.

Particular audio properties (per system):

- **Audio layer** — the audio or video asset to analyse.
- **Audio offset (seconds)** — adds a delay relative to the matching audio clip on the sequence timeline.
  When the asset has no audio clip, it shifts the start relative to the scene.
- **Audio trim in / out (seconds)** — selects the media range. Trim in is the
  media time at the clip start; trim out ends the reactor (0 disables it).

All four Particular reactors independently target size, opacity, velocity or color
brightness. Reactors aimed at the same target multiply their modulation.

The Plexus sound effector has audio layer, offset and trim properties.
Without an audio layer it uses a time-based wave, so it stays deterministic.

Form has an Audio layer property and five reactors with fixed targets:
reactor 1 scales particle size, 2 opacity, 3 disperse, 4 fractal displacement
and 5 twist, each by (1 + level). Form has no offset/trim properties; the
media time is the project frame over the scene rate. While no reactor is on,
or while the source is not decoded yet, every multiplier is 1, so existing
projects render identically.

## Simulation limits (Particular)

Particular simulates on a fixed 1/60 s grid, so a frame depends only on the
project time. To keep evaluation bounded:

- time is clamped to 600 seconds per evaluation;
- particle life is clamped to 30 seconds;
- at most 20,000 particles are simulated per system (the newest are kept).

## Expression upgrade

The OpenZoid expression methods stock CM3 lacks: `wiggle` and companions
(`loopIn`, `loopOut`, `pingPong`), `toFixed`, `radiansToDegrees` /
`degreesToRadians`, `easeIn` / `easeOut` / `easeInOut`, `valueAtTime`, and
`property`, plus the evaluation context (current frame, property and value).
Methods install missing-only and are removed when the pack is disabled.

## Runtime

The `trapcode-runtime` module evaluates the bundled sources in dependency order
through the plugin bundle asset API, so enabling the pack never fetches at
runtime. It teaches `PZ.object3d.create` the Trapcode numeric types and removes
them, the expression support, the lights and any open designer windows on
disable. Activation failures roll back what was installed.

Known limitations:

- Projects that use Trapcode objects record a plugin dependency and prompt to
  enable this pack; loading them with the pack disabled fails, as with any
  unknown numeric type in vanilla CM3. C4D light ids are not recorded: keep the
  pack enabled for scenes with Area or legacy light types.
- Do not enable Light+ at the same time: both providers replace the Light
  entry and the last one enabled wins the picker.
- Plexus link renderers use the first 12,000 points (lines) or 4,000 points
  (facets, triangulation); the cap keeps a frame's cost bounded.

```bash
# after changing sources or the manifest
pnpm run build:plugin-bundles
pnpm run verify
```
