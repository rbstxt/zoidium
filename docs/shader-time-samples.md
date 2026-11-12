# Read a layer at another time

Use Shader+ **Time sample** properties to read the input before the current Custom Shader effect at other times.

1. Open **Shader properties**, click **+**, and select **ZOIDIUM > Time sample**.
2. Rename the property to `Past`.
3. Set the offset to `-1` to read one frame earlier.
4. To use seconds, right-click the property, open **Property settings…**, and select **Seconds** in **Offset units**. The same panel offers **Minimum**, **Maximum**, **Step**, **Decimals**, and **Snap** for the offset row.
5. Declare the property as a texture in the shader.

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D Past;
varying vec2 vUvScaled;
void main() {
	gl_FragColor = mix(texture2D(tDiffuse, vUvScaled),
		texture2D(Past, vUvScaled), 0.5);
}
```

To animate the offset, add keyframes to the property. To drive the offset with Expressions+, Alt-click its animation button and enter an expression. For repeatable time jumps, use `Math.floor(Math.sin(time * 12) * 3)` with **Frames** units.

To start with two images, select **New from template > Motion from two time samples**, then click **Add properties**. The `zTimeMotion` helper estimates motion from brightness changes. Use property velocity when you need exact authored motion. To start with time jumps, select **New from template > Time jitter**, then click **Add properties**. That template requires Expressions+.

Keep each effect to four Time sample properties. Use `vUvScaled` for all input textures. Use an offset of zero to read `tDiffuse` exactly. Samples include earlier effects and exclude the current effect and later effects. For adjustment layers, samples use the lower clips active at the output time, matching Time Offset. Scenes and adjustment layers can sample beyond their clip bounds. Other layers hold the nearest clip edge. Pre-comps follow their existing temporal clock mapping.

If an input cannot be prepared, render the frame again after preparation completes. Export stops on an unavailable sample. Save the project to retain offsets, units, keys, and expressions. Open it with Shader+ v24 or newer. Older builds report a shader compile error for the new kind.
