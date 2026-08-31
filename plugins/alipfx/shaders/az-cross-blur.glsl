// CC Cross Blur — Panzoid CM3 (GLSL ES 1.0)
// Fixed loop index GLSL ES constraints (no non-constant loop init)

precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

uniform float RadiusX;
uniform float RadiusY;
uniform int Transfer_Mode;      // 0 Blend, 1 Add, 2 Screen, 3 Multiply, 4 Lighten, 5 Darken
uniform int Repeat_Edge_Pixels; // 0 Off, 1 On

const int MAX_TAPS = 31; // must be odd and constant
const int HALF_TAPS = MAX_TAPS / 2;

// Sample with optional edge repeat
vec4 sampleTex(vec2 uv) {
  if (Repeat_Edge_Pixels == 1) {
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    return texture2D(tDiffuse, uv);
  } else {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return texture2D(tDiffuse, uv);
  }
}

// Blur along axis dir (in pixel units: (1,0) or (0,1))
vec4 blurAxis(vec2 uv, vec2 dir, float radius) {
  if (radius <= 0.0) return sampleTex(uv);

  float sigma = max(radius * 0.5, 0.0001);
  float twoSigma2 = 2.0 * sigma * sigma;

  vec4 sum = vec4(0.0);
  float total = 0.0;

  // iterate over a fixed, constant range to satisfy GLSL ES
  for (int i = 0; i < MAX_TAPS; ++i) {
    int idx = i - HALF_TAPS; // can be negative
    float fi = float(idx);

    // skip samples outside the desired radius to reduce work
    if (abs(fi) > ceil(radius)) continue;

    float w = exp(-(fi * fi) / twoSigma2);
    vec2 offset = dir * fi / resolution;
    sum += sampleTex(uv + offset) * w;
    total += w;
  }

  if (total <= 0.0) return sampleTex(uv);
  return sum / total;
}

// Blend/transfer modes
vec4 transfer(vec4 a, vec4 b) {
  if (Transfer_Mode == 1) {
    // Add
    return min(a + b, vec4(1.0));
  } else if (Transfer_Mode == 2) {
    // Screen
    return vec4(1.0) - (vec4(1.0) - a) * (vec4(1.0) - b);
  } else if (Transfer_Mode == 3) {
    // Multiply
    return a * b;
  } else if (Transfer_Mode == 4) {
    // Lighten
    return max(a, b);
  } else if (Transfer_Mode == 5) {
    // Darken
    return min(a, b);
  }
  // default Blend (average)
  return (a + b) * 0.5;
}

void main() {
  vec2 uv = vUvScaled;

  vec4 blurX = blurAxis(uv, vec2(1.0, 0.0), max(0.0, RadiusX));
  vec4 blurY = blurAxis(uv, vec2(0.0, 1.0), max(0.0, RadiusY));

  gl_FragColor = transfer(blurX, blurY);
}
