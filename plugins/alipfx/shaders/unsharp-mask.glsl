precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2      resolution;
varying vec2      vUvScaled;

/* === Panzoid dynamic properties (create these exactly) ===
   Number (dynamic): Amount     -> percent (0..500 recommended)
   Number (dynamic): Radius     -> pixels  (0..50+ depending on content)
   Number (dynamic): Threshold  -> levels  (0..255, AE-style)
*/
uniform float Amount;
uniform float Radius;
uniform float Threshold;

/* ------------------------------------------------------------------
   Gaussian blur approximator
   - Isotropic (samples axial + diagonal rings)
   - Radius is specified in *pixels* (AE-like)
   - Uses 6 rings -> 49 taps (center + 8*K) for good quality
   - Spacing adapts so farthest tap ~ Radius
   ------------------------------------------------------------------ */
vec3 gaussianBlur(vec2 uv, float radiusPx)
{
    if (radiusPx <= 0.0) return texture2D(tDiffuse, uv).rgb;

    const int K = 6;
    float sigma  = max(radiusPx, 0.001);
    float stepPx = max(1.0, radiusPx / float(K));
    vec2  texel  = 1.0 / resolution;

    vec3 acc   = texture2D(tDiffuse, uv).rgb;
    float wsum = 1.0;

    for (int i = 1; i <= K; ++i) {
        float d   = float(i) * stepPx;
        float w   = exp(-(d*d) / (2.0 * sigma * sigma));
        vec2  off = texel * d;

        acc  += texture2D(tDiffuse, uv + vec2( off.x, 0.0)).rgb * w;
        acc  += texture2D(tDiffuse, uv + vec2(-off.x, 0.0)).rgb * w;
        acc  += texture2D(tDiffuse, uv + vec2(0.0,  off.y)).rgb * w;
        acc  += texture2D(tDiffuse, uv + vec2(0.0, -off.y)).rgb * w;
        wsum += 4.0 * w;
    }
    return acc / wsum;
}

/* Luma (Rec.709) for threshold gating — AE threshold is in 8‑bit levels. */
float luma709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main()
{
    vec2 uv  = vUvScaled;
    vec3 src = texture2D(tDiffuse, uv).rgb;

    // 1) Blur with AE-like "Radius" measured in pixels
    float r = max(Radius, 0.0);
    vec3  blur = gaussianBlur(uv, r);

    // 2) High-pass (edges)
    vec3 hp = src - blur;

    // 3) Threshold gate — AE uses 0..255 levels; here convert to 0..1 luma
    float thr = clamp(Threshold / 255.0, 0.0, 1.0);
    float edgeStrength = abs(luma709(hp));

    // Soft edge around threshold to avoid harsh banding
    float gate = smoothstep(thr, thr + (1.0/255.0), edgeStrength);

    // 4) Amount (%): 100 = add full high-pass; 50 = half; 200 = double
    float gain = Amount / 100.0;

    vec3 outColor = src + hp * gain * gate;

    gl_FragColor = vec4(clamp(outColor, 0.0, 1.0), 1.0);
}
