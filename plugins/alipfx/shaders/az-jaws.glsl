precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---- Panzoid custom properties (dynamic) ----
uniform float Completion; // 0..100
uniform vec2  Center;     // 0..1 (or pixels, auto-detect)
uniform float Direction;  // degrees
uniform float Height;     // 0..100
uniform float Width;      // 2..25 recommended
uniform float Shape;      // 0..3 (0 Spikes, 1 RoboJaw, 2 Block, 3 Waves)

const float PI = 3.14159265358979323846;

// Anti-alias without derivatives
const float AA_MULT = 1.6;

// Bevel tuning (subtle)
const float BEVEL_PIXELS    = 2.0;
const float BEVEL_HIGHLIGHT = 0.08;
const float BEVEL_SHADOW    = 0.10;

// Triangle wave 0..1
float tri01(float x) {
  float f = fract(x);
  return 1.0 - abs(f - 0.5) * 2.0;
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // --- Center supports normalized OR AE pixels ---
  vec2 centerUV = Center;
  if (centerUV.x > 1.5 || centerUV.y > 1.5) {
    centerUV = centerUV / max(resolution, vec2(1.0));
  }

  // --- Clamp Completion like AE ---
  float comp = clamp(Completion, 0.0, 100.0);
  float prog = comp / 100.0;

  // --- Aspect correction so Direction behaves consistently ---
  float aspect = resolution.x / max(1.0, resolution.y);
  vec2 asp = vec2(aspect, 1.0);

  // Position in aspect-corrected space
  vec2 p = (vUv - centerUV) * asp;

  // Direction: 0° = horizontal band, 90° = vertical band
  float ang = radians(Direction);
  vec2 tAxis = normalize(vec2(cos(ang), sin(ang))); // along teeth repetition
  vec2 nAxis = vec2(-tAxis.y, tAxis.x);             // opening axis (perpendicular)

  float t = dot(p, tAxis);
  float n = dot(p, nAxis);

  // --- AA without derivatives ---
  float px = (1.0 / max(1.0, min(resolution.x, resolution.y))) * max(asp.x, asp.y);
  float aa = max(px * AA_MULT, 0.00025);

  // --- Tooth amplitude from Height (CONSTANT, not scaled by Completion) ---
  float h = clamp(Height / 100.0, 0.0, 1.0);
  float compScale = length(asp);
  float amp = h * compScale * 0.35;

  // --- Width density ---
  float w = clamp(Width, 2.0, 25.0);
  float x = (t / (2.0 * compScale)) * w;

  // --- Shape selection ---
  int sh = int(floor(Shape + 0.5));

  // pat in [0..1]
  float pat = 0.0;

  if (sh == 0) {
    // Spikes
    pat = tri01(x);

  } 
else if (sh == 1) {
  // ✅ RoboJaw (stable thickness) — AE-like chunky trapezoids
  // This produces flat TOP + flat BOTTOM (like your AE screenshot),
  // not pointy triangle peaks.

  float flatness = 0.25;   // higher = more blocky (try 0.60..0.90)
  float phase    = 0.00;   // try 0.0 or 0.25 if alignment looks off

  // Triangle wave 0..1
  float tri = tri01(x + phase);

  // Convert flatness into symmetric clipping near 0 and 1
  // flatness=0 -> pure triangle
  // flatness=1 -> almost square wave
  float edge = (1.0 - clamp(flatness, 0.0, 1.0)) * 0.5;

  // Double-clip triangle into trapezoid (flat bottom + flat top)
  pat = clamp((tri - edge) / max(1e-6, (1.0 - 2.0 * edge)), 0.0, 1.0);

  } else if (sh == 2) {
    // Block (AE-style): square-wave steps (no diagonal stairs)
    float f = fract(x + 0.25);
    pat = step(0.5, f);

  } else {
    // Waves
    pat = 0.5 + 0.5 * sin(2.0 * PI * x);
  }

  // --- Convert pat to centered offset [-1..1] ---
  // IMPORTANT: using same offset on BOTH edges keeps thickness constant.
  float patC = (pat - 0.5) * 2.0; // -1..1

  // --- Compute distance to corners so Completion=100 always finishes ---
  vec2 c0 = (vec2(0.0, 0.0) - centerUV) * asp;
  vec2 c1 = (vec2(1.0, 0.0) - centerUV) * asp;
  vec2 c2 = (vec2(0.0, 1.0) - centerUV) * asp;
  vec2 c3 = (vec2(1.0, 1.0) - centerUV) * asp;

  float maxN = max(
    max(abs(dot(c0, nAxis)), abs(dot(c1, nAxis))),
    max(abs(dot(c2, nAxis)), abs(dot(c3, nAxis)))
  );

  // Opening depends ONLY on completion (not on tooth shape)
  float halfGap = prog * (maxN + amp + aa * 2.0 + 1e-4);

  // Stable thickness edges
  float offset = amp * patC;
  float topEdge =  halfGap + offset;
  float botEdge = -halfGap + offset;

  // Mask: inside band becomes transparent
  float inTop = smoothstep(topEdge + aa, topEdge - aa, n);
  float inBot = smoothstep(botEdge - aa, botEdge + aa, n);
  float bandMask = clamp(inTop * inBot, 0.0, 1.0);

  float outA = texel.a * (1.0 - bandMask);

  // --- Subtle bevel on opaque side only ---
  float bevelW = px * BEVEL_PIXELS;

  float topOpaque = step(0.0, n - topEdge);
  float topBevel  = topOpaque * (1.0 - smoothstep(0.0, bevelW, n - topEdge));

  float botOpaque = step(0.0, botEdge - n);
  float botBevel  = botOpaque * (1.0 - smoothstep(0.0, bevelW, botEdge - n));

  vec3 col = texel.rgb;
  col *= (1.0 + BEVEL_HIGHLIGHT * topBevel);
  col *= (1.0 - BEVEL_SHADOW    * botBevel);

  // Perfect endpoints
  if (comp <= 0.0001) outA = texel.a;
  if (comp >= 99.9999) outA = 0.0;

  gl_FragColor = vec4(col, outA);
}
