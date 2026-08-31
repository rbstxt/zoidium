precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Built-ins (Panzoid provides these)
uniform vec2 resolution;
uniform vec2 uvScale;

// ---- Custom properties (Panzoid) ----
uniform vec3 Highlights;
uniform vec3 Midtones;
uniform vec3 Shadows;
uniform float Blend_With_Original;

// ============================================================
// Optional: sRGB <-> Linear conversions (leave OFF unless needed)
// ============================================================
#define USE_SRGB_CONVERSION 0

vec3 srgbToLinear(vec3 c) {
  vec3 low  = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, step(c, vec3(0.04045)));
}

vec3 linearToSrgb(vec3 c) {
  vec3 low  = c * 12.92;
  vec3 high = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055;
  return mix(high, low, step(c, vec3(0.0031308)));
}

float luminance709(vec3 rgbLinear) {
  return dot(rgbLinear, vec3(0.2126, 0.7152, 0.0722));
}

void main()
{
  // EDGE FIX #1: Clamp UVs slightly inward to avoid border sampling
  vec2 texelSize = 1.0 / (resolution * uvScale);
  vec2 eps = 0.5 * texelSize;                 // half-texel inset
  vec2 uv = clamp(vUvScaled, eps, 1.0 - eps); // clamp inside bounds

  vec4 texel = texture2D(tDiffuse, uv);

  // EDGE FIX #2: Handle premultiplied alpha to prevent fringe/tint
  float a = texel.a;
  vec3 src = (a > 0.0) ? (texel.rgb / a) : vec3(0.0); // unpremultiply

  // --- Blend With Original: STRICT 0..100 (%), AE-like ---
  float blend = clamp(Blend_With_Original / 100.0, 0.0, 1.0);

  // --- Work space ---
  vec3 srcWork = src;
  vec3 hiWork  = Highlights;
  vec3 midWork = Midtones;
  vec3 shWork  = Shadows;

#if USE_SRGB_CONVERSION
  srcWork = srgbToLinear(srcWork);
  hiWork  = srgbToLinear(hiWork);
  midWork = srgbToLinear(midWork);
  shWork  = srgbToLinear(shWork);
#endif

  // --- Brightness -> Tritone ramp ---
  float luma = clamp(luminance709(srcWork), 0.0, 1.0);

  vec3 tri;
  if (luma < 0.5) {
    tri = mix(shWork, midWork, luma * 2.0);
  } else {
    tri = mix(midWork, hiWork, (luma - 0.5) * 2.0);
  }

  // --- Blend back with original (0% = full effect, 100% = original) ---
  vec3 outWork = mix(tri, srcWork, blend);

#if USE_SRGB_CONVERSION
  vec3 outRgb = linearToSrgb(outWork);
#else
  vec3 outRgb = outWork;
#endif

  // Re-premultiply so compositing is clean
  outRgb *= a;

  gl_FragColor = vec4(outRgb, a);
}
