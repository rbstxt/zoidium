# Magic Looks

A Zoidium `extension` plugin: a Magic Bullet Looks-style color grading effect
with 29 tools, an ordered tool chain, look presets, and a floating setup window.
It is an external extension layer around CM3; it is not affiliated with or
endorsed by Panzoid.

## Using it

- Enabling the plugin only makes the **Magic Looks** effect available (COLOR
  category). Nothing is displayed or applied until the effect is added to a layer.
- A fresh effect renders the source unchanged. Color Contrast ships switched off
  because its fixed contrast amount is part of its character.
- The **Setup** button on the effect's Enabled row opens a floating window
  (zoidium/ui-kit.js). The viewport behind it is the live preview.
  - **Look**: presets, filterable and grouped. Choosing one resets every tool to
    neutral and applies the preset as one undoable step. **Clear look** resets
    the tools and keeps the chain order.
  - **Tool Chain**: the tools in order, with Up, Down, Enable/Disable and Remove
    for the selected tool, and an Add tool menu. Lens Distortion always runs
    first and cannot be moved.
  - **Parameters**: the selected tool's values, plus its color wheels, HSL
    sliders, curves pad, S-curve sliders, four-way wheels, or LUT controls.
- Every committed edit is one undo/redo step on the effect's properties. Live
  drags only preview. Setup keeps its scroll position, input focus and look filter
  after edits, and removing a tool selects its neighbour.
- The plugin cannot be disabled while a project uses its effect. After removing
  its effects, disabling closes its windows, restores the property renderer, and
  removes its stylesheet.

## Tools

- 16 color tools: Color Contrast, HSL Colors, Color Ranges, Crush, Contrast,
  Color Reversal, 3-Strip Process, Lift-Gamma-Gain, Ranged Saturation, Warm/Cool,
  4-Way Color, Mojo II, Auto Shoulder, Curves, S Curve, LUT.
- 8 light tools: Lightflex, Deflare, Vignette, Haze/Flare, Pop, Diffusion, Star
  Filter, Anamorphic Flare.
- 5 lens tools: Lens Distortion, Shutter Streak, Edge Softness, Chromatic
  Aberration, Telecine Net.

Vignette Strength darkens the edges; its Color wheel adds a tint. Edge Softness
blurs outside its Radius. Size, range, and gamma-space controls shape an active
tool; they may leave the image unchanged while its strength or tint is neutral.

## Files

- `looks-tools.js`: catalog, neutral defaults, default chain, look presets, and
  property definitions (single source of truth).
- `looks-color.js`: color math and the JS reference grade. It mirrors the shader
  tool-for-tool and is what the tests check.
- `looks-grade.glsl` / `looks-vert.glsl`: the grade shader. It is compiled once.
  Per-frame work is uniform updates only; the chain order and the curve tables
  are re-uploaded only when their stored text changes.
- `looks-fx.js`: the native effect (properties, uniforms, pass gating).
- `looks-setup.js`, `looks-setup.css`, `looks-widgets.js`: the setup window, its
  stylesheet, and the two custom canvases (color wheel, curves pad).

## Rendering rules

- Math is on straight color. Premultiplied input is unpremultiplied once,
  graded, clamped to [0,1], and premultiplied on output. Alpha passes through.
- Each tool is gated by its enable property. While every property holds its
  default, the pass is disabled and the layer is untouched.
- Lens Distortion is a geometric resample and runs before the chain. The other
  tools run in the order stored in the `chainOrder` property.
- Tools with a fixed contrast or threshold (Color Contrast, zone thresholds)
  use the values documented in the catalog; no hidden state is kept between
  frames.

## Compatibility with saved projects

- Vignette now attenuates the edges with a neutral white tint. Existing looks
  with nonzero Vignette Strength render darker at the edges. Fresh Edge Softness
  tools use Radius 0.35 so Blur Size works immediately; stored radii are kept.
- Projects saved with the Davidium build keep their values. Projects without a
  `chainOrder` property get the legacy pipeline order.
- Two render fixes also change older projects: transparent pixels stay
  transparent (the old shader forced alpha to 1), and the LUT gamma setting
  only applies when a LUT is selected.
- Removed controls (Mojo II tint, Deflare size, the Star Filter and Anamorphic
  threshold softness, the Color Ranges threshold, and the S-curve Log choice)
  are no longer in the catalog. Their stored values are ignored.
- Color Ranges zone tints now apply in their own tool. Previously they were
  applied inside Ranged Saturation, so a project that set those wheels will
  look different. Other projects are unaffected.
- The S-curve tool now applies its black/white levels after the Curves tool.
  Previously they came before it. Projects that set black or white points away
  from 0 and 1 may differ slightly.

```bash
pnpm run build:plugin-bundles
pnpm run verify
```
