---
title: Port a shader to Custom Shader
description: Adapt Shadertoy-style entry points and numbered AlipFX colors.
---
Keep a copy of the original shader before editing. These changes can alter pixels.

## Adapt Shadertoy-style source

1. Replace `mainImage(out vec4 color, in vec2 fragCoord)` with `void main()`.
2. Replace writes to the output argument with `gl_FragColor`.
3. Declare `uniform vec2 resolution;`.
4. Replace pixel coordinates with `vUv * resolution` after declaring `varying vec2 vUv;`.
5. If the shader samples the effect input, declare `uniform sampler2D tDiffuse;`.
6. Sample that input with `vUvScaled` after declaring `varying vec2 vUvScaled;`.
7. If the shader needs project time, enable Expressions+.
8. Declare `uniform float zTime;` and replace time reads with `zTime`.
9. Replace unsupported GLSL features with GLSL ES 1.00 equivalents.
10. Click **Apply** and inspect the compiler result.

Use `texture2D` for texture sampling. Custom Shader does not supply Shadertoy's
extra channels, multipass buffers, mouse state, or feedback history. Remove those
dependencies or replace them with explicit project properties.

## Replace numbered AlipFX colors

1. Add a Gradient property named `Ramp`.
2. Copy the original colors into stops in their existing order.
3. Match the original stop spacing, color space, and alpha.
4. Add `// #include <zoidium/gradient>` to the source.
5. Declare `uniform sampler2D Ramp;`.
6. Replace the old interpolation call with `zGradient(Ramp, t)`.
7. Apply the source and compare its output with the original.

Keep the original shader if the new sampling cannot match the required look. See [AlipFX migration](/docs/development/shader-properties/#alipfx-migration).
