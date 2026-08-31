precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

// ---- Custom properties ----
uniform float Type;     // 0..5
uniform float Amount;   // -100..100 (AE default)
uniform float Quality;  // 0..100
uniform vec2 Center;    // pixels, AE-style: (x from left, y from top)

// ---------- Helpers ----------
vec2 clamp01(vec2 uv) { return clamp(uv, vec2(0.0), vec2(1.0)); }

// Convert unscaled UV -> correctly scaled buffer UV (Panzoid mapping)
vec4 sampleTex(vec2 uvUnscaled) {
  vec2 uvScaled = clamp01(uvUnscaled) * uvScale;
  return texture2D(tDiffuse, uvScaled);
}

vec2 rot(vec2 v, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Tiny deterministic jitter to reduce banding at low Quality
float hash12(vec2 p) {
  // p in pixels for stability
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

void main() {
  // Recover unscaled UV (0..1) from Panzoid's scaled varying. [2](https://panzoid.com/community/official/37192?c=3)
  vec2 uv = vUvScaled / uvScale;

  vec4 base = sampleTex(uv);

  // If no blur
  if (abs(Amount) <= 0.00001 || Quality <= 0.0) {
    gl_FragColor = base;
    return;
  }

  // AE-style center: pixels with origin at top-left.
  // Convert to bottom-left origin used by UV math.
  vec2 cPx = vec2(Center.x, resolution.y - Center.y);

  // Current pixel position
  vec2 pPx = uv * resolution;

  vec2 d = pPx - cPx;
  float r = length(d);
  vec2 dir = (r > 1e-6) ? (d / r) : vec2(0.0);

  // Normalized radius for fade styles
  float maxR = length(resolution); // diagonal
  float rNorm = clamp(r / maxR, 0.0, 1.0);

  // Quality -> sample count:
  // Cycore describes Quality as smoothness/steps (higher = fewer visible steps). [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)
  // Map 0..100 => 1..64 samples (practical + close to AE feel).
  int q = int(clamp(1.0 + Quality * 0.63, 1.0, 64.0));

  // Interpreting Amount:
  // Zoom strength in [-1..1]
  float zoomK = clamp(Amount / 100.0, -1.0, 1.0);

  // Rotate amount treated as degrees (Cycore: Amount controls degree & direction). [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)
  float angMax = radians(Amount);

  int t = int(floor(Type + 0.5));

  vec4 acc = vec4(0.0);
  float wSum = 0.0;

  float j = hash12(pPx); // stable per-pixel jitter

  // Fixed loop bound for WebGL shader compilers
  const int MAX_SAMPLES = 64;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= q) break;

    // stratified sample in (0..1), jittered to reduce banding
    float ft = (float(i) + 0.5 + (j - 0.5)) / float(q); // ~0..1

    // Default weight
    float w = 1.0;

    // ---------------- ZOOM TYPES ----------------
    if (t == 0) {
      // 0 Straight Zoom:
      // "Radiates out from the center point with constant length." [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)[4](https://www.163.com/dy/article/JPIDOT1V0536FE6V.html)
      // Sample along the line from the pixel toward/away from center.
      // At Amount=+100, ft=1 -> sample reaches center (strong AE-like max).
      vec2 srcPx = pPx - d * (zoomK * ft);
      acc += sampleTex(srcPx / resolution);
      wSum += 1.0;
    }
    else if (t == 1) {
      // 1 Fading Zoom:
      // Like Straight Zoom, but fades out toward the edges. [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)[4](https://www.163.com/dy/article/JPIDOT1V0536FE6V.html)
      float edgeFade = 1.0 - rNorm;        // strongest near center
      w = edgeFade;
      vec2 srcPx = pPx - d * (zoomK * ft);
      acc += sampleTex(srcPx / resolution) * w;
      wSum += w;
    }
    else if (t == 2) {
      // 2 Centered Zoom:
      // "Radiates in and out equally" and feels like zooming without moving the layer. [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)[4](https://www.163.com/dy/article/JPIDOT1V0536FE6V.html)
      // Symmetric samples around the current pixel along radial direction.
      vec2 off = d * (zoomK * ft);
      vec2 srcA = (pPx - off) / resolution;
      vec2 srcB = (pPx + off) / resolution;

      acc += sampleTex(srcA) * 0.5;
      acc += sampleTex(srcB) * 0.5;
      wSum += 1.0;
    }

    // ---------------- ROTATION TYPES ----------------
    else if (t == 3) {
      // 3 Rotate:
      // Positive = clockwise in AE per Cycore docs; math positive is CCW, so invert. [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)[4](https://www.163.com/dy/article/JPIDOT1V0536FE6V.html)
      float a = -angMax * ft;
      vec2 srcPx = cPx + rot(d, a);
      acc += sampleTex(srcPx / resolution);
      wSum += 1.0;
    }
    else if (t == 4) {
      // 4 Scratch:
      // "Back and forth evenly in both directions." [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)[4](https://www.163.com/dy/article/JPIDOT1V0536FE6V.html)
      float a = abs(angMax) * ft;

      vec2 src1 = (cPx + rot(d,  a)) / resolution;
      vec2 src2 = (cPx + rot(d, -a)) / resolution;

      acc += sampleTex(src1) * 0.5;
      acc += sampleTex(src2) * 0.5;
      wSum += 1.0;
    }
    else if (t == 5) {
      // 5 Rotate Fading:
      // Rotate, but "fading circles" (fades toward edges / along trail). [1](http://www.cycorefx.com/downloads/cfx_hd_std/CycoreFX%20HD%201.7.1%20Manual.pdf)[4](https://www.163.com/dy/article/JPIDOT1V0536FE6V.html)
      float edgeFade = 1.0 - rNorm;
      float trailFade = 1.0 - ft;
      w = edgeFade * trailFade;

      float a = -angMax * ft;
      vec2 srcPx = cPx + rot(d, a);

      acc += sampleTex(srcPx / resolution) * w;
      wSum += w;
    }
    else {
      // Unknown type -> just output base
      acc += base;
      wSum += 1.0;
    }
  }

  vec4 outCol = acc / max(wSum, 1e-6);
  gl_FragColor = outCol;
}
