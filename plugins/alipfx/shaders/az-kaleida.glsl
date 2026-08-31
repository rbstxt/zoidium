precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

// Panzoid properties
uniform vec2 Center;            // pixels (AE-style: origin top-left, Y down)
uniform float Size;             // pixels
uniform float Mirroring;        // 0..8 (rounded to int)
uniform float Rotation;         // degrees
uniform float Floating_Center;  // 0 or 1

#define PI 3.14159265358979323846

// 2D rotation matrix
mat2 rot2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

// Mirror-repeat (triangle wave): maps any x to [0..1] with mirrored tiling.
float tri(float x) {
  float f = fract(x);
  return 1.0 - abs(1.0 - 2.0 * f);
}
vec2 tri2(vec2 p) {
  return vec2(tri(p.x), tri(p.y));
}

// --- Mirroring mode helpers ---

// "Flower-ish" fold inside a tile (f in [0..1])
vec2 foldFlower(vec2 f) {
  vec2 s = abs(f - 0.5);     // [0..0.5]
  if (s.y > s.x) s = s.yx;   // fold over diagonal
  return 0.5 + s;
}

// "Wheel" look via quadrant-dependent axis swap
vec2 foldWheel(vec2 f) {
  vec2 s = f - 0.5;
  float qx = step(0.0, s.x);
  float qy = step(0.0, s.y);
  float doSwap = abs(qx - qy);
  s = abs(s);
  vec2 ss = mix(s, s.yx, doSwap);
  return 0.5 + ss;
}

// "Dia Cross" via folding in 45°-rotated space
vec2 foldDiaCross(vec2 f) {
  vec2 s = f - 0.5;
  s = rot2(PI * 0.25) * s;
  vec2 m = tri2(s + 0.5) - 0.5;
  m = rot2(-PI * 0.25) * m;
  return m + 0.5;
}

/*
  Fish-style polar fold:
  - We rotate the FINAL vector output for Can Meas (90° difference).
*/
vec2 foldFish(vec2 f, float outRot) {
  vec2 s = f - 0.5;
  float r = length(s) * 2.0;
  float a = atan(s.y, s.x);

  a = mod(a, PI * 0.5);
  a = abs(a - PI * 0.25);

  r = pow(clamp(r, 0.0, 1.5), 0.85);

  vec2 v = vec2(cos(a), sin(a)) * (0.5 * r);
  v = rot2(outRot) * v;

  return 0.5 + v;
}

// Flipper: rotate every other row 180°
vec2 foldFlipper(vec2 q) {
  vec2 tile = floor(q);
  vec2 f = fract(q);
  float oddRow = mod(tile.y, 2.0);
  if (oddRow > 0.5) f = 1.0 - f;
  return f;
}

// Flip Flop: flip all upside down, mirror alternating columns
vec2 foldFlipFlop(vec2 q) {
  vec2 tile = floor(q);
  vec2 f = fract(q);
  f.y = 1.0 - f.y;
  float oddCol = mod(tile.x, 2.0);
  if (oddCol > 0.5) f.x = 1.0 - f.x;
  return f;
}

// Starlish: denser folding
vec2 foldStarlish(vec2 f) {
  vec2 s = f - 0.5;
  s = rot2(PI / 8.0) * s;
  vec2 g = foldFlower(s + 0.5) - 0.5;
  g = rot2(-PI / 8.0) * g;
  return foldDiaCross(g + 0.5);
}

// Mirroring selector
vec2 mapMirroring(vec2 q, int mode) {
  vec2 f = fract(q);

  if (mode == 0) return tri2(q);                 // Unfold
  if (mode == 1) return foldWheel(f);            // Wheel
  if (mode == 2) return foldFish(f, 0.0);        // Fish Head
  if (mode == 3) return foldFish(f, PI * 0.5);   // Can Meas
  if (mode == 4) return foldFlipFlop(q);         // Flip Flop

  // ✅ FIX: Flower uses straight repeating tile space (AE-like)
  // This makes Size behave "straight" instead of alternating mirrored tiles.
  if (mode == 5) return foldFlower(f);           // Flower (FIXED)

  if (mode == 6) return foldDiaCross(f);         // Dia Cross
  if (mode == 7) return foldFlipper(q);          // Flipper
  if (mode == 8) {                               // Starlish
    vec2 m = tri2(q);
    return foldStarlish(m);
  }

  return f;
}

void main() {
  // Panzoid UV rule: vUvScaled is vUv * uvScale, so undo it for 0..1 UV. [1](https://www.shadertoy.com/)
  vec2 uv = vUvScaled / uvScale;

  float sz = max(Size, 0.0001);

  // Center fix (AE pixels Y-down -> Panzoid UV Y-up)
  vec2 sourceCenterUV = vec2(
    Center.x / resolution.x,
    1.0 - (Center.y / resolution.y)
  );

  // Pivot behavior
  vec2 pivotUV = vec2(0.5);
  if (Floating_Center > 0.5) {
    pivotUV = sourceCenterUV;
  }

  // Pixel offset from pivot
  vec2 p = (uv - pivotUV) * resolution;

  // Tile coordinates (tile center at 0.5)
  vec2 q = (p / sz) + 0.5;

  // Mirroring mode (rounded)
  int mode = int(floor(Mirroring + 0.5));
  mode = int(clamp(float(mode), 0.0, 8.0));

  // Local coordinate in [0..1]
  vec2 local = mapMirroring(q, mode);

  // Convert back into pixel offset inside the tile
  vec2 sampleOffset = (local - 0.5) * sz;

  // Rotate sampled area (degrees → radians)
  sampleOffset = rot2(radians(Rotation)) * sampleOffset;

  // Sample around source center
  vec2 sampleUV = sourceCenterUV + (sampleOffset / resolution);

  // Mirror-repeat outside 0..1
  sampleUV = tri2(sampleUV);

  // Panzoid sampling rule: scale UV back into buffer space using uvScale. [1](https://www.shadertoy.com/)
  vec2 sampleUVScaled = sampleUV * uvScale;

  gl_FragColor = texture2D(tDiffuse, sampleUVScaled);
}
