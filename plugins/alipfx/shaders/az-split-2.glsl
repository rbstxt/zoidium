precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// Panzoid properties (spaces -> underscores)
uniform vec2 Point_A;     // pixels
uniform vec2 Point_B;     // pixels
uniform float Split_1;    // pixels
uniform float Split_2;    // pixels
uniform float Presets;    // 0=Bump 1=Sharp 2=Robotic

// Sample with proper uvScale mapping; transparent outside
vec4 sampleLayer(vec2 uv)
{
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(tDiffuse, uv * uvScale);
}

// Profile preset along the segment (s in 0..1)
float profilePreset(float s, int preset)
{
  float sc = clamp(s, 0.0, 1.0);

  // Triangle: 0 at ends, 1 at center (for Sharp)
  float tri = 1.0 - abs(2.0 * sc - 1.0);
  tri = max(tri, 0.0);

  if (preset == 0) {
    // Bump: smooth rounded hill
    float base = sin(3.14159265 * sc);
    base = max(base, 0.0);
    return pow(base, 2.0);
  }
  else if (preset == 1) {
    // Sharp: pure triangle
    return tri;
  }
  else {
    // Robotic: MORE TRAPEZOID (wider flat top)
    // rampFrac controls ramp width near ends:
    // smaller rampFrac = WIDER flat top (more trapezoid)
    float rampFrac = 0.12;  // <-- was ~0.22, now much more trapezoid

    // Optional robotic stepping along A->B (quantize X)
    float xSteps = 9999.0;    // keep decent resolution so ramps stay straight-ish
    float qx = floor(sc * xSteps + 0.5) / xSteps;

    // Trapezoid: ramp up -> flat -> ramp down
    float leftRamp  = clamp(qx / rampFrac, 0.0, 1.0);
    float rightRamp = clamp((1.0 - qx) / rampFrac, 0.0, 1.0);
    float trap = min(leftRamp, rightRamp); // flat top when qx in [rampFrac .. 1-rampFrac]

    // Optional robotic stepping in height (quantize Y)
    float ySteps = 9999.0;
    trap = floor(trap * ySteps + 0.5) / ySteps;
    trap = min(1.0, trap); // ensure plateau can reach 1.0 cleanly

    return trap;
  }
}

void main()
{
  // --- HARD BYPASS when both splits are effectively zero (prevents seam/strips) ---
  float maxSplit = max(abs(Split_1), abs(Split_2));
  if (maxSplit < 1e-4) {
    gl_FragColor = texture2D(tDiffuse, vUvScaled);
    return;
  }

  vec2 A = Point_A;
  vec2 B = Point_B;

  vec2 d = B - A;
  float L = length(d);

  // Degenerate: A == B
  if (L < 1e-5) {
    gl_FragColor = texture2D(tDiffuse, vUvScaled);
    return;
  }

  // Pixel position
  vec2 p = vUv * resolution;

  // Tangent and normal
  vec2 t = d / L;
  vec2 n = normalize(vec2(-t.y, t.x));

  // Along-segment coordinate
  float u = dot(p - A, t); // 0..L
  float s = u / L;         // 0..1

  // Signed distance to split line
  float distN = dot(p - A, n);
  float absDistN = abs(distN);

  // Clamp presets safely (GLSL ES friendly)
  float pr = clamp(Presets, 0.0, 2.0);
  int preset = int(floor(pr + 0.5)); // 0,1,2

  // Segment mask (inside A..B)
  float segMask = step(0.0, u) * step(u, L);

  // For Bump only: soften ends slightly
  // For Sharp & Robotic: keep crisp ends (helps triangle/trapezoid look)
  if (preset == 0) {
    float taperPx = clamp(0.12 * L, 18.0, 90.0);
    float endMask = smoothstep(0.0, taperPx, u) * smoothstep(0.0, taperPx, (L - u));
    segMask *= endMask;
  }

  // Profile along the segment
  float prof = profilePreset(s, preset) * segMask;

  // CC Split 2: independent split per side of the line
  // distN < 0 uses Split_1, distN > 0 uses Split_2
  float half1 = 0.5 * Split_1 * prof; // negative side
  float half2 = 0.5 * Split_2 * prof; // positive side

  // Local influence away from the split (keeps distortion localized)
  float sigma = max(1.0, maxSplit * 0.65);
  float influence = exp(-absDistN / sigma);

  // Side selection
  float sideSign = (distN >= 0.0) ? 1.0 : -1.0;
  float halfGapSigned = (distN >= 0.0) ? half2 : half1;

  // Inverse warp sample
  float disp = halfGapSigned * influence;
  vec2 sampleUv = (p - n * disp * sideSign) / resolution;

  vec4 col = sampleLayer(sampleUv);

  // --- Asymmetric gap cutout (transparent inside) ---
  // Gap bounds: distN in [-|half1|, +|half2|]
  float g1 = abs(half1);
  float g2 = abs(half2);

  // Anti-alias width (pixels)
  float aa = 1.15;

  float bottomEdge = smoothstep(-g1 - aa, -g1 + aa, distN);
  float topEdge    = smoothstep( g2 - aa,  g2 + aa, distN);

  float insideGap = bottomEdge * (1.0 - topEdge);
  float gapMask = 1.0 - insideGap;

  // Only apply gap within A..B
  gapMask = mix(1.0, gapMask, segMask);

  gl_FragColor = col * gapMask;
}
