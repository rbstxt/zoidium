precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// --- Custom properties ---
uniform float Completion;      // 0..100
uniform float Direction;       // degrees
uniform float Thickness;       // pixels (>=1)
uniform float Slant;           // 0..100  (we’ll remap this)
uniform float Flip_Direction;  // 0 or 1

// AE-like direction mapping (as in your code)
vec2 aeDirVec(float deg)
{
  float a = radians(deg);
  return normalize(vec2(sin(a), -cos(a)));
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // AE-like UV (Y down)
  vec2 uvAE = vec2(vUv.x, 1.0 - vUv.y);

  vec2 pix = uvAE * resolution;
  vec2 center = 0.5 * resolution;
  vec2 p = pix - center;

  float comp = clamp(Completion / 100.0, 0.0, 1.0);

  // Flip = reverse completion
  if (Flip_Direction >= 0.5) comp = 1.0 - comp;

  float thick = max(1.0, Thickness);

  // Motion & perpendicular axes
  vec2 m = aeDirVec(Direction);
  vec2 t = vec2(-m.y, m.x);

  // Corners (centered)
  vec2 c0 = vec2(-center.x, -center.y);
  vec2 c1 = vec2( center.x, -center.y);
  vec2 c2 = vec2(-center.x,  center.y);
  vec2 c3 = vec2( center.x,  center.y);

  // Spans along m and t (used to scale slant properly)
  float vm0 = dot(c0, m), vm1 = dot(c1, m), vm2 = dot(c2, m), vm3 = dot(c3, m);
  float vt0 = dot(c0, t), vt1 = dot(c1, t), vt2 = dot(c2, t), vt3 = dot(c3, t);

  float vMinBase = min(min(vm0, vm1), min(vm2, vm3));
  float vMaxBase = max(max(vm0, vm1), max(vm2, vm3));
  float uMinBase = min(min(vt0, vt1), min(vt2, vt3));
  float uMaxBase = max(max(vt0, vt1), max(vt2, vt3));

  float vSpanBase = max(1.0, (vMaxBase - vMinBase));
  float uSpanBase = max(1.0, (uMaxBase - uMinBase));

  // --- Thickness = stair/step size ---
  float stepSize = thick;
  float u = dot(p, t);
  float uQ = floor(u / stepSize + 0.5) * stepSize;

  // ✅ NEW: Slant remap so Slant=50 feels “long” like AE
  // Slant=0   -> slope = 0
  // Slant=50  -> slope = vSpan/uSpan  (strong diagonal)
  // Slant=100 -> slope = 2*(vSpan/uSpan)
  float slope = (Slant / 50.0) * (vSpanBase / uSpanBase);

  // Optional safety clamp (prevents insane values on extreme aspect ratios)
  slope = clamp(slope, 0.0, 6.0);

  // Position along sweep (slant + quantized steps)
  float proj = dot(p, m) + slope * uQ;

  // Compute min/max proj over corners for normalization (use same slope & quantization)
  float p0 = dot(c0, m) + slope * (floor(dot(c0, t)/stepSize + 0.5) * stepSize);
  float p1 = dot(c1, m) + slope * (floor(dot(c1, t)/stepSize + 0.5) * stepSize);
  float p2 = dot(c2, m) + slope * (floor(dot(c2, t)/stepSize + 0.5) * stepSize);
  float p3 = dot(c3, m) + slope * (floor(dot(c3, t)/stepSize + 0.5) * stepSize);

  float minP = min(min(p0, p1), min(p2, p3));
  float maxP = max(max(p0, p1), max(p2, p3));

  float normPos = (proj - minP) / max(1.0, (maxP - minP));

  // HARD EDGE (no blur)
  float alpha = step(comp, normPos);

  texel.rgb *= alpha;
  texel.a   *= alpha;

  gl_FragColor = texel;
}
