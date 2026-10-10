precision highp float;
precision highp int;

// ---- Built-in Panzoid uniforms / varyings ----
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---- Custom properties (create these in the effect panel) ----
uniform float Pixel_Size; // Number (dynamic), default 6
uniform float Dither;     // Number (dynamic), default 1

// Compact ordered-dither (Bayer 4x4)
float bayer2(vec2 a)
{
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float bayer4(vec2 a)
{
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void main()
{
    float ps = max(Pixel_Size, 1.0);

    // Which "GB pixel" block this fragment belongs to
    vec2 block = floor(vUv * resolution / ps);

    // Sample input at the center of the block.
    // Custom UVs must be mapped with uvScale before sampling!
    vec2 uv = (block * ps + ps * 0.5) / resolution;
    vec4 texel = texture2D(tDiffuse, uv * uvScale);

    // Luminance
    float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));

    // Bayer dithering -> the checkered GB shading from the video
    lum += (bayer4(block) - 0.5) * 0.25 * Dither;

    // Quantize to 4 shades
    float idx = floor(clamp(lum, 0.0, 0.9999) * 4.0);

    // Classic DMG palette (uncomment the alt set to match the video's
    // near-black shadows / more yellow greens)
    vec3 c0 = vec3(0.059, 0.220, 0.059); // #0f380f
    vec3 c1 = vec3(0.188, 0.384, 0.188); // #306230
    vec3 c2 = vec3(0.545, 0.675, 0.059); // #8bac0f
    vec3 c3 = vec3(0.608, 0.737, 0.059); // #9bbc0f
    //vec3 c0 = vec3(0.020, 0.030, 0.010); // almost black
    //vec3 c1 = vec3(0.240, 0.310, 0.100); // dark olive
    //vec3 c2 = vec3(0.470, 0.560, 0.130); // olive
    //vec3 c3 = vec3(0.620, 0.760, 0.160); // bright yellow-green

    vec3 col = c0;
    col = mix(col, c1, step(1.0, idx));
    col = mix(col, c2, step(2.0, idx));
    col = mix(col, c3, step(3.0, idx));

    gl_FragColor = vec4(col, texel.a);
}
