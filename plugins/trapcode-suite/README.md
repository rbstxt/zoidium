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
  Aux streaks: a system with Emit from parent on emits from every live particle
  of its parent system, so each parent leaves its own trail.
   Fluid motion adds a vortex swirl around the spherical-field center (core
   size scales that radius; tilt and rotate shape the swirl plane and push it
   toward inflow/outflow; center offset moves it), or buoyancy with seeded
   random swirl (scale, strength, seed), plus viscosity and a time scale.
   Gravity, wind and air resistance keep applying while fluid mode is on, and
   gravity has a direction (default +Y). New controls default to the legacy
   behavior, so older projects render identically.
- **Trapcode Form** (type 11) — particle lattice (box, sphere, sphere grid,
  cylinder, circle, plane, 3D model, text/mask image) deformed by disperse,
  twist, spherical fields, a fractal field, fluid motion and kaleidospace
  mirrors. Layer maps drive color/alpha, displacement, size, fractal strength,
  disperse and rotate. Strings connect neighbouring points. The Shading group
  mirrors the donor controls; the Audio React group drives size, opacity,
  disperse, fractal and twist from offline audio analysis (see Audio).
  Transform applies scale, offsets and animated X/Y/Z rotations in degrees
  to the whole form after its deformations, including connecting strings.
  Rotation Order selects one of the six Euler orders. It defaults to XYZ
  and is a fixed setting, while the rotation angles remain animatable.
- **Plexus** (type 12) — points connected as points, lines (line type
  distance/adjacency/shape), facets,
  triangulation or beams. Geometry sources (layers, paths, OBJ, primitives,
  instances, slicer), effectors (noise, spherical field, container, transform,
  color map, shade, sound) and renderers.

## Lights

The Trapcode Lights picker adds eight C4D-style types. Stock CM3 light types
keep their behavior and old saved catalogue ids still load.

| Picker name | Lighting |
| --- | --- |
| Point Light (Omni) | PointLight with distance and decay |
| Spot Light | SpotLight with penumbra, distance and decay |
| Infinite Light (Directional) | DirectionalLight with Kelvin temperature, shadow filter radius and shadow coverage |
| Area Light | Real rectangular emitter (RectAreaLight with bundled r91 LTC tables); Width/Height resize the lit area |
| Hemisphere Light (Sky/Ground) | HemisphereLight |
| Photometric IES Light | Angular candela distribution from a local LM-63 file or a built-in profile |
| Sun (Directional) | Azimuth and elevation drive direction, temperature, intensity and sky fill |
| Portal Light | One-sided rectangular window fill, driven by the scene's Sun or Hemisphere light |

IES Profile has a native property row with Uniform, Downlight and Wall wash
presets and a Load .ies button. The file stays in the project's hidden IES Data
property and survives save/reload. It is never uploaded. The parser accepts
LM-63 Type C photometry with TILT=NONE. Unsupported tilt references and Type A/B
files report an error. Intensity scales the profile's normalized peak candela.
The renderer samples a 128 by 64 angular texture per light, with up to 16 IES
lights in one project. Additional IES lights use the ordinary spotlight fallback
and report a console warning. Angle and Penumbra remain stored for old projects,
but their rows are hidden because the photometry determines the beam. IES lights do not cast shadows, so imported distributions can cover the full
sphere.

Area Width and Height resize the rectangular emitter, and the editor draws
its outline on the viewport-only helper layer. The pack bundles the three.js
r91 LTC tables (MIT, see plugins/trapcode-suite/lights-ltc-LICENSE.txt), so in
the editor the light renders as a real RectAreaLight on standard and physical
materials, including PBR+. Where float-filtered textures or the
standard/physical shader library are unavailable, Area and Portal fall back to
nine one-sided spot samples spread across the same rectangle with
inverse-square falloff — the same materials an ordinary SpotLight reaches —
so close receivers can then reveal individual samples. Custom ShaderMaterial
skins such as Material+ Custom do not implement the rect-area response, so
they only receive the fallback. Area and Portal do not cast shadows.

Portal emits toward Target and contributes nothing behind its window. Color
filters the source tint. Its
Intensity scales the first Sun in the same scene, or the first Hemisphere if
there is no Sun. Without either source, it supplies a modest blue sky fill.
It does not trace outdoor geometry or sample an environment image. The source
properties are evaluated at the requested frame, so object update order does
not change the result.

Sun Azimuth rotates around world Y. Elevation ranges from -10 to 90 degrees.
Low sun is warm and dim; high sun is brighter and near daylight white. Below
the horizon, direct light turns off and a small sky fill remains. Target sets
the center of its orbit. Infinite's Shadow Softness changes the shadow filter
radius, not the physical size of an emitter. Shadow Coverage sets the
orthographic shadow camera's span.

These lights illuminate lit materials. Single Color and Matcap are unlit.
New positional lights start at `[0, 100, 100]` and aim at the origin. Saved
positional light coordinates remain unchanged; Sun positions now come from its
angles. Each feature depends only on project properties and the requested
frame. Disabling the pack releases textures and helpers and restores the
shared shader and stock Light methods. Scenes using these types need the pack
enabled to render.

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
