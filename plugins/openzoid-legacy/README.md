# Setup Legacy

A Zoidium `native-fx` plugin. It ports five OpenZoid effects with their
original behavior preserved, plus the export-time true-datamosh renderer.

- Echo (Legacy) — rolling history-buffer echo (smear, maximum, additive,
  screen). Distinct from Native FX Echo, which re-evaluates explicit earlier
  frames instead of playback history.
- Posterize Time (Legacy) — hold-buffer frame-rate quantizer. Distinct from
  Native FX Posterize Time, which runs on a deterministic clock.
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
- Tracery Setup window — SaaS-style fullscreen editor (Inter type, live
  preview, presets, click-to-place points, collapsible control groups),
  wired to the effect's `tracerySetup` property button.
- ASCII — character-cell video: resampled glyph grid with per-band
  character mapping, contrast/brightness shaping, random symbols, scale
  jitter, sine-wave motion, fractal noise displacement, and scroll trails.
  Color modes (band/footage/duotone/mono/invert), character sets
  (standard/blocks/detailed/minimal/custom string), and glitch cuts.
- ASCII Setup window — same SaaS pattern in a red theme (Inter type, live
  preview, presets, collapsible groups), wired to the effect's
  `asciiSetup` property button.
- Tracery keying — GPU color-key match (key color + threshold + blur
  strength) at selectable detection quality, CPU connected-component
  labeling (largest regions first, capped), Show Mask preview, and alpha
  layer output. No key color present means no regions: the tracery only
  appears where the key is produced.

Effect sources resolve their GLSL from this plugin's bundle through
`this._zoidiumGetAsset` and fall back to the CM3 asset pipeline when the
bundle resolver is unavailable, so enabling the pack never fans out into
runtime fetches.

Known limitations (later phases):

- The Trapcode Suite and Optical Flares packs cover the remaining 3D
  objects; the Object-panel gear wiring for all designer windows arrives
  with the designer/UI phase.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
