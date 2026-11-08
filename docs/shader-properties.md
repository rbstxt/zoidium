# Shader properties

See [Read a layer at another time](shader-time-samples.md) for Time sample properties.

Shader+ adds editors to native Custom Shader properties. Add an effect, open
Shader properties, click +, then choose a kind under ZOIDIUM. Right-click a
property to rename, duplicate or delete it, or choose "Property settings…" to
edit its name, kind and the settings that kind uses (range, default, options,
group, tooltip, visibility). Apply records one undo step.
Kind choices share the property's native storage type. Changing a numeric
kind preserves all keys, tweens and expressions. A default is authoring
metadata; changing it does not overwrite the current value.


A native number without Shader+ kind metadata shows Slider range settings.
Other native types show Native until a kind is selected.
Apply without edits leaves the definition and current value unchanged.

## Numbers and vectors

Slider is a NUMBER with a range bar. Angle stores radians and displays degrees.
Toggle and Dropdown store NUMBER values. Toggle uses an off/on menu by default.
Its Property settings also offers Display = Checkbox for one-click changes.
Changing Display preserves the current value, animation, expressions, and shader output. Their editors write integers and
new keys use Hold. Attaching these editors never rounds evaluated values or
changes old key interpolation. Fractional expressions reach GLSL unchanged:

```glsl
uniform float Mode;
uniform float Enabled;
// Use these in main(), when rounding or a threshold is wanted:
// int mode = int(Mode + 0.5);
// bool enabled = Enabled > 0.5;
```

`uniform int` and `uniform bool` also work. Three r91 chooses the GL setter
from the active GLSL uniform type. Integer uniforms use GL's integer
conversion. Use a float uniform when the shader needs fractional values.

Dropdown items keep their indices when renamed. `Mode_Linear` is emitted as a
constant only if the include-expanded shader references that token. Comments
do not count. Static dropdown uses native OPTION storage and a compile-time
`#define Mode index`. Seed adds a randomize button. Color + alpha is a
straight RGBA vec4. Point (a vec2 with UV/pixel metadata) is no longer offered
in the menu; saved Point properties keep loading and binding as vec2.

## Reset behavior

The native Properties reset on a Shader effect preserves the fragment shader code.
It resets the other native properties, including Name and Enabled.
The separate **Reset custom properties to defaults** button is on the Shader properties heading.
It resets all custom controls in one undo step and preserves their definitions and groups.

The custom reset clears keyframes and expressions and restores a static value at frame 0.
This follows After Effects' Reset behavior instead of adding a key at the current frame.
The reset uses `zoidiumShader.default` when present.
Otherwise, it uses the property's definition value or its native default.
Vector controls reset every component. Gradient, Curve, Palette, and Text restore their default JSON values.
Undo restores the previous values, keyframes, and expression source together.

## Groups and visibility

Groups appear as collapsible headings in the native list. The tooltip appears on the row.
The Shader properties **+** list includes **Group**, which search also finds.
This action moves the selected rows into a new named group in one undo step.
It requires at least one selected property and an unused group name.
Locked groups prevent moves into or out of the group.

**Visible when** selects another property in the same effect.
**Has value** accepts exact values, comparisons, and inclusive numeric ranges.
Semicolons join alternatives with OR.

| Input | The row appears when the controller value is |
| --- | --- |
| `> 5.5` | Greater than 5.5 |
| `>= 1` | At least 1 |
| `< 0` | Less than 0 |
| `<= 2` | At most 2 |
| `!= 3` | Different from 3 |
| `= 4` | Equal to 4 |
| `1..5` | Between 1 and 5, including both endpoints |
| `1; 2; > 5.5` | Equal to 1 or 2, or greater than 5.5 |

Comparisons use the controller's native evaluated number, including animation and expressions.
Invalid operators, nonnumeric comparison operands, and reversed ranges show an error before Apply saves changes.
Existing exact-value conditions keep strict equality, including saved strings that contain operator characters.
Visibility affects editor rows only. Hidden controls still reach the shader, Preview cache, and exports with their current values.

Exact values retain the saved `{"property":"Mode","values":[1,2]}` format.
New comparisons add a `conditions` array, such as `{"op":">","value":5.5}` or `{"op":"range","min":1,"max":5}`.
The `values` and `conditions` arrays are alternatives. Any match shows the row.

## Keyframe data in shaders

Slider and Point controls are native dynamic properties, so they accept
expressions exactly like native rows. Alt-click the animation button beside
the control and enter an expression that reads another property. The uniform
updates every frame from the evaluated value.

To drive a Point control from the motion of a layer named Ball, use:

```js
thisComp.layer("Ball").property("Position").velocity
```

`velocity` reports per-second units: a number for scalar properties, an array
for vector properties. `speed` reports the magnitude. `valueAtTime(seconds)`
samples the past; `time - thisComp.frameDuration` is the previous frame:

```js
thisComp.layer("Ball").property("Position").valueAtTime(time - thisComp.frameDuration)
```

For controls on the same effect, address them with `thisObject`, for example
`thisObject.property("Source").velocity`. To start from a working shader,
choose New from template, then Velocity from a property. The template declares
the Point control and repeats this recipe in a comment.

## Gradient

Gradient stores static TEXT JSON:

```json
{"stops":[{"position":0,"color":[0,0,0,1]},{"position":1,"color":[1,0.5,0,1]}],"interpolation":"linear","space":"srgb","cyclic":false}
```

The editor reuses Node Effect's Color Ramp widget. Drag stops, use arrow keys,
add/remove a stop, or edit its position, color and alpha. Interpolation is
constant, linear, ease or cardinal. Color spaces are sRGB, linear RGB and
OKLab. A cyclic gradient joins its final stop to its first and shows a ring
preview. The texture is 256×1 RGBA8 with straight alpha.

```glsl
precision highp float;
// #include <zoidium/gradient>
uniform sampler2D Ramp;
varying vec2 vUv;
void main() { gl_FragColor = zGradient(Ramp, vUv.x); }
```

Use `zGradientCycle(Ramp,t)` to wrap coordinates. `zGradient` clamps them.

## Curve and palette

Curve stores static TEXT JSON with `points`, `range`, `channels` and the
shared Color Curves channel arrays `composite`, `red`, `green`, `blue`, `alpha`.
The shared Color Curves editor supplies point editing. Single uses one curve;
RGBA applies the composite before each RGB channel and evaluates alpha
independently. Range maps normalized curve output into the chosen units.

```glsl
precision highp float;
// #include <zoidium/curve>
uniform sampler2D Response;
varying vec2 vUv;
void main() {
  float value = zCurve(Response, vUv.x);
  gl_FragColor = zCurves(Response, vec4(value));
}
```

Shader+ inserts the range uniform and adds it to two-argument helper calls
for known Curve properties. Three-argument calls can supply a range explicitly.
The texture is 1024×1. Filterable/renderable half-float is used when the editor
renderer reports support; otherwise RGBA8 has 1/255 normalized output precision.
Range remapping happens in GLSL on both paths, so values outside 0–1 retain
their units. Changes update the LUT and range without recompiling.

Palette stores `{"colors":[[1,0,0,1],[0,0,1,1]]}` with at most 16 straight
RGBA colors. Declare `uniform vec4 Colors[16]; uniform int Colors_count;`.
The swatch strip changes the array without recompiling.

## Text

Text stores static TEXT JSON with `text`, `font`, `size`, `align`, `lineHeight`,
`letterSpacing`, `mode`, and `sdf`. The font key points to a CM3 preset or a
project font asset. Use the native font menu or choose a custom TTF/OTF/WOFF
file. The row includes multiline text, size in pixels, alignment, line height
and letter spacing in em. Each committed change is one undo step on the full
JSON property, including font changes.

```glsl
precision highp float;
// #include <zoidium/text>
uniform sampler2D Title;
uniform float Title_aspect;
uniform vec2 Title_size;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(1.0), zText(Title, vUv)); }
```

Layout mode rasterizes the entire string. Atlas mode puts distinct characters
in first-occurrence order into an equal-cell grid, excluding line breaks.
It supplies `Title_grid` and `Title_count`. Use
`zGlyph(Title,Title_grid,index,uv)`. The longest texture side is bounded to
2048 pixels; text is limited to 2000 characters and atlas to 256 glyphs.
Glyph outlines come from CM3's font assets, not CSS fonts. SDF stores signed
distance in alpha, with 0.5 at the edge. For SDF use `smoothstep` around 0.5
instead of treating alpha as coverage.

Text rebakes only when its JSON changes. Export preparation awaits font
loading and rasterization. A font failure stops export preparation with an
English shader error. Shader+ owns font asset load/unload references,
and releases them with textures on property removal, effect unload or disable.
Gradient, Curve, Palette and Text are static in this release.

## AlipFX migration

`plugins/alipfx/controls.json` maps five representative effects at build time.
It adds editor metadata only. Shader source, native types, values, keyframes,
expressions and uniform names remain unchanged. Existing saved effects keep
their own definitions; the mapping does not rewrite projects.

To replace numbered colors such as ProGradient's `Color_1` through `Color_8`,
create a Gradient property, copy the colors into stops in their existing order,
then replace the shader's interpolation routine with `zGradient(Ramp,t)` and
add its include. Match color space, stop spacing, hue behavior and alpha
explicitly. This is a shader migration and can change pixels; keep the old
shader when exact compatibility is required. The metadata mapping performs
none of these shader edits.

## Gradient and curve editors

Gradient now uses the shared inline stop editor. It includes a checkerboard
preview, separate opacity stops, midpoint diamonds, an S/V square, hue/alpha
strips, hex/RGB fields and local presets. Reverse reverses both stop lists;
Distribute spaces the selected list evenly. Editing a stop previews live and
commits one undo step. Cyclic gradients offer Bar/Wheel views, triangular
markers, Interpolate and Cycle repetitions. The view is editor state only.
Interpolate chooses linear or constant; the interpolation menu still offers
ease and cardinal.

Optional gradient JSON fields are:

```json
{
  "stops": [{"position":0,"color":[1,0,0,1],"midpoint":0.3},
            {"position":1,"color":[0,0,1,1]}],
  "opacityStops": [{"position":0,"alpha":0,"midpoint":0.5},
                   {"position":1,"alpha":1}],
  "cyclic": true,
  "repetitions": 3
}
```

A midpoint belongs to the segment following that stop. Its default is 0.5.
Separate opacity stops override color-stop alpha. `repetitions` is finite and
at least 1, defaults to 1, and affects `zGradientCycle(Name,t)` through
`Name_repetitions`. `zGradient(Name,t)` continues to sample a single bar.
An explicit third argument to `zGradientCycle` overrides the property's
repetitions. Repetition edits do not recompile the shader.

Single-channel curves default to a filled Graph with numeric 0/1 x labels,
range-based y labels, point controls, Handles, Random, Reset and shape presets.
Right-click the property > Property settings > Curve editor chooses Graph
or Curves. RGBA retains the channel-based Curves editor. Optional
`zoidiumShader.axis:["Start","Peak","End"]` names the graph's x-axis;
two labels are also accepted. Axis labels are metadata, not a change to time
or curve sampling. Property settings accepts the array as JSON.

Points can have explicit cubic Bezier handles as
`[x,y,null,{"in":[x,y],"out":[x,y]}]`. Handles are absolute normalized
coordinates. Each is optional. X handles are constrained within the segment
and ordered for a unique x-to-y mapping; y is clamped to 0–1. Segments without
explicit handles use the original monotone Color Curves sampler. Showing
Handles or changing editor style does not write point data. Random authors
five static points once; renders never generate random points.

Input-luminance histograms are not implemented. `zoidiumShader.histogram`
is reserved and has no effect in this version.
