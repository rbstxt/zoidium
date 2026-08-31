precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2      resolution;
varying vec2      vUvScaled;

/* --- AE-style properties (create as Dynamic Number properties in Panzoid) --- */
uniform float Invert;               // 0.0 = Disabled, 1.0 = Enabled (matches AE)
uniform float Blend_With_Original;  // 0..100 (%) --> 0% full effect, 100% original only

/* --- Tunables (leave as-is for AE-like behavior) --- */
const float EDGE_NORM  = 1.05;       // Sobel max magnitude for a unit step (normalizes to 0..1)
const float GAMMA      = 0.75;       // Work in linear; display in sRGB

// sRGB <-> Linear helpers for more AE-like tonality
vec3 toLinear(vec3 c) { return pow(c, vec3(GAMMA)); }
vec3 toSRGB  (vec3 c) { return pow(c, vec3(1.0 / GAMMA)); }

void main()
{
    vec4 src = texture2D(tDiffuse, vUvScaled); // source in display space (sRGB)

    // Pixel step in buffer UVs (Panzoid supplies resolution in pixels)
    vec2 px = 1.0 / resolution;

    // Sample a 3x3 neighborhood (converted to linear for correct gradient math)
    vec3 tl = toLinear(texture2D(tDiffuse, vUvScaled + vec2(-px.x, -px.y)).rgb);
    vec3 tc = toLinear(texture2D(tDiffuse, vUvScaled + vec2( 0.0 , -px.y)).rgb);
    vec3 tr = toLinear(texture2D(tDiffuse, vUvScaled + vec2( px.x , -px.y)).rgb);
    vec3 ml = toLinear(texture2D(tDiffuse, vUvScaled + vec2(-px.x,  0.0 )).rgb);
    vec3 mr = toLinear(texture2D(tDiffuse, vUvScaled + vec2( px.x ,  0.0 )).rgb);
    vec3 bl = toLinear(texture2D(tDiffuse, vUvScaled + vec2(-px.x,  px.y)).rgb);
    vec3 bc = toLinear(texture2D(tDiffuse, vUvScaled + vec2( 0.0 ,  px.y)).rgb);
    vec3 br = toLinear(texture2D(tDiffuse, vUvScaled + vec2( px.x ,  px.y)).rgb);

    // Sobel per channel (RGB) — classic 3x3 kernels
    // Gx = [-1 0 +1; -2 0 +2; -1 0 +1]
    // Gy = [-1 -2 -1; 0 0 0; +1 +2 +1]
    vec3 gx = (-1.0*tl) + ( 1.0*tr) +
              (-2.0*ml) + ( 2.0*mr) +
              (-1.0*bl) + ( 1.0*br);

    vec3 gy = (-1.0*tl) + (-2.0*tc) + (-1.0*tr) +
               (1.0*bl) + ( 2.0*bc) + ( 1.0*br);

    // Gradient magnitude (normalize to 0..1 for a unit step edge), clamp for safety
    vec3 edgeLin = clamp(sqrt(gx*gx + gy*gy) / EDGE_NORM, 0.0, 1.0);

    // AE behavior:
    // - Invert OFF  (0): dark lines on white background  ->  1 - edge
    // - Invert ON   (1): bright/colored lines on black   ->  edge
    vec3 effectLin = mix(vec3(1.0) - edgeLin, edgeLin, step(0.5, Invert));

    // Convert back to sRGB for display/mixing
    vec3 effectSRGB = toSRGB(effectLin);

    // AE "Blend With Original": 0..100% (0% full effect, 100% original only)
    float bwo = clamp(Blend_With_Original, 0.0, 100.0) * 0.01;
    vec3 outRGB = mix(effectSRGB, src.rgb, bwo);

    gl_FragColor = vec4(outRGB, src.a); // preserve source alpha (AE layers keep alpha)
}
