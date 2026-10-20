# Magic Looks

A Zoidium extension plugin with 29 color, light and lens tools, animated tool
instances, look presets and a floating setup window. Zoidium is an external
extension layer around CM3, independent of and not endorsed by Panzoid.

## Using it

Enable Magic Looks, add its effect from the COLOR category, then choose
**Open Magic Looks Setup**. A new effect starts with an empty, neutral chain.

- Choose a Category and Add tool. Every addition creates an independent instance.
- Drag a chain row to reorder it. Move up / Move down and Alt+Arrow Up/Down
  on the selected row provide keyboard alternatives. Lens Distortion can move
  anywhere in a new chain.
- Each row has On/Off, Duplicate and Remove. Duplicate preserves native
  keyframes, expressions and curve data. Removing an instance removes its
  channels; Undo restores them.
- The selected instance's parameters are native CM3 property rows, with the
  usual animation toggles and expressions. They also appear in Effects;
  numeric channels work in Graph Editor 2. Instance numbers identify channels
  independently of order. Curve shapes retain native text snapshot channels,
  so shape keys change at keys rather than interpolating individual points.
- Curves, wheels and LUT import retain their visual controls alongside native
  channels. On a focused wheel, arrows adjust hue/strength and Home resets.
  On a focused curve, Home/End and Page Up/Down select a point, arrows move it,
  Insert adds a point after it, and Delete removes an interior point.
- Look presets reset the chain's values and apply their values to the first
  instance of each required tool, adding missing tools. Clear look restores
  neutral values while retaining instance identities and order. Each action is
  one undo step. Applying a preset resets existing animation as well.

Imported 3D `.cube` LUTs are stored as project assets. Each LUT instance has its
own file, strength and gamma channels. Tables support sizes 2 through 128;
1D/combined tables and files larger than 80 MB are rejected.

## Rendering and limits

Every stage reads the preceding stage's output. Spatial tools each need an
image pass. Consecutive pointwise color tools share a draw, including repeated
instances with independent uniforms. Color groups split after eight tools or
six LUT/curve samplers to stay within shader limits. A chain contains at most
64 instances.

The effect allocates at most two layer-sized RGBA half-float targets for
intermediate images. They are reused across frames, resized with the layer,
and disposed with the effect. A one-pass chain allocates no intermediate target.
Intermediate color stays straight and unclipped. The first pass reads
premultiplied input; the final pass clamps and premultiplies the output.
Resampling a Lens Distortion stage also resamples alpha. Input UV scaling is
applied only when reading CM3's shared buffer. Rendering depends on native
property values at the requested frame, never on preceding frames.

Multipass chains require renderable, filterable half-float textures. Rendering
on GPUs without that support is not verified. Half-float storage can round
new multipass results between spatial stages; saved legacy looks never use it.

## Saved project compatibility

Three formats coexist without converting a saved look to new semantics.

- Saved effects with `chainOrder` and no `looksInstances` keep the released
  single-pass renderer from version 15, including its original-source spatial
  sampling and Lens Distortion before the chain.
- Davidium effects without `chainOrder` use the original imported grading
  implementation from `f56811c`. Its catalog, CPU math and GLSL are isolated in
  `davidium-looks-*`. This retains original alpha, LUT gamma, Color Ranges,
  S-curve and Vignette behavior. Resaving adds `looksLegacyFormat: "davidium"`
  so the decision survives later saves. Its tool order remains fixed.
- New effects serialize `looksInstances` version 1. The ordered `{id, tool}`
  records have monotonically allocated local IDs. Native properties use keys
  `ml_<id>_<catalog property>`, retaining CM3's complete animation records.

Current-format effects that were previously imported and resaved retain their
current look. Their original Davidium provenance cannot be recovered from a
resave that already added `chainOrder`; it is not guessed from plugin versions.
Existing effects never silently switch to instances when edited.

Older builds ignore instance metadata and render the neutral legacy fallback
properties. They cannot reproduce instance chains. Builds with unknown-field
preservation retain the extra schema and native channels when resaving.
Builds without historical-format support also ignore `looksLegacyFormat` and
use their own existing grading behavior for Davidium data.
See [project compatibility](../../docs/project-compatibility.md#magic-looks).

## Implementation

`looks-tools.js` defines the current tool catalog. `looks-fx.js` retains the
released renderer and routes formats at load. `looks-instances.js` validates
identity and plans passes; `looks-instance-runtime.js` installs native channels;
`looks-passes.js` compiles instance-specific copies of the released tool math.
`looks-instance-reference.js` provides a floating-point CPU ordering reference.
`looks-instance-ui.js` owns instance authoring and structural history; the
existing setup module retains legacy editing and shared custom controls.

```bash
pnpm run build:plugin-bundles
pnpm run verify
```
