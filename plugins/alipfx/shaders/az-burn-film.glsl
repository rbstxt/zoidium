precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUvScaled;

// --- Panzoid properties ---
uniform float Burn;           // 0..100
uniform vec2  Center;         // pixels, top-left origin (AE-like)
uniform float Random_Seed;    // any float

// ------------------------------------------------------------
// Hash / Noise
// ------------------------------------------------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  float n = hash12(p);
  return vec2(n, hash12(p + n + 17.13));
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * valueNoise(p);
    p = p * 2.03 + 19.19;
    a *= 0.5;
  }
  return v;
}

float voronoi(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float md = 10.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      md = min(md, d);
    }
  }
  return sqrt(md);
}

// Soft circular kernel (gaussian-ish)
float kernel(vec2 x, float r) {
  float dd = dot(x, x);
  return exp(-dd / (r * r + 1e-4));
}

// ------------------------------------------------------------

void main() {
  vec2 uv = vUvScaled;

  // Center: AE-like pixels from TOP-LEFT -> flip Y for UV space
  vec2 centerPx = vec2(Center.x, resolution.y - Center.y);
  vec2 center = (centerPx / resolution) * uvScale;

  // Aspect-correct space
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (uv - center) * aspect;

  // Normalize distance 0..1 using farthest corner
  vec2 c0 = (vec2(0.0, 0.0) - center) * aspect;
  vec2 c1 = (vec2(uvScale.x, 0.0) - center) * aspect;
  vec2 c2 = (vec2(0.0, uvScale.y) - center) * aspect;
  vec2 c3 = (vec2(uvScale.x, uvScale.y) - center) * aspect;
  float maxD = max(max(length(c0), length(c1)), max(length(c2), length(c3)));
  maxD = max(maxD, 1e-4);

  float d = length(p) / maxD;

  // Burn progress
  float t = clamp(Burn / 100.0, 0.0, 1.0);
  t = pow(t, 1.12);

  // Cinematic ramps:
  float smokeRamp = smoothstep(0.020, 0.120, t);
  float bigRamp   = smoothstep(0.060, 0.240, t);
  float smallRamp = smoothstep(0.160, 0.420, t);

  // Seed
  float seed = Random_Seed * 31.73 + 17.17;

  // Pattern space
  vec2 q = p + vec2(seed * 0.01, seed * 0.013);

  // -----------------------------------------
  // CHAINED ignition cluster (2–3 sparks)
  // -----------------------------------------
  // Tightness of the cluster (smaller = closer sparks)
  float cluster = 0.10;

  // Three nearby offsets (seeded)
  vec2 j1 = (hash22(vec2(seed + 11.1, seed * 0.31)) - 0.5) * cluster;
  vec2 j2 = (hash22(vec2(seed + 27.7, seed * 0.57)) - 0.5) * cluster;
  vec2 j3 = (hash22(vec2(seed + 49.4, seed * 0.93)) - 0.5) * cluster;

  // Slightly correlated positions so they're "nearby"
  vec2 ign1 = p - j1;
  vec2 ign2 = p - (j1 * 0.55 + j2 * 0.85);
  vec2 ign3 = p - (j1 * 0.65 + j3 * 0.90);

  // Spark size grows early (heat-up)
  float ignGrow = smoothstep(0.020, 0.190, t);
  float r1 = mix(0.020, 0.28, ignGrow);
  float r2 = mix(0.018, 0.24, ignGrow);
  float r3 = mix(0.016, 0.22, ignGrow);

  // ✅ CHAIN gates (the key feature)
  // Spark1 first, then Spark2, then Spark3
  float g1 = smoothstep(0.020, 0.080, t);
  float g2 = smoothstep(0.060, 0.140, t);
  float g3 = smoothstep(0.100, 0.200, t);

  // Also ensure absolute zero at the very beginning
  float baseGate = smoothstep(0.012, 0.070, t);

  // Kernels (two strong, one weaker) multiplied by chain gates
  float k1 = kernel(ign1, r1) * 1.00 * g1;
  float k2 = kernel(ign2, r2) * 0.95 * g2;
  float k3 = kernel(ign3, r3) * 0.70 * g3;

  // Use max so you see distinct sparks rather than averaging them
  float ignition = max(k1, max(k2, k3));
  ignition = clamp(ignition, 0.0, 1.0) * baseGate;

  // This controls how long it stays localized before spreading globally
  float spread = smoothstep(0.180, 0.620, t);
  float localize = mix(ignition, 1.0, spread);

  // -----------------------------
  // Two-scale holes (big + small)
  // -----------------------------
  float vBig   = voronoi(q * 5.6  + seed * 1.31);
  float vSmall = voronoi(q * 13.5 + seed * 2.07);

  float cellsBig   = 1.0 - smoothstep(0.22, 0.78, vBig);
  float cellsSmall = 1.0 - smoothstep(0.12, 0.64, vSmall);

  float n1 = fbm(q * 10.0 + seed * 0.21);
  float n2 = fbm(q * 22.0 + seed * 0.47);

  float bigMask = smoothstep(0.38, 0.95, cellsBig) * (0.55 + 0.45 * n1);
  bigMask = pow(clamp(bigMask, 0.0, 1.0), 1.25) * bigRamp;

  float smallMask = smoothstep(0.28, 0.95, cellsSmall) * (0.60 + 0.40 * n2);
  smallMask = pow(clamp(smallMask, 0.0, 1.0), 1.05) * smallRamp;

  float holePattern = clamp(bigMask * 0.85 + smallMask * 0.55, 0.0, 1.0);

  // Hole boost (localized early, global later)
  float holeBoost = (bigMask * bigMask) * 0.28 + (smallMask * smallMask) * 0.18;
  holeBoost *= (0.65 + 0.35 * n1);
  holeBoost *= localize;

  // -----------------------------
  // Bands (fixed)
  // -----------------------------
  float preW  = 0.095;
  float edgeW = 0.055;
  float holeW = 0.032;

  float field = d - holeBoost;

  // Guarantee full wipe at 100%
  float eps = 1e-4;
  field = clamp(field, 0.0, 1.0 - holeW - eps);

  // Derivative-free smoothing based on pixel size
  float px = 1.0 / min(resolution.x, resolution.y);
  float fw = px * 4.8;

  float preW2  = preW  + fw;
  float edgeW2 = edgeW + fw;
  float holeW2 = holeW + fw * 0.85;

  // Burn=0 clean
  float preA  = max(field - preW2,  0.0);
  float preB  = max(field,          eps);
  float edgeA = max(field - edgeW2, 0.0);
  float edgeB = max(field,          eps);

  // Smoke is localized early, then spreads
  float pre  = smoothstep(preA, preB, t) * smokeRamp * (0.35 + 0.65 * localize);

  float edge = smoothstep(edgeA, edgeB, t) - smoothstep(field, field + edgeW2, t);
  edge = clamp(edge, 0.0, 1.0) * baseGate;

  float burned = smoothstep(field, field + holeW2, t);

  // ---------------------------------
  // Smoke trails: big + small
  // ---------------------------------
  vec2 dir  = normalize(p + vec2(1e-4, 0.0));
  vec2 perp = vec2(-dir.y, dir.x);

  float along  = dot(q, dir);
  float across = dot(q, perp);

  vec2 trailBigUV = vec2(along * 6.6,  across * 1.25) + vec2(seed * 0.09, seed * 0.04);
  float trailBig = fbm(trailBigUV + n1 * 1.35);

  vec2 trailSmallUV = vec2(along * 14.0, across * 3.2) + vec2(seed * 0.13, seed * 0.06);
  float trailSmall = fbm(trailSmallUV + n2 * 1.8);

  float soot = fbm(q * 24.0 + seed * 0.41);

  float smokeBig   = pre * bigMask   * (0.28 + 0.72 * trailBig);
  float smokeSmall = pre * smallMask * (0.18 + 0.82 * trailSmall);

  float ambientSmoke = pre * (0.10 + 0.35 * soot) * (0.35 + 0.65 * n1) * (0.25 + 0.75 * localize);

  float smokeStrength = clamp(smokeBig * 1.05 + smokeSmall * 0.60 + ambientSmoke, 0.0, 1.0);

  float charMask = edge * (0.45 + 0.55 * soot) * (0.50 + 0.50 * holePattern);

  // Sample source with tiny wobble near edge
  vec2 jitter = (hash22(q * 40.0 + seed) - 0.5);
  vec2 wobble = jitter * (0.006 * edge);
  vec4 texel = texture2D(tDiffuse, uv + wobble);

  vec3 rgb = texel.rgb;

  vec3 sootCol = vec3(0.02, 0.02, 0.02);
  vec3 charCol = vec3(0.03, 0.015, 0.01);

  rgb = mix(rgb, sootCol, smokeStrength);
  rgb = mix(rgb, charCol, charMask);

  rgb *= (1.0 - pre  * 0.13);
  rgb *= (1.0 - edge * 0.20);

  // End fade ensures Burn=100 wipes everything
  float endFade = 1.0 - smoothstep(0.985, 1.0, t);

  float rimAlpha = edge * (0.70 + 0.30 * soot);
  float outA = texel.a * clamp((1.0 - burned) + rimAlpha * 0.60, 0.0, 1.0) * endFade;

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), outA);
}
