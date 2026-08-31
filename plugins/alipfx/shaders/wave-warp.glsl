precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;

// ---- Custom properties (Dynamic Number in Panzoid) ----
uniform float Wave_Type;       // 0..8 (int values)
uniform float Wave_Height;     // pixels
uniform float Wave_Width;      // pixels
uniform float Direction;       // degrees
uniform float Wave_Speed;      // cycles/sec-ish
uniform float Pinning;         // 0..8 (int values)
uniform float Phase;           // degrees
uniform float Antialiasing;    // 0 Low, 1 Medium, 2 High
uniform float time;            // seconds

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

// -------------------- Noise helpers --------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float noise1D_step(float x) {
  float i = floor(x);
  return hash11(i) * 2.0 - 1.0;
}

float noise1D_smooth(float x) {
  float i = floor(x);
  float f = fract(x);
  float a = hash11(i);
  float b = hash11(i + 1.0);
  float u = f * f * (3.0 - 2.0 * f);
  return (mix(a, b, u) * 2.0 - 1.0);
}

// -------------------- Wave shapes --------------------
// ph = radians, coordForNoise = cycles coordinate
float waveShape(float ph, int wType, int aa, float coordForNoise) {
  float s = sin(ph);
  float u = fract(ph / TAU); // 0..1

  // constant smoothing for Square when AA > 0 (no derivatives allowed)
  float k = 0.0;
  if (aa == 1) k = 0.015;   // medium smooth
  if (aa == 2) k = 0.030;   // high smooth

  if (wType == 0) {
    // Sine
    return s;
  } else if (wType == 1) {
    // Square (softened slightly if AA enabled)
    if (aa == 0) return sign(s);
    return smoothstep(-k, k, s) * 2.0 - 1.0;
  } else if (wType == 2) {
    // Triangle: 2/pi * asin(sin(x))
    return (2.0 / PI) * asin(clamp(s, -1.0, 1.0));
  } else if (wType == 3) {
    // Sawtooth: ramp -1..1
    return u * 2.0 - 1.0;
  } else if (wType == 4) {
    // Circle: alternating semicircle arcs (+ then -)
    float halfSign = (u < 0.5) ? 1.0 : -1.0;
    float uh = fract(u * 2.0);      // 0..1 within half
    float x  = uh * 2.0 - 1.0;      // -1..1
    float y  = sqrt(max(0.0, 1.0 - x*x)); // 0..1
    return y * halfSign;            // -1..1
  } else if (wType == 5) {
    // Semicircle: repeating humps, mapped to -1..1
    float x = u * 2.0 - 1.0;              // -1..1
    float y = sqrt(max(0.0, 1.0 - x*x));  // 0..1
    return y * 2.0 - 1.0;
  } else if (wType == 6) {
    // Uncircle: inverted circle-ish, signed by half
    float halfSign = (u < 0.5) ? 1.0 : -1.0;
    float uh = fract(u * 2.0);
    float x  = uh * 2.0 - 1.0;
    float y  = sqrt(max(0.0, 1.0 - x*x));
    float inv = 1.0 - y;
    return (inv * 2.0 - 1.0) * halfSign;
  } else if (wType == 7) {
    // Noise (stepped)
    return noise1D_step(coordForNoise);
  } else {
    // Smooth Noise
    return noise1D_smooth(coordForNoise);
  }
}

// -------------------- Pinning --------------------
float pinFactor(vec2 uv, vec2 n, int pinMode) {
  if (pinMode == 0) return 1.0;

  float left   = uv.x;
  float right  = 1.0 - uv.x;
  float bottom = uv.y;
  float top    = 1.0 - uv.y;

  if (pinMode == 1) {
    float e = min(min(left, right), min(top, bottom));
    return clamp(e * 2.0, 0.0, 1.0);
  }
  if (pinMode == 3) return clamp(left,   0.0, 1.0);
  if (pinMode == 5) return clamp(right,  0.0, 1.0);
  if (pinMode == 6) return clamp(bottom, 0.0, 1.0);
  if (pinMode == 4) return clamp(top,    0.0, 1.0);

  if (pinMode == 7) {
    float e = min(top, bottom);
    return clamp(e * 2.0, 0.0, 1.0);
  }
  if (pinMode == 8) {
    float e = min(left, right);
    return clamp(e * 2.0, 0.0, 1.0);
  }

  // Center pinning along displacement axis
  vec2 p = uv * resolution;
  float proj = dot(p, n);

  float W = resolution.x;
  float H = resolution.y;
  float a = W * n.x;
  float b = H * n.y;
  float mn = min(0.0, min(a, min(b, a + b)));
  float mx = max(0.0, max(a, max(b, a + b)));

  float t = (mx > mn) ? ((proj - mn) / (mx - mn)) : 0.5;
  float d = abs(t - 0.5) * 2.0; // 0 at center, 1 at edges
  return clamp(d, 0.0, 1.0);
}

// -------------------- AA sampling --------------------
vec4 sampleLayerAA(vec2 uv, int aa) {
  // outside -> transparent (matches AE feel)
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return vec4(0.0);
  }

  vec2 px = 0.5 / resolution;

  if (aa == 0) {
    return texture2D(tDiffuse, uv * uvScale);
  }

  if (aa == 1) {
    vec4 c0 = texture2D(tDiffuse, (uv + vec2(-px.x, -px.y)) * uvScale);
    vec4 c1 = texture2D(tDiffuse, (uv + vec2( px.x, -px.y)) * uvScale);
    vec4 c2 = texture2D(tDiffuse, (uv + vec2(-px.x,  px.y)) * uvScale);
    vec4 c3 = texture2D(tDiffuse, (uv + vec2( px.x,  px.y)) * uvScale);
    return (c0 + c1 + c2 + c3) * 0.25;
  }

  // aa == 2
  vec4 sum = vec4(0.0);
  sum += texture2D(tDiffuse, (uv + vec2(-px.x, -px.y)) * uvScale);
  sum += texture2D(tDiffuse, (uv + vec2( 0.0, -px.y)) * uvScale);
  sum += texture2D(tDiffuse, (uv + vec2( px.x, -px.y)) * uvScale);

  sum += texture2D(tDiffuse, (uv + vec2(-px.x,  0.0)) * uvScale);
  sum += texture2D(tDiffuse, (uv + vec2( 0.0,  0.0)) * uvScale);
  sum += texture2D(tDiffuse, (uv + vec2( px.x,  0.0)) * uvScale);

  sum += texture2D(tDiffuse, (uv + vec2(-px.x,  px.y)) * uvScale);
  sum += texture2D(tDiffuse, (uv + vec2( 0.0,  px.y)) * uvScale);
  sum += texture2D(tDiffuse, (uv + vec2( px.x,  px.y)) * uvScale);

  return sum / 9.0;
}

// -------------------- Main --------------------
void main() {
  vec2 uv = vUv;

  int wType = int(floor(Wave_Type + 0.5));
  int pin   = int(floor(Pinning + 0.5));
  int aa    = int(floor(Antialiasing + 0.5));

  float wWidth = max(Wave_Width, 0.0001);

  // 0° = right, 90° = up
  float ang = radians(Direction);
  vec2 d = vec2(cos(ang), sin(ang));  // travel axis
  vec2 n = vec2(-d.y, d.x);           // displacement axis

  vec2 p = uv * resolution;           // pixel position
  float coord = dot(p, d);            // pixels along travel axis

  float phaseCycles = Phase / 360.0;
  float cycles = (coord / wWidth) + (time * Wave_Speed) + phaseCycles;
  float ph = cycles * TAU;

  float w = waveShape(ph, wType, aa, cycles);

  float pinF = pinFactor(uv, n, pin);
  float dispPx = w * Wave_Height * pinF;

  vec2 uvWarp = uv + (dispPx * n) / resolution;

  gl_FragColor = sampleLayerAA(uvWarp, aa);
}
