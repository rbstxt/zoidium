---
title: Property kind examples
description: GLSL bindings and expressions for every Shader+ kind.
---
These fragments show file-scope declarations and expressions for `main()`.
Names match the example property names. The [shader reference](/docs/reference/shader/)
contains accepted types, native storage types, and auxiliary bindings.

## Slider

```glsl
uniform float Amount;
// Inside main():
float brightness = Amount * 2.0;
```

## Angle

The editor displays degrees. The shader receives radians.

```glsl
uniform float Rotation;
// Inside main():
vec2 direction = vec2(cos(Rotation), sin(Rotation));
```

## Seed

A seed is numeric. This example uses Expressions+'s deterministic hash include.

```glsl
// #include <zoidium/hash>
uniform float Seed;
// Inside main():
float randomValue = zHash(Seed);
```

## Toggle

A bool receives the native integer conversion. A float preserves fractional values.

```glsl
uniform bool Enabled;
// Inside main():
float amount = Enabled ? 1.0 : 0.0;
```

## Dropdown

Items named Linear and Smooth define the referenced constants `Mode_Linear` and
`Mode_Smooth`. Item indices stay stable through renames.

```glsl
uniform int Mode;
// Inside main():
float amount = Mode == Mode_Smooth ? 1.0 : 0.0;
```

## Static dropdown

The property supplies the definition. No uniform declaration is present.

```glsl
// Mode is a native compile-time definition.
#if Mode == 0
const float amount = 0.0;
#else
const float amount = 1.0;
#endif
```

## Color + alpha

The property supplies straight RGBA values.

```glsl
uniform vec4 Tint;
// Inside main():
gl_FragColor = vec4(Tint.rgb * Tint.a, Tint.a);
```

## Point

Point remains available for saved properties but is hidden from the add menu.

```glsl
uniform vec2 Center;
varying vec2 vUv;
// Inside main():
float distanceFromCenter = length(vUv - Center);
```

## Gradient

The include supplies the helpers. Shader+ supplies `Ramp_repetitions` for the
property's cyclic repetition setting.

```glsl
// #include <zoidium/gradient>
uniform sampler2D Ramp;
varying vec2 vUv;
// Inside main():
vec4 color = zGradient(Ramp, vUv.x);
vec4 repeatedColor = zGradientCycle(Ramp, vUv.x);
```

## Curve

Shader+ supplies `Response_range` and adds the range to two-argument calls for
known Curve properties. Three-argument calls specify the range explicitly.

```glsl
// #include <zoidium/curve>
uniform sampler2D Response;
varying vec2 vUv;
// Inside main():
float mapped = zCurve(Response, vUv.x);
vec3 mappedRgb = zCurves(Response, vec3(vUv.x));
```

## Palette

Palette supplies up to 16 straight RGBA colors and a count.

```glsl
uniform vec4 Colors[16];
uniform int Colors_count;
// Inside main():
vec4 firstColor = Colors_count > 0 ? Colors[0] : vec4(0.0);
```

## Text

Layout mode supplies a coverage texture. SDF alpha contains distance with its
edge at 0.5. Atlas mode also supplies `Title_grid` and `Title_count`.

```glsl
// #include <zoidium/text>
uniform sampler2D Title;
varying vec2 vUv;
// Inside main():
float coverage = zText(Title, vUv);
gl_FragColor = vec4(vec3(coverage), coverage);
```

## Path

A Path property references a layer mask or a Shape+ path and binds four uniforms.
Use `Points` to follow a path. Use `Coverage` to mask.

For a Path property named `Trail`, Shader+ binds these uniforms:

```glsl
uniform sampler2D TrailCoverage; // Coverage in the shader UV space (sample .a).
uniform sampler2D TrailPoints;   // 256 equally spaced points, xy in UV space.
uniform float TrailLength;       // Path length in u units.
uniform int TrailCount;          // 256 when the source resolves, 0 when missing.
```

- **Coordinates:** Both `TrailCoverage` and `TrailPoints` use shader UV space with `v = 1` at the top. For a Shape+ path source, the Shape+ layer's own transform is not applied, so coordinates stay in layer-local space.
- **Arc-length samples:** `TrailPoints` is a 256×1 RGBA texture filled with 256 points spaced equally by arc length. On an open path, texel `0` is the start and texel `255` is the end. On a closed path, sample `k` sits at `k / 256` around the loop.
- **Count and length:** `TrailCount` is `256` when the source resolves and `0` when the source is missing. Use `TrailCount` to check whether a source is bound, not as a vertex count. `TrailLength` divides the mask-space length by the source layer width, so it is in `u` units. On a 16:9 frame, a full-height vertical line has length `0.5625`, not `1.0`.
- **Open paths:** `TrailCoverage` closes an open path when it rasterizes the fill. `TrailPoints` does not close an open path.
- **Reading samples:** Read sample `k` from `0` to `255` with `texture2D(TrailPoints, vec2((float(k) + 0.5) / 256.0, 0.5)).xy`. Because `TrailPoints` uses nearest filtering, interpolate between two adjacent texels to read a smooth position at arc-length fraction `t` from `0.0` to `1.0`.

### Glow along a path

This fragment measures the distance from each pixel to the sampled points and adds a glow around the path.

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D TrailPoints;
uniform int TrailCount;
uniform vec2 resolution;
varying vec2 vUvScaled;

void main() {
	vec4 base = texture2D(tDiffuse, vUvScaled);
	float aspect = resolution.x / max(resolution.y, 1.0);
	float d = 1e9;
	for (int i = 0; i < 128; i++) {
		float u = (float(i) * 2.0 + 0.5) / 256.0;
		vec2 p = texture2D(TrailPoints, vec2(u, 0.5)).xy;
		d = min(d, length((vUvScaled - p) * vec2(aspect, 1.0)));
	}
	float present = step(0.5, float(TrailCount));
	float glow = (1.0 - smoothstep(0.0, 0.04, d)) * present;
	gl_FragColor = vec4(base.rgb + vec3(1.0, 0.55, 0.2) * glow, base.a);
}
```

The loop checks every second sample, for 128 taps. For a long path or a thin glow, change the loop bound to `256` and replace `float(i) * 2.0` with `float(i)`.

### Move particles along a path

This fragment places `8` particles along `TrailPoints` and moves them over time. `pathPoint` interpolates manually between adjacent texels so motion stays smooth.

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D TrailPoints;
uniform int TrailCount;
uniform vec2 resolution;
uniform float zTime; // Supplied by Expressions+, or replace with an animated Slider.
varying vec2 vUvScaled;

vec2 pathPoint(float t) {
	float idx = clamp(t, 0.0, 1.0) * 255.0;
	float i0 = floor(idx);
	float i1 = min(i0 + 1.0, 255.0);
	vec2 a = texture2D(TrailPoints, vec2((i0 + 0.5) / 256.0, 0.5)).xy;
	vec2 b = texture2D(TrailPoints, vec2((i1 + 0.5) / 256.0, 0.5)).xy;
	return mix(a, b, idx - i0);
}

void main() {
	vec4 base = texture2D(tDiffuse, vUvScaled);
	float present = step(0.5, float(TrailCount));
	float aspect = resolution.x / max(resolution.y, 1.0);
	vec3 add = vec3(0.0);
	for (int i = 0; i < 8; i++) {
		float fi = float(i);
		float t = fract(zTime * 0.12 + fi / 8.0);
		vec2 p = pathPoint(t);
		float d = length((vUvScaled - p) * vec2(aspect, 1.0));
		float twinkle = 0.6 + 0.4 * sin(zTime * 6.0 + fi * 2.4);
		add += vec3(1.0, 0.75, 0.35) * (1.0 - smoothstep(0.0, 0.02, d)) * twinkle;
	}
	gl_FragColor = vec4(base.rgb + add * present, base.a);
}
```

Use `pathPoint(1.0 - t)` to reverse direction. On an open path, clamp `t` or ping-pong it with `abs(t * 2.0 - 1.0)` so particles do not jump from the end to the start. On a closed path, `pathPoint` stops at texel `255`, which is `255/256` around the loop. To interpolate across the last step to texel `0`, use `fract(t) * 256.0` for `idx` and `mod(i0 + 1.0, 256.0)` for `i1`.

See [Path properties](/docs/development/shader-properties/#path) for the picker UI, saved JSON format, and 8-bit fallback behavior.

Gradient, Curve, Palette, and Text are static properties. Path resolves at the render frame, so animated masks and Shape+ paths move the effect. [Property controls](/docs/development/shader-properties/)
describes their editors and saved formats.
