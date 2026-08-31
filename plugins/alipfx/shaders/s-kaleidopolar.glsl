precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

// 8 properties:
uniform vec2  Center_XY;        // AE-style absolute pixels (top-left origin)
uniform float Z_Dist;           // zoom/depth (result scale)
uniform float Rotate;           // degrees
uniform float Stretch_X;        // result stretch
uniform float Stretch_Y;        // result stretch
uniform float Inside_Shift_Y;   // pixels, positive = outward (as you said)
uniform float Angle_Repeats;    // slices
uniform float Kaleido_Amount;   // strength, can be >1

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

float safeInv(float x) { return 1.0 / max(abs(x), 1e-6); }

void main()
{
  // Base UV in 0..1
  vec2 uv = vUvScaled / uvScale;

  // ---- Center XY (AE pixels, origin TOP-LEFT) -> GL UV origin bottom-left
  vec2 centerUV = vec2(
    Center_XY.x / resolution.x,
    1.0 - (Center_XY.y / resolution.y)
  );

  // Output-space pixel vector from center
  vec2 p = (uv - centerUV) * resolution;

  // ---- Stretch applies to RESULT (output)
  p.x *= safeInv(Stretch_X);
  p.y *= safeInv(Stretch_Y);

  // Polar coords of output
  float r   = length(p);
  float ang = atan(p.y, p.x);          // -PI..PI

  // Rotate the "mirror wheel"
  ang += radians(Rotate);
  ang = mod(ang + TAU, TAU);           // 0..TAU

  // ---- Kaleidoscope sector fold
  float reps = max(Angle_Repeats, 1.0);
  float sector = TAU / reps;
  float halfSector = 0.5 * sector;

  float a = mod(ang, sector);
  a = abs(a - halfSector);             // mirror fold into [0..halfSector]
  float uPolar = a / max(halfSector, 1e-6);  // 0..1

  // ---- Radius normalization base
  // (This is very close to how Sapphire "feels" on 1920x1080. If still off,
  // I’ll give you a 1-line toggle below.)
  float radiusBase = 0.5 * min(resolution.x, resolution.y);

  // ---- Z Dist: >1 = smaller pattern = more repeats (as per your description)
  // ---- Inside Shift Y: positive moves pattern OUTWARD
  // (Outward means increasing shift should push features to larger r, so subtract here.)
  float vPolar = (r * Z_Dist - Inside_Shift_Y) / max(radiusBase, 1e-6);

  // Polar UV that samples the source:
  vec2 uvPolar = vec2(uPolar, vPolar);

  // IMPORTANT: do NOT wrap yet if we want "amount" to extrapolate nicely.
  // We'll warp coords first, then apply wrapping.
  float amt = Kaleido_Amount;

  // ---- This is the key Sapphire-like behavior:
  // Amount blends/extrapolates the UV mapping, not the colors.
  vec2 uvFinal = uv + (uvPolar - uv) * amt;

  // Edge behavior: Sapphire-style tiling (prevents black borders)
  uvFinal = fract(uvFinal);

  // Sample
  gl_FragColor = texture2D(tDiffuse, uvFinal * uvScale);
}
