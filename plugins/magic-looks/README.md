# Magic Looks

A Zoidium `extension` plugin. It adds a Magic Bullet Looks-style color
setup window plus the Magic Looks grading effect with all 29 Looks
color tools: the shared color-wheel palette design, HSL wheels,
curves/S-curve editors, the 4-way diamond with ranges graph, Warm/Cool
pad, Star Filter angle dial, per-tool presets and reset, global look
presets, and look export/import as JSON.

The `looks` native effect hosts the whole tool chain in one pass
(lens distortion, color tools, channel LUTs, LUT looks, light tools,
lens tools) and appears in the effects picker beside the COLOR
effects. The setup window binds to the first Magic Looks effect on the
selection (or adds one via Add Looks), mirrors every control to live
effect properties, and renders the project through a transplanted main
viewport preview inside the window. Unbound, the setup still edits a
local look that can be exported as JSON.

- 16 Color tools: Color Contrast, HSL Colors, Color Ranges, Crush,
  Contrast, Color Reversal, 3-Strip Process, Lift-Gamma-Gain, Ranged
  Saturation, Warm/Cool, 4-Way Color, Mojo II, Auto Shoulder, Curves,
  S Curve, LUT.
- 8 Light tools: Lightflex, Deflare, Vignette, Haze/Flare, Pop,
  Diffusion, Star Filter, Anamorphic Flare.
- 5 Lens tools: Lens Distortion, Shutter Streak, Edge Softness,
  Chromatic Aberration, Telecine Net.

The `looks-setup` module evaluates the bundled sources in dependency
order through the plugin bundle asset API, so enabling the pack never
fans out into runtime fetches. The canvas widgets depend only on DOM
and canvas; the color math, tool catalog, grade reference pipeline,
and effect surface are covered by `test/looks-catalog.test.js` and
`test/looks-grade.test.js` (including a headless-WebGL shader/JS
parity probe pattern).

```bash
pnpm run build:plugin-bundles
pnpm run verify
```
