precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---- Controls ----
uniform float Transition_Dir;   // 0=Wipe Off to Bg, 1=Wipe On from Bg
uniform float Auto_Trans;       // 0=use Wipe%, 1=use time (0..1)
uniform float Wipe_Percent;     // 0..100

uniform float Cells;            // 0=Shrink, 1=Grow
uniform float Edge_Softness;    // pixels
uniform float Frequency;        // density
uniform float Rel_Width;        // horizontal stretch
uniform float Seed;             // pattern seed
uniform vec2  Shift_XY;         // pixels

uniform float Grad_Add;         // set 0 for “all at once across screen”
uniform float Grad_Angle;       // degrees

uniform float Border_Width;     // pixels
uniform vec3  Border_Color;     // rgb
uniform float Border_Opacity;   // 0..1
uniform float Border_Shift;     // pixels
uniform float Border_Softness;  // pixels

// Custom property (Dynamic Number) named "time"
uniform float time;

// ---- Helpers ----
float saturate(float x) { return clamp(x, 0.0, 1.0); }

float hash12(vec2 p, float seed) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33 + seed * 0.01);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p, float seed) {
  float n = hash12(p, seed);
  return vec2(n, hash12(p + 17.17, seed));
}

void voronoi(in vec2 x, out float d1, out float d2, out vec2 cellId) {
  vec2 n = floor(x);
  vec2 f = fract(x);

  float best1 = 1e9;
  float best2 = 1e9;
  vec2  bestId = vec2(0.0);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = n + g;

      vec2 o = hash22(id, Seed);
      vec2 r = g + o - f;
      float d = dot(r, r);

      if (d < best1) {
        best2 = best1;
        best1 = d;
        bestId = id;
      } else if (d < best2) {
        best2 = d;
      }
    }
  }

  d1 = sqrt(best1);
  d2 = sqrt(best2);
  cellId = bestId;
}

void main() {
  // Foreground input (Panzoid sampling uses vUvScaled) [1](https://docs.unity3d.com/6000.3/Documentation/Manual/SL-UnityShaderVariables.html)
  vec4 fg = texture2D(tDiffuse, vUvScaled);

  // Progress source: manual vs auto
  float manualP = saturate(Wipe_Percent / 100.0);
  float autoP   = saturate(time);                 // you drive 0..1
  float useAuto = step(0.5, Auto_Trans);
  float p = mix(manualP, autoP, useAuto);

  // Gradient timing
  // Gradient timing
  float ang = radians(Grad_Angle);
  vec2 gdir = vec2(cos(ang), sin(ang));
  float gcoord = dot((vUv - 0.5), gdir);

  // FIX 1: Remap the progress range to accommodate the gradient's maximum offset.
  // This ensures the wipe naturally starts completely off-screen at 0% 
  // and finishes completely off-screen at 100%, avoiding the abrupt snap.
  float maxOffset = 0.5 * abs(Grad_Add);
  float p_mapped = mix(-maxOffset, 1.0 + maxOffset, p);

  // FIX 2: Calculate prog using the mapped progress and REMOVE saturate(). 
  // Letting the value drop below 0.0 or exceed 1.0 allows the math further down 
  // (like edgeD) to correctly push the border boundaries entirely off the screen.
  float prog = p_mapped + Grad_Add * gcoord;

  // Pattern space
  vec2 shiftUV = Shift_XY / max(resolution, vec2(1.0));
  vec2 uvPat = vUv + shiftUV;
  uvPat.x *= max(Rel_Width, 1e-4);

  float freq = max(Frequency, 1e-4);
  vec2 x = uvPat * freq;

  // Voronoi
  float d1, d2;
  vec2 cid;
  voronoi(x, d1, d2, cid);

  // Cell interior factor
  float borderDist = 0.5 * (d2 - d1);
  float centerFactor = saturate(borderDist / (borderDist + d1 + 1e-6));

  // Grow/Shrink progression (SYNC across all cells)
  float grow = step(0.5, Cells);
  float shape = mix(centerFactor, 1.0 - centerFactor, grow);

  // Convert pixel softness to progress-domain softness
  float minRes = max(1.0, min(resolution.x, resolution.y));
  float soft = (Edge_Softness * freq) / minRes;

  // ---- Matte for the actual wipe ----
  float wipeSoft = max(soft, 1e-6);
  float m = smoothstep(shape - wipeSoft, shape + wipeSoft, prog);

  // Force endpoints so Wipe%=100 completes everywhere
  float eps = 1e-5;
  if (p <= eps) m = 0.0;
  if (p >= 1.0 - eps) m = 1.0;

  // ---- Separate matte just for "edge activity" (so border works when Edge_Softness=0) ----
  float onePx = (1.0 * freq) / minRes;          // ~1px in progress domain
  float lifeSoft = max(wipeSoft, onePx);

  float mLife = smoothstep(shape - lifeSoft, shape + lifeSoft, prog);
  if (p <= eps) mLife = 0.0;
  if (p >= 1.0 - eps) mLife = 1.0;

  // Transition Dir -> alpha wipe (Background=None)
  float dir = step(0.5, Transition_Dir);
  float wipeAlpha = mix(1.0 - m, m, dir);

  vec4 outCol = fg;
  outCol.a *= wipeAlpha;

  // ---- BORDER (like the previous code) ----
  // Uses a band around the edge location: (prog ~= shape), plus an "active" gate.
  float bw = (Border_Width * freq) / minRes;
  float bs = (Border_Softness * freq) / minRes;
  float bshift = (Border_Shift * freq) / minRes;

  float borderMask = 0.0;
  if (Border_Opacity > 0.0 && Border_Width > 0.0) {
    // Edge where the wipe boundary is
    float edgeD = abs((prog - shape) - bshift);

    float inner = max(bw - bs, 0.0);
    float outer = bw + bs;
    borderMask = 1.0 - smoothstep(inner, outer, edgeD);

    // "Active" gate (THIS is what made the previous border look right):
    // Keeps the border riding the transition band instead of showing everywhere.
    float active = 1.0 - smoothstep(0.5 + lifeSoft * 3.0,
                                    0.5 + lifeSoft * 6.0,
                                    abs(mLife - 0.5));
    borderMask *= active;
  }

  // Natural disappearance: as the transition finishes, mLife -> 1 everywhere, so active -> 0.
  float bA = saturate(Border_Opacity) * borderMask;

  outCol.rgb = mix(outCol.rgb, Border_Color, bA);
  outCol.a   = max(outCol.a, bA);

  gl_FragColor = outCol;
}
