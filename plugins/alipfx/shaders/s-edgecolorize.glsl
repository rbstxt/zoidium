precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// Panzoid properties
uniform float Edge_Smooth;       // sigma-like blur amount (in pixels)
uniform float Subpixel_Smooth;   // 0 or 1
uniform float Brightness;        // >= 0
uniform float Rotate_Colors;     // degrees

uniform vec3 Background;
uniform vec3 Top;
uniform vec3 Right;
uniform vec3 Bottom;
uniform vec3 Left;

// ---- color management helpers (important for Sapphire-like look) ----
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGamma(vec3 c)  { return pow(max(c, 0.0), vec3(1.0/2.2)); }

float lumaLin(vec3 lin) {
  return dot(lin, vec3(0.2126, 0.7152, 0.0722));
}

vec2 rot2(vec2 v, float deg) {
  float a = radians(deg);
  float s = sin(a), c = cos(a);
  return vec2(c*v.x - s*v.y, s*v.x + c*v.y);
}

// ---- Gaussian-ish 9-tap blur of luminance using sigma (Edge Smooth) ----
// Uses center + 4 taps at 1px + 4 taps at 2px (fast, stable, good “Sapphire-ish” smoothing)
float blurLuma(vec2 uv, float sigmaPx) {
  vec2 px = 1.0 / resolution;

  vec3 cLin = toLinear(texture2D(tDiffuse, uv).rgb);
  float c = lumaLin(cLin);

  if (sigmaPx <= 0.001) return c;

  float s = max(sigmaPx, 0.001);

  // Gaussian weights for radius 1 and 2 pixels
  float w0 = 1.0;
  float w1 = exp(-(1.0*1.0) / (2.0*s*s));
  float w2 = exp(-(2.0*2.0) / (2.0*s*s));

  float sum = c * w0;
  float wsum = w0;

  // radius 1
  vec2 o1 = px * 1.0;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2( o1.x, 0.0)).rgb)) * w1;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2(-o1.x, 0.0)).rgb)) * w1;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2(0.0,  o1.y)).rgb)) * w1;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2(0.0, -o1.y)).rgb)) * w1;
  wsum += 4.0 * w1;

  // radius 2
  vec2 o2 = px * 2.0;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2( o2.x, 0.0)).rgb)) * w2;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2(-o2.x, 0.0)).rgb)) * w2;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2(0.0,  o2.y)).rgb)) * w2;
  sum += lumaLin(toLinear(texture2D(tDiffuse, uv + vec2(0.0, -o2.y)).rgb)) * w2;
  wsum += 4.0 * w2;

  return sum / wsum;
}

// ---- signed derivatives of blurred luminance ----
// step grows a little with sigma so Edge Smooth also “thickens” edges like Sapphire
vec2 deriv(vec2 uv, float sigmaPx) {
  vec2 px = 1.0 / resolution;

  float stepPx = 1.0 + 0.35 * clamp(sigmaPx, 0.0, 50.0);
  vec2 st = px * stepPx;

  float Lp = blurLuma(uv + vec2(st.x, 0.0), sigmaPx);
  float Ln = blurLuma(uv - vec2(st.x, 0.0), sigmaPx);
  float Up = blurLuma(uv + vec2(0.0, st.y), sigmaPx);
  float Un = blurLuma(uv - vec2(0.0, st.y), sigmaPx);

  // central difference (signed)
  return vec2(Lp - Ln, Up - Un);
}

// ---- subpixel smoothing (reduces shimmer) ----
vec2 derivSubpixel(vec2 uv, float sigmaPx, float enabled) {
  if (enabled < 0.5 || sigmaPx <= 0.0) return deriv(uv, sigmaPx);

  vec2 px = 1.0 / resolution;
  vec2 j = px * 0.35;

  vec2 d0 = deriv(uv + vec2(-j.x, -j.y), sigmaPx);
  vec2 d1 = deriv(uv + vec2( j.x, -j.y), sigmaPx);
  vec2 d2 = deriv(uv + vec2(-j.x,  j.y), sigmaPx);
  vec2 d3 = deriv(uv + vec2( j.x,  j.y), sigmaPx);

  return 0.25 * (d0 + d1 + d2 + d3);
}

void main() {
  float sigma = clamp(Edge_Smooth, 0.0, 50.0);

  // blurred derivatives
  vec2 d = derivSubpixel(vUvScaled, sigma, Subpixel_Smooth);

  // rotate mapping (Rotate Colors)
  d = rot2(d, Rotate_Colors);

  // directional energies (Sapphire-like split)
  float eR = max( d.x, 0.0);
  float eL = max(-d.x, 0.0);
  float eT = max( d.y, 0.0);
  float eB = max(-d.y, 0.0);

  float eSum = eR + eL + eT + eB;

  // --- Sapphire-ish edge alpha curve ---
  // Auto-normalize: larger sigma reduces derivative magnitude; compensate.
  // Also suppress tiny texture edges by using a soft knee.
  float norm = (0.06 + 0.012 * sigma);   // tuned so sigma~5 behaves like Sapphire-ish thickness
  float x = eSum / max(norm, 1e-6);

  // Soft knee + exponential roll-in to get “rim” look (not thin white lines)
  float a = 1.0 - exp(-x);
  a = smoothstep(0.10, 0.95, a);

  // Directional color blend (diagonals blend smoothly)
  float n = max(eSum, 1e-6);
  vec3 dirCol =
      Right  * (eR / n) +
      Left   * (eL / n) +
      Top    * (eT / n) +
      Bottom * (eB / n);

  vec3 edgeCol = dirCol * max(Brightness, 0.0);

  // Composite edges over Background (matches AE look in your screenshot)
  vec3 outLin = toLinear(Background) + toLinear(edgeCol) * a;

  // Gentle highlight compression to avoid harsh clipping
  outLin = outLin / (1.0 + outLin);

  vec3 outRgb = toGamma(outLin);

  gl_FragColor = vec4(clamp(outRgb, 0.0, 1.0), 1.0);
}
