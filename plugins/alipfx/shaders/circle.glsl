precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

// ----- Custom properties -----
uniform vec2 Center;                 // pixels, AE-style (0,0) top-left
uniform float Radius;                // pixels
uniform float Edge;                  // 0..4
uniform float Edge_Radius;           // pixels (USED ONLY IN EDGE MODE 1)
uniform float Thickness;             // pixels (mode 2), ratio (modes 3/4)
uniform float Feather_Outer_Edge;    // pixels (modes 0..3), ratio (mode 4)
uniform float Feather_Inner_Edge;    // pixels (modes 0..3), ratio (mode 4)
uniform float Invert_Circle;         // 0/1
uniform vec3 Color;                  // 0..1
uniform float Opacity;               // 0..100
uniform float Blending_Mode;         // 0..18

// ---------------- Utility ----------------
float sat(float x) { return clamp(x, 0.0, 1.0); }
vec3  sat3(vec3 v) { return clamp(v, 0.0, 1.0); }

// Convert vUvScaled -> normalized 0..1 UV
vec2 unscaledUv()
{
  return vUvScaled / uvScale;
}

// AE uses top-left origin; GLSL UV uses bottom-left.
// Convert AE pixel center to GLSL pixel space.
vec2 aeCenterToGL(vec2 cPx)
{
  return vec2(cPx.x, resolution.y - cPx.y);
}

// Derivative-free antialias width in pixel-distance space.
float aaPx()
{
  return 1.0;
}

// Ring/fill mask with independent inner/outer feathering (derivative-free)
float ringMask(float distPx, float innerR, float outerR, float featherInnerPx, float featherOuterPx)
{
  float aa = aaPx();

  float fi = max(featherInnerPx, 0.0);
  float fo = max(featherOuterPx, 0.0);

  // Outer edge: 1 inside, fades to 0 outside
  float mOuter = 1.0 - smoothstep(outerR - aa, outerR + fo + aa, distPx);

  // Inner edge:
  // IMPORTANT FIX: if innerR <= 0, treat as solid fill (AE behavior).
  float mInner = 1.0;
  if (innerR > 0.0)
  {
    mInner = smoothstep(innerR - fi - aa, innerR + aa, distPx);
  }

  return sat(mOuter * mInner);
}

// ---------------- HSL for Hue/Sat/Color/Luminosity ----------------
vec3 rgb2hsl(vec3 c)
{
  float maxc = max(max(c.r, c.g), c.b);
  float minc = min(min(c.r, c.g), c.b);
  float l = (maxc + minc) * 0.5;
  float s = 0.0;
  float h = 0.0;

  float d = maxc - minc;
  if (d > 1e-6)
  {
    s = (l > 0.5) ? d / (2.0 - maxc - minc) : d / (maxc + minc);

    if (maxc == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else                  h = (c.r - c.g) / d + 4.0;

    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t)
{
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl)
{
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  float r, g, b;

  if (s < 1e-6)
  {
    r = g = b = l;
  }
  else
  {
    float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
    float p = 2.0 * l - q;
    r = hue2rgb(p, q, h + 1.0/3.0);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1.0/3.0);
  }
  return vec3(r, g, b);
}

// ---------------- Blend functions ----------------
vec3 blendOverlay(vec3 b, vec3 s)
{
  return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, b));
}

vec3 blendHardLight(vec3 b, vec3 s)
{
  return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, s));
}

vec3 blendSoftLight(vec3 b, vec3 s)
{
  return (1.0 - 2.0*s) * b*b + 2.0*s*b;
}

vec3 blendColorDodge(vec3 b, vec3 s)
{
  vec3 denom = max(vec3(1.0) - s, vec3(1e-6));
  return sat3(b / denom);
}

vec3 blendColorBurn(vec3 b, vec3 s)
{
  vec3 denom = max(s, vec3(1e-6));
  return sat3(1.0 - (1.0 - b) / denom);
}

vec3 applyBlendMode(vec3 base, vec3 src, int mode)
{
  if (mode == 0 || mode == 1) return src;                         // None/Normal
  if (mode == 3)  return sat3(base + src);                        // Add
  if (mode == 4)  return base * src;                              // Multiply
  if (mode == 5)  return 1.0 - (1.0-base)*(1.0-src);              // Screen
  if (mode == 6)  return blendOverlay(base, src);                 // Overlay
  if (mode == 7)  return blendSoftLight(base, src);               // Soft Light
  if (mode == 8)  return blendHardLight(base, src);               // Hard Light
  if (mode == 9)  return blendColorDodge(base, src);              // Color Dodge
  if (mode == 10) return blendColorBurn(base, src);               // Color Burn
  if (mode == 11) return min(base, src);                          // Darken
  if (mode == 12) return max(base, src);                          // Lighten
  if (mode == 13) return abs(base - src);                         // Difference
  if (mode == 14) return base + src - 2.0*base*src;               // Exclusion

  vec3 hb = rgb2hsl(base);
  vec3 hs = rgb2hsl(src);

  if (mode == 15) return hsl2rgb(vec3(hs.x, hb.y, hb.z));         // Hue
  if (mode == 16) return hsl2rgb(vec3(hb.x, hs.y, hb.z));         // Saturation
  if (mode == 17) return hsl2rgb(vec3(hs.x, hs.y, hb.z));         // Color
  if (mode == 18) return hsl2rgb(vec3(hb.x, hb.y, hs.z));         // Luminosity

  return src;
}

void main()
{
  vec4 base = texture2D(tDiffuse, vUvScaled);

  vec2 uv = unscaledUv();
  vec2 pPx = uv * resolution;

  vec2 cPx = aeCenterToGL(Center);
  float distPx = length(pPx - cPx);

  float R = max(Radius, 0.0);
  int edgeMode = int(floor(Edge + 0.5));
  int blendMode = int(floor(Blending_Mode + 0.5));
  float inv = step(0.5, Invert_Circle);

  // Feather values
  float fOuterPx = max(Feather_Outer_Edge, 0.0);
  float fInnerPx = max(Feather_Inner_Edge, 0.0);

  // Thickness used only in modes 2/3/4
  float tPx = max(Thickness, 0.0);

  if (edgeMode == 3 || edgeMode == 4)
    tPx = max(Thickness * R, 0.0);

  if (edgeMode == 4)
  {
    fOuterPx = max(Feather_Outer_Edge * R, 0.0);
    fInnerPx = max(Feather_Inner_Edge * R, 0.0);
  }

  // --- Requested disabling rules ---
  // Mode 0: ignore Thickness and Edge_Radius
  if (edgeMode == 0)
  {
    tPx = 0.0;
  }

  // Mode 1: ignore Thickness, use Edge_Radius only
  float edgeRadiusWidthPx = max(Edge_Radius, 0.0);
  if (edgeMode == 1)
  {
    tPx = 0.0;
  }

  // Compute inner/outer radii
  float innerR = 0.0;
  float outerR = R;

  if (edgeMode == 0)
  {
    // Filled circle only
    innerR = 0.0;
    outerR = R;
  }
else if (edgeMode == 1)
{
  // ✅ INVERTED Edge Radius:
  // Edge_Radius becomes the INNER radius directly.
  // Increasing Edge_Radius makes the ring thinner until it overlaps (inner == outer).
  innerR = min(edgeRadiusWidthPx, R);
  outerR = R;
}
  else
  {
    // Thickness-based ring: centered at R (stroke centered)
    innerR = max(R - 0.5*tPx, 0.0);
    outerR = R + 0.5*tPx;
  }

  float a = ringMask(distPx, innerR, outerR, fInnerPx, fOuterPx);

  // Invert
  a = mix(a, 1.0 - a, inv);

  // Apply Opacity (0..100 like AE)
  float op = clamp(Opacity / 100.0, 0.0, 1.0);
  a *= op;

  vec3 srcRGB = Color;

  // Stencil Alpha (Panzoid limitation: only masks this layer output)
  if (blendMode == 2)
  {
    vec4 outc = vec4(base.rgb * a, base.a * a);
    gl_FragColor = outc;
    return;
  }

  vec3 blendedRGB = applyBlendMode(base.rgb, srcRGB, blendMode);

  // Composite only where the circle exists
  vec3 outRGB = base.rgb * (1.0 - a) + blendedRGB * a;
  float outA = base.a + a - base.a * a;

  gl_FragColor = vec4(outRGB, outA);
}
