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

Gradient, Curve, Palette, and Text are static properties. Their JSON stays in the
project; generated textures do not. [Property controls](/docs/development/shader-properties/)
describes their editors and saved formats.
