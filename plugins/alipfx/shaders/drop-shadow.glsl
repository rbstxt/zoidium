precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform vec3 Shadow_Color;   // Color
uniform float Opacity;       // 0..100 (%)
uniform float Direction;     // degrees
uniform float Distance;      // pixels
uniform float Softness;      // blur amount
uniform float Shadow_Only;   // 0 or 1

varying vec2 vUvScaled;

// ------------------------------------------------------------
// Safe sampling: outside bounds -> 0 (prevents edge smearing)
// ------------------------------------------------------------
float inBounds(vec2 uv) {
  float inX = step(0.0, uv.x) * step(uv.x, uvScale.x);
  float inY = step(0.0, uv.y) * step(uv.y, uvScale.y);
  return inX * inY;
}

vec4 sampleSafe(vec2 uv) {
  float m = inBounds(uv);
  vec2 uvc = clamp(uv, vec2(0.0), uvScale);
  return texture2D(tDiffuse, uvc) * m;
}

float sampleAlphaSafe(vec2 uv) {
  return sampleSafe(uv).a;
}

// ------------------------------------------------------------
// Hash for stable per-pixel rotation/jitter
// ------------------------------------------------------------
float hash12(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

// ------------------------------------------------------------
// Linear-light compositing helpers (approx sRGB)
// AE linearized workflow removes gamma in working space, which
// affects blending/resampling and edge falloff. [1](https://support.emerson.edu/hc/en-us/articles/21709271104539-Color-Management-in-After-Effects)[2](https://helpx.adobe.com/after-effects/using/blending-modes-layer-styles.html)
// ------------------------------------------------------------
vec3 srgbToLinear(vec3 c) {
  // Simple approximation (fast): gamma 2.2
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec3 linearToSrgb(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

void main()
{
  vec4 src = texture2D(tDiffuse, vUvScaled);

  // AE-like direction: 0=right, 90=down
  float ang = radians(Direction);
  vec2 dir = vec2(cos(ang), -sin(ang));

  // UV size of 1 pixel in scaled buffer
  vec2 px = uvScale / resolution;

  // Shadow offset in UV
  vec2 shadowOffset = dir * Distance * px;

  // Shadow is source alpha shifted by +offset => sample at uv - offset
  vec2 baseUV = vUvScaled - shadowOffset;

  // ------------------------------------------------------------
  // Softness mapping tuned for AE (linearized)
  // Your earlier curve made 50 too strong and 100~200 too close.
  // AE blur behaves like increasing sample radius/area. [3](blob:https://www.microsoft365.com/a6593026-59af-47b3-9486-bb62cdc03421)[4](blob:https://www.microsoft365.com/a4ae5a20-e366-478c-9bdd-3c1ffe7abea5)
  // ------------------------------------------------------------
  const float AE_SOFTNESS_SCALE = 0.60; // start point for AE linearized match
  float blurPx = max(Softness, 0.0) * AE_SOFTNESS_SCALE;

  float shadowA = 0.0;

  if (blurPx <= 0.001) {
    shadowA = sampleAlphaSafe(baseUV);
  } else {
    // Per-pixel rotation reduces patterning
    vec2 pix = (vUvScaled / uvScale) * resolution;
    float rnd = hash12(floor(pix));
    float rotAng = rnd * 6.28318530718;

    // 32 taps total = 1 center + 31 spiral taps
    const float GOLDEN_ANGLE = 2.399963229728653; // pi*(3 - sqrt(5))
    const float INV_N = 1.0 / 31.0;

    // Sigma controls falloff "creaminess".
    // In linear blending, edges look different than gamma blending. [1](https://support.emerson.edu/hc/en-us/articles/21709271104539-Color-Management-in-After-Effects)[2](https://helpx.adobe.com/after-effects/using/blending-modes-layer-styles.html)
    float sigma = max(blurPx * 0.55, 0.0001);
    float invTwoSigma2 = 1.0 / (2.0 * sigma * sigma);

    // Small radius jitter hides subtle rings
    float jitter = 0.92 + 0.16 * hash12(floor(pix) + vec2(19.19, 73.73));

    float wsum = 1.0;
    shadowA = sampleAlphaSafe(baseUV); // center

    for (int i = 0; i < 31; i++) {
      float fi = float(i);

      // even disk coverage: r ~ sqrt(t)
      float t = (fi + 0.5) * INV_N;
      float r = blurPx * sqrt(t) * jitter;

      float a = rotAng + fi * GOLDEN_ANGLE;
      vec2 d = vec2(cos(a), sin(a));

      vec2 o = d * r * px;

      float w = exp(-(r * r) * invTwoSigma2);
      shadowA += sampleAlphaSafe(baseUV + o) * w;
      wsum += w;
    }

    shadowA /= max(wsum, 1e-6);
  }

  // Opacity (% like AE)
  shadowA *= clamp(Opacity * 0.01, 0.0, 1.0);

  // Shadow color in linear
  vec3 shLin = srgbToLinear(Shadow_Color);

  // Source in linear (for AE-linear-like blending)
  vec3 srcLin = srgbToLinear(src.rgb);

  // Premult in linear
  vec3 shPM  = shLin * shadowA;
  vec3 srcPM = srcLin * src.a;

  // AE order: SOURCE over SHADOW (shadow behind)
  float outA  = src.a + shadowA * (1.0 - src.a);
  vec3  outPM = srcPM + shPM * (1.0 - src.a);

  // Shadow Only
  if (Shadow_Only >= 0.5) {
    float a = shadowA;
    vec3 pm = shPM;
    vec3 rgbLin = (a > 1e-6) ? (pm / a) : vec3(0.0);
    gl_FragColor = vec4(linearToSrgb(rgbLin), a);
    return;
  }

  // Back to straight alpha + convert back to sRGB
  vec3 outLin = (outA > 1e-6) ? (outPM / outA) : vec3(0.0);
  gl_FragColor = vec4(linearToSrgb(outLin), outA);
}
