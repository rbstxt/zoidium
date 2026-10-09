# Setup Legacy

A Zoidium `native-fx` plugin. It ports five OpenZoid effects with their
original behavior preserved, plus the export-time true-datamosh renderer.

- Echo (Legacy) — smear, maximum, additive and screen echoes. Each echo is an
  explicitly evaluated earlier frame through the core frame sampler, so the
  result does not depend on playback history. Up to 16 echoes.
- Posterize Time (Legacy) — frame-rate quantizer implemented as a core temporal
  operator, with the same bucket rule as Native FX Posterize Time.
- Jpeg Damage — JPEG compression-break simulation.
- VHS — full signal-chain rebuild (tracking, chroma crawl, snow, tears, OSD).
- Datamosh — feedback motion-vector smear with algorithm presets.
- datamosh-export module — installs `PZ.datamoshRender` for byte-exact
  I-frame removal on exported WebM/VP8/VP9 files.
- VHS Setup window — fullscreen preset/slider/viewport editor for the VHS
  effect, wired to the effect's `vhsSetup` property button.
- Datamosh Setup window — preset/slider/algorithm-dropdown editor for the
  Datamosh effect, wired to the effect's `datamoshSetup` property button.
- Tracery — motion-tracking callout overlay: per-point boxes
  (rectangle/square/ellipse/circle with fill modes), markers
  (dot/plus/cross/polygon), spline/PCB/smooth/step connection lines with
  dash + arrows, coordinate/dimension/area/node/custom labels, and grid.
  Points are manual track markers animated by keyframes or expressions.
- Tracery Setup window — floating window (docs/plugin-ui.md) with presets,
  detection, box/marker/line/label controls and one tab per point. Every edit is
  an undoable CM3 property change; the main viewport is the live preview.
- ASCII — character-cell video: resampled glyph grid with per-band
  character mapping, contrast/brightness shaping, random symbols, scale
  jitter, sine-wave motion, fractal noise displacement, and scroll trails.
  Color modes (band/footage/duotone/mono/invert), character sets
  (standard/blocks/detailed/minimal/custom string), and glitch cuts. Glyphs use
  the bundled Source Code Pro or the generic monospace family.
- ASCII Setup window — floating window with presets and collapsible control
  groups, wired to the effect's `asciiSetup` property button.
- Tracery keying — GPU color-key match (key color + threshold + blur
  strength) at selectable detection quality, CPU connected-component
  labeling (largest regions first, capped), Show Mask preview, and alpha
  layer output. No key color present means no regions: the tracery only
  appears where the key is produced.

Effect sources resolve their GLSL from this plugin's bundle through
`this._zoidiumGetAsset`. The shared vertex shader comes from the host asset
pipeline. Enabling the pack never fans out into runtime fetches.

Determinism: every effect here computes a frame from the project properties,
the frame index and the input pixels. Nothing is carried between renders.
Shader and font loads are awaited in `prepare()` before a frame renders.

Known limitations (later phases):

- The Trapcode Suite and Optical Flares packs cover the remaining 3D
  objects; the Object-panel gear wiring for all designer windows arrives
  with the designer/UI phase.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
