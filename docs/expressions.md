# Expressions+

Expressions+ extends CM3 through Zoidium's external extension layer. Alt-click
the animation button beside a native property, enter an expression and leave
the field to commit. The final expression statement returns its value. An
explicit `return` also works. A failed expression uses the property's own
keyed value and shows an English error in the row's tooltip. Each distinct
source/error pair is logged once, with a bounded diagnostic cache.

## Language

Use `var`, `let`, `const`, arrow functions, ordinary functions, default/rest
parameters, template literals, destructuring, spread, optional chaining,
conditionals, loops, switch and `throw`. For example:

```js
const offsets = [1, 2, 3];
let total = 0;
for (const offset of offsets) total += offset;
value + total * sin(time)
```

Class, imports, async/await, generators, `with`, `debugger` and `this` are
rejected. Unknown free identifiers remain compile-time ReferenceErrors,
including in dead branches. `window`, `globalThis`, `document`, `self`, `top`,
`parent`, `frames`, `Function`, `eval` and `Date` are unavailable. The compiler
uses the Function constructor captured from a temporary sandboxed iframe,
removes that iframe, and only then compiles and evaluates the expression.

Member reads retain CM3 behavior, including computed reads of `constructor`,
`__proto__` and `prototype`. This returns 23:

```js
var key = "con" + "structor";
[1, 2, 3][key] === [4][key] ? 23 : 0
```

Security exception: invoking Function, AsyncFunction, GeneratorFunction,
AsyncGeneratorFunction or eval is an expression error, including another
realm's constructor, aliases, computed paths, call/apply/bind, callbacks,
optional calls, tagged templates and `new`. Ordinary constructor values can
still be read, compared, stored and returned. Dynamic invocation passes a
runtime call guard. CM3 method and Math function identities remain intact.
This is the host's detached-realm expression model with added call hardening,
not a sandbox for arbitrary third-party plugins.

Programs that require Expressions+ syntax or API have 10,000,000 combined
loop/call steps and a 256-call recursion limit. Counters reset for an outer
property read and cover referenced expressions. Exceeding a limit is an
English expression error. CM3-compatible programs retain native unbounded
loop behavior so finite legacy expressions keep their results.

`Array`, `Number`, `String`, `Boolean`, `JSON`, `parseInt`, `parseFloat`,
`isFinite`, `isNaN`, `Infinity`, `NaN`, `undefined` and `Math` are available.
`Math.random()` is unavailable. Existing `random(seed)` keeps CM3's exact
seeded hash. For a repeatable stream, use `seedRandom(17, true); random()`.
The second argument makes the seed independent of frame; every evaluation
starts a fresh stream. No stream state survives into the next frame.

## Values and navigation

`frame` is CM3's property-local frame. `time` retains the owning clip's Time
property, in seconds, including time remapping. `value` is the property's
own value before its expression. Values and handles expose no project writes.

`thisProperty` has `value`, `valueAtTime(seconds)`, `velocity`, `speed`,
`numKeys`, `key(index)` and `nearestKey(seconds)`. Key indices start at 1.
Key records contain `index`, `time` and `value`. Velocity is a symmetric
0.01-second derivative; speed is its magnitude. Self valueAtTime samples
the original keyframes rather than recursing through the expression.

`thisObject` is the owning object or effect. `thisLayer`, `thisClip`,
`thisSequence` and its alias `thisComp` provide higher levels. Handles expose:

- `.parent` for the nearest owning object. `.parent(n)` navigates n levels
  from that parent. The free browser identifier `parent` stays unavailable.
- `.layer(nameOrIndex)` selects a currently active video layer, with index 1
  at the first video track. `layer(nameOrIndex)` starts at the sequence.
- `.effect(name)` selects an effect. `effect("Glow")("Radius")` and
  `effect("Glow").param("Radius")` return a parameter value.
- `.object(name)` selects a direct 3D child in a scene or group.
- `.property(name)` returns a property handle. Names can be storage keys,
  native display names or custom-property names.

`prop("path")` returns a property value. `/Scene/Cube/Position` starts at the
sequence; `../Radius` starts at the parent; `./Position` starts at the owner.
Segments use exact names and `/` as the separator. Names containing `/` must
use the handle methods instead. Cross-clip reads use the same absolute
sequence frame, converted to the target clip's local frame. Cyclic property
links report an error and use each failing property's own keyed value.

## Animation helpers

Existing CM3 method signatures retain their meaning. In particular,
`linear(start, end, amount)` and `ease(amount, family, direction)` remain
unchanged, including ignored extra arguments. In a program using Expressions+
syntax or API, use the five-argument AE form `linear(t, tMin, tMax, a, b)` or
`ease(t, tMin, tMax, a, b)` for clamped scalar or vector interpolation.
`easeIn` and `easeOut` also accept five arguments. Existing Trapcode helper
signatures take precedence when that pack is enabled. For example:

```js
const t = time;
linear(t, 0, 1, 10, 20)
```

`clamp(value, min, max)` accepts a number or CM3 vector. Angle helpers use
`degreesToRadians(x)` and `radiansToDegrees(x)`. `lookAt(from, to)` returns
XYZ Euler angles in radians, with local +Z pointing toward the target.

`wiggle(frequency, amplitude, octaves, amplitudeMultiplier, frame)` reuses
Zoidium's existing Trapcode implementation. Frequency therefore retains its
existing frame-based convention. A position recipe is:

```js
wiggle(0.05, [20, 20, 0])
```

Projects using extended syntax or API record an Expressions+ dependency.
See [saved project compatibility](project-compatibility.md#expressions).

## Performance

The implementation budget is 16 ms at the 95th percentile for 1,000 simple
expression properties, excluding drawing and initial compilation. A headless
Chromium run on the development machine, using 100 measured frames after 10
warmup frames, measured 5.4 ms median and 14.5 ms p95 for
`const x=sin(time); value + x * 2`. The slowest sample was 44.5 ms under
concurrent verification load. This is a measurement, not a deadline enforced
by the evaluator. Loops and property navigation add work to that budget.

## Sequence Controls

Open Sequence and expand Controls. The + button adds Slider, Angle, Checkbox,
Color, Point 2D or Point 3D. Right-click a control to rename it, change its
order, remove it or edit a Slider's min/max/step. Angle values use radians
internally and display degrees. Checkbox uses native off/on values 0 and 1.
Control names must be unique within a sequence. A sequence supports 256 controls.

These are native dynamic properties. Use their animation buttons, keyframes,
curves, Graph Editor 2 and native value controls. Each add, remove, rename,
reorder, settings change or generated link is one undo entry. A control's
keyframes and expressions survive save/reopen and copying sequence settings.

Expressions at any level in the same sequence can read:

```js
controls.Amount * 2
```

Names with spaces use `control("Glow radius")` or `controls["Glow radius"]`.
Right-click a numeric/vector/color property row, choose Link to control… and
select a compatible control. The generated expression includes the control's
stable ID, so renaming or reordering it keeps that link working. Hand-written
name-only expressions must be updated after a rename. Removing a referenced
control reports an expression error and restores the property's own value.

For an effect radius linked to a Slider named Amount:

```js
control("Amount")
```

## World and camera links

Object handles and the owning-object helpers have `toWorld(point)`,
`fromWorld(point)`, `worldPosition()` and `worldRotation()`. Points are
three-component arrays. Rotations are XYZ Euler angles in radians, after
parent group transforms and Track To. World reads sample native transform
properties at the requested frame and solve constraints on temporary Three
objects. They do not change the live scene or reuse the previous frame's pose.
Native camera shake and Camera+ vibrate/projection run on camera copies.

`object.toScreen(localPoint)` returns `[x, y, depth]` in composition pixels,
with the origin at the top left. `depth` is normalized device depth, -1 at
near and +1 at far. The renderer's active native or Camera+ camera is selected
at that frame; shared camera tracks apply when the target scene track has 3D
tracking enabled. Native scene layer position, scale and rotation are included.
`fromScreen([x,y,depth])` reverses the mapping to object-local coordinates.
Preserve the returned depth for a round-trip. Zero-scale transforms cannot
be inverted. Helpers without a 3D owner use world coordinates in the owning
scene, or the first active scene when the owner is a 2D layer.

To pin a native Transform effect's Image position to the center of a 3D object
named Shape in a scene named Scene:

```js
const pixel = layer("Scene").object("Shape").toScreen([0, 0, 0]);
const size = thisComp.property("Resolution").value;
[pixel[0] - size[0] / 2, size[1] / 2 - pixel[1], 0]
```

To drive its Image rotation from a Camera+ Z roll:

```js
[0, 0, layer("Scene").object("Camera+").worldRotation()[2]]
```

These helpers describe authored object/group transforms and the rendering
camera. Repeater instances, deformed vertices, post-effect image distortion
and nested composition time mappings are outside the coordinate contract.
For sheared or nonuniformly scaled parent chains, worldRotation uses Three's
matrix decomposition; its Euler angles are not a unique shear decomposition.

## Shader extensions

Custom Shader effects keep their original saved GLSL. Expressions+ expands
these exact full-line directives only in the compiler input:

```glsl
// #include <zoidium/hash>
// #include <zoidium/noise>
// #include <zoidium/color>
// #include <zoidium/sdf>
```

Chunks are emitted once. Noise includes hash automatically. The GLSL ES 1.00
library has `zHash(float/vec2/vec3)`, `zNoise(vec2/vec3)`, `zSrgbToLinear(vec3)`,
`zLinearToSrgb(vec3)`, `zRgbToHsv(vec3)`, `zHsvToRgb(vec3)`,
`zSdCircle(vec2,float)`, `zSdSphere(vec3,float)`, `zSdBox(vec2,vec2)`,
`zSdBox(vec3,vec3)` and `zSmoothUnion(float,float,float)`. Hash/noise return
0–1; HSV uses hue in 0–1. SDF distances are negative inside. Color conversions
operate on RGB and leave alpha to the shader author.

Declare `uniform float zTime;` and `uniform float zFrame;` to receive the
owning clip's Time in seconds and effect-local frame. Scalar `int` uniforms
are also accepted and truncate toward zero. Declare `ctl_<Name>` as float,
int, vec2, vec3 or vec4 to bind a Sequence Control. Non-ASCII/space/punctuation
characters in names become `_`; colliding normalized names report an error.
The control's dimension must match. Color binds RGB as vec3 or opaque RGBA as vec4; Point 2D/3D bind
vec2/vec3. Comma-separated uniform declarations are accepted. Automatic
binding does not support uniform arrays.

For a Slider named Amount:

```glsl
precision highp float;
uniform float zTime;
uniform float zFrame;
uniform float ctl_Amount;
varying vec2 vUvScaled;
// #include <zoidium/noise>
void main() {
  float n = zNoise(vUvScaled * 8.0 + vec2(zTime));
  gl_FragColor = vec4(vec3(ctl_Amount * n), 1.0);
}
```

Native custom-property expressions and Node Effect exposed parameters use the
same expression engine. Existing shaders without these declarations/includes
receive their exact original compiler input and native uniforms. Shader errors
appear through CM3's shader error handler; missing controls can recover as
soon as a compatible control exists.
