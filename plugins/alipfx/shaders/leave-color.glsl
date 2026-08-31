precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Panzoid custom properties:
// Number (dynamic): Amount to Decolor
// Color: Color To Leave
// Number (dynamic): Tolerance
// Number (dynamic): Edge Softness
// Number (dynamic): Match Colors
uniform float Amount_to_Decolor; // 0..100
uniform vec3  Color_To_Leave;    // 0..1 RGB
uniform float Tolerance;         // 0..100
uniform float Edge_Softness;     // 0..100
uniform float Match_Colors;      // 0 = RGB, 1 = Hue

const float SQRT3 = 1.73205080757;
const float EPS   = 1e-6;

// Rec.709 / AE-like grayscale weighting
float luminance709(vec3 c)
{
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// RGB -> HSV
vec3 rgb2hsv(vec3 c)
{
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(
    abs(q.z + (q.w - q.y) / (6.0 * d + e)),
    d / (q.x + e),
    q.x
  );
}

// Circular hue distance normalized to 0..1
// 0 = exact same hue, 1 = opposite hue
float hueDistance01(float h1, float h2)
{
  float d = abs(h1 - h2);
  d = min(d, 1.0 - d);
  return d / 0.5;
}

// RGB matching distance normalized to 0..1
float rgbDistance01(vec3 a, vec3 b)
{
  return length(a - b) / SQRT3;
}

// AE-like selection mask from distance
// dist = 0 means exact match
// tol = keep range
// soft = feather outside tol
float selectionMask(float dist, float tol, float soft)
{
  tol  = clamp(tol,  0.0, 1.0);
  soft = clamp(soft, 0.0, 1.0);

  if (soft <= EPS)
  {
    return (dist <= tol) ? 1.0 : 0.0;
  }

  float outer = min(1.0, tol + soft);
  return 1.0 - smoothstep(tol, outer, dist);
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  vec3 src   = texel.rgb;

  // AE-style percent controls
  float amount = clamp(Amount_to_Decolor / 100.0, 0.0, 1.0);
  float tol    = clamp(Tolerance         / 100.0, 0.0, 1.0);
  float soft   = clamp(Edge_Softness     / 100.0, 0.0, 1.0);

  float dist = 0.0;

  // Match Colors:
  // 0 = RGB
  // 1 = Hue
  if (Match_Colors < 0.5)
  {
    // Using RGB:
    // strict, brightness-sensitive, exact shade-sensitive
    dist = rgbDistance01(src, Color_To_Leave);
  }
  else
  {
    // Using Hue:
    // preserves the chosen hue regardless of brightness more effectively
    vec3 hsvSrc    = rgb2hsv(src);
    vec3 hsvTarget = rgb2hsv(Color_To_Leave);

    // If target color has almost no saturation, hue is unreliable.
    // Fall back to RGB matching in that case.
    if (hsvTarget.y < 0.0001)
    {
      dist = rgbDistance01(src, Color_To_Leave);
    }
    else
    {
      float hDist = hueDistance01(hsvSrc.x, hsvTarget.x);

      // Hue becomes unstable on near-gray pixels.
      // This suppresses accidental color retention in low-sat areas.
      float satGate = smoothstep(0.02, 0.10, hsvSrc.y);

      // Unsaturated pixels behave as "non-matching"
      dist = mix(1.0, hDist, satGate);
    }
  }

  // 1.0 = keep original color
  // 0.0 = fully subject to decolor
  float keep = selectionMask(dist, tol, soft);

  // Desaturated version
  float luma = luminance709(src);
  vec3 gray = vec3(luma);

  // At 100% Amount_to_Decolor:
  // matching colors stay color, non-matching colors go grayscale
  vec3 leaveColorResult = mix(gray, src, keep);

  // At 0% Amount_to_Decolor: no change
  // At intermediate values: partial decolor
  vec3 finalColor = mix(src, leaveColorResult, amount);

  gl_FragColor = vec4(finalColor, texel.a);
}
