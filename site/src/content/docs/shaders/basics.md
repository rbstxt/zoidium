---
title: Write a passthrough shader
description: Create a Custom Shader that preserves its input image.
---
We create a Custom Shader effect that returns the input image unchanged.
Enable Shader+ in Plugins before starting.

## Add the effect

1. Select a clip with visible content.
2. Add a native Custom Shader effect in Effects.
3. Open the shader code editor.
4. Replace the draft with this shader:

```glsl
precision highp float;
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
void main() {
	gl_FragColor = texture2D(tDiffuse, vUvScaled);
}
```

5. Click **Apply**.
6. Turn off the editing camera to inspect the output.

The output matches the effect input. `tDiffuse` contains that input image.
`vUvScaled` already applies the scale needed to sample the input texture.

## Display coordinates

1. Replace the draft with this shader:

```glsl
precision highp float;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4(vUv, 0.0, 1.0);
}
```

2. Click **Apply**.

The output shows red and green coordinate ramps. `vUv` spans the output image.
For input sampling, `vUvScaled` equals `vUv * uvScale`. `resolution` gives the
output width and height in pixels. The [shader reference](/docs/reference/shader/)
lists their declarations.

## Add a control

1. Open Shader properties.
2. Click **+**.
3. Choose Slider under ZOIDIUM.
4. Set its name to `Amount`.
5. Open the code editor.
6. Replace the draft with this shader:

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform float Amount;
varying vec2 vUvScaled;
void main() {
	vec4 color = texture2D(tDiffuse, vUvScaled);
	gl_FragColor = vec4(color.rgb * Amount, color.a);
}
```

7. Click **Apply**.
8. Change Amount in the effect properties.

Amount now scales the image brightness. At 1, the input is unchanged.
Read [property controls](/docs/development/shader-properties/) for other kinds.
