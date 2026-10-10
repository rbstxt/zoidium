# Setup Legacy

A Zoidium `native-fx` plugin. It provides seven OpenZoid effects as an external extension layer around CM3.

- Echo (Legacy) — smear, maximum, additive and screen echoes. Each echo is an
  explicitly evaluated earlier frame through the core frame sampler, so the
  result does not depend on playback history. Up to 16 echoes.
- Posterize Time (Legacy) — frame-rate quantizer implemented as a core temporal
  operator, with the same bucket rule as Native FX Posterize Time.
- Jpeg Damage — JPEG compression-break simulation.
- VHS — full signal-chain rebuild (tracking, chroma crawl, snow, tears, OSD).
- Datamosh — deterministic segment motion matching with nine motion modes and
  the 80 Davidium look entries. Mirror, sweep, random-block, spatial multiply,
  tapered oscillation, neighbor blur and multi-tap smear families read a sampled
  source anchor. Hold, Speed and Time remain editable; old look indices migrate
  on load. The previous rendered output is never used.
- VHS Setup window — floating preset/slider editor for every VHS signal and
  motion control, wired to the effect's Setup property.
- Datamosh Setup window — preset/slider/algorithm-dropdown editor for the
  Datamosh effect, wired to the effect's Setup property. Seeded Mosh! and
  Remove Frame buttons, plus a field guide.
- True datamosh export pass — opt-in post-export I-frame removal on the
  Device render page (off / full video / at clip cuts, off by default).
  Preview stays deterministic; the export pass is an explicit user option.
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

## Donor preset mapping

Davi's 10 datamosh presets are mapped onto the deterministic model. The donor
algorithm index N becomes Look N + 1 (Look 0 is the new motion-matching path,
Looks 1-80 are the donor entries in order); Motion follows the same family
mapping as old-project migration. All other donor values are kept verbatim;
the segment fields use the gentle defaults (interval 30, samples 6) and the
seed is never touched by a preset.

| Davi preset | Donor algo | Look | Motion | Notes |
|---|---|---|---|---|
| Clean Pass | 0 (Default) | 1 | 0 Identity | unchanged values |
| Logo Mosh · Blocky | 12 (Random Blocks 1) | 13 | 8 Random | unchanged values |
| Classic Mosh | 11 (Random) | 12 | 8 Random | unchanged values |
| I-Frame Kill · Soupy | 11 (Random) | 12 | 8 Random | unchanged values |
| Swap Motion | 10 (Swap) | 11 | 7 Swap | unchanged values |
| Sweep Horizontal | 49 (Sweep horiz.) | 50 | 3 Horizontal | unchanged values |
| Sin Melt | 53 (Middle sin X) | 54 | 6 Wave | unchanged values |
| Mirror Glitch | 42 (Mirror X) | 43 | 3 Horizontal | motion is cosmetic here |
| Zoom Smear | 5 (Zoom 1) | 6 | 4 Zoom | unchanged values |
| Average Trail x10 | 33 (Average prev 10) | 34 | 0 Identity | unchanged values |

The 15 VHS presets carry the donor values verbatim (verified by diff). A
preset name shows when every value is within 0.015 of the preset, the donor
matching tolerance.

## Seeded randomizer buttons

Glitch! (VHS), Mosh! and Remove Frame (Datamosh) port the donor buttons as
seeded actions: each click stores a new seed (VHS `glitchSeed`, Datamosh
`seed`, advanced by 7919 modulo 10000) and derives every value from that seed
with exact integer hashing, so the result is reproducible and the whole click
is one undo step. Ranges mirror the donor buttons; Remove Frame sets hold to
full with an intensity floor instead of the donor's timed spike.

## Donor alignment notes

- ASCII Font indices match the donor (0 consolas, 1 courier, 2 monospace,
  3 source code pro, 4 serif). Index 3 renders the bundled Source Code Pro
  instead of the donor's Inter, which this project does not ship; index 0
  falls back to it when Consolas is missing. Old donor projects load with the
  same values, including Neon Night (`fontFamily: 3`).
- Tracery Key Track switches all six points off, like the donor. New Tracery
  effects deliberately start with Point 1 on at the frame centre (the donor
  started with every point off, so a new effect showed nothing).
- True datamosh (`datamosh-export.js`) wraps the Device render page from
  inside this plugin and restores it on disposal; it never edits `zoidium/*`
  or `plugins/core/*`. The finished note reads
  `TRUE MOSH: dropped N of M keyframes`; failures deliver the clean render.

Known limitations (later phases):

- The Trapcode Suite and Optical Flares packs cover the remaining 3D
  objects; the Object-panel gear wiring for all designer windows arrives
  with the designer/UI phase.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
