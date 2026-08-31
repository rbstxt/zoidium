precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

/* =========================
   14 USER PARAMETERS
   =========================
   Panzoid property name -> GLSL uniform

   1. Glow Based On      -> Glow_Based_On        (0=Alpha, 1=Color)
   2. Glow Threshold     -> Glow_Threshold       (0..100)
   3. Glow Radius        -> Glow_Radius          (pixels)
   4. Glow Intensity     -> Glow_Intensity       (0+)
   5. Composite Original -> Composite_Original   (0=On Top, 1=Behind, 2=None)
   6. Glow Operation     -> Glow_Operation       (0..24)
   7. Glow Colors        -> Glow_Colors          (0=Original Colors, 1=A & B Colors)
   8. Color Looping      -> Color_Looping        (0..3)
   9. Color Loops        -> Color_Loops          (>= 1)
   10. Color Phase       -> Color_Phase          (degrees; recommended 0..360)
   11. A & B Midpoint    -> A_B_Midpoint         (0..100)
   12. Color A           -> Color_A              (vec3)
   13. Color B           -> Color_B              (vec3)
   14. Glow Dimensions   -> Glow_Dimensions      (0=H+V, 1=H, 2=V)
*/

uniform float Glow_Based_On;
uniform float Glow_Threshold;
uniform float Glow_Radius;
uniform float Glow_Intensity;
uniform float Composite_Original;
uniform float Glow_Operation;
uniform float Glow_Colors;
uniform float Color_Looping;
uniform float Color_Loops;
uniform float Color_Phase;
uniform float A_B_Midpoint;
uniform vec3 Color_A;
uniform vec3 Color_B;
uniform float Glow_Dimensions;

const float PI = 3.1415926535897932384626433832795;

/* =========================
   Helpers
   ========================= */

float saturate1(float x) {
  return clamp(x, 0.0, 1.0);
}

vec3 saturate3(vec3 x) {
  return clamp(x, 0.0, 1.0);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 overComposite(vec4 top, vec4 bottom) {
  float outA = top.a + bottom.a * (1.0 - top.a);
  vec3 outRGB = top.rgb + bottom.rgb * (1.0 - top.a);
  return vec4(outRGB, outA);
}

/* =========================
   RGB <-> HSL helpers
   Used for Hue / Saturation / Color / Luminosity
   ========================= */

vec3 rgb2hsl(vec3 c) {
  float maxc = max(max(c.r, c.g), c.b);
  float minc = min(min(c.r, c.g), c.b);
  float h = 0.0;
  float s = 0.0;
  float l = (maxc + minc) * 0.5;
  float d = maxc - minc;

  if (d > 1e-6) {
    s = d / (1.0 - abs(2.0 * l - 1.0));
    if (maxc == c.r) {
      h = mod((c.g - c.b) / d, 6.0);
    } else if (maxc == c.g) {
      h = ((c.b - c.r) / d) + 2.0;
    } else {
      h = ((c.r - c.g) / d) + 4.0;
    }
    h /= 6.0;
  }

  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  float r, g, b;

  if (s < 1e-6) {
    r = g = b = l;
  } else {
    float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
    float p = 2.0 * l - q;
    r = hue2rgb(p, q, h + 1.0 / 3.0);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1.0 / 3.0);
  }

  return vec3(r, g, b);
}

/* =========================
   Blend modes
   These approximate AE/Ps-style blending
   ========================= */

vec3 blendNormal(vec3 base, vec3 blend) {
  return blend;
}

vec3 blendAdd(vec3 base, vec3 blend) {
  return base + blend;
}

vec3 blendMultiply(vec3 base, vec3 blend) {
  return base * blend;
}

vec3 blendScreen(vec3 base, vec3 blend) {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

vec3 blendOverlay(vec3 base, vec3 blend) {
  vec3 low  = 2.0 * base * blend;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(low, high, step(0.5, base));
}

vec3 blendSoftLight(vec3 base, vec3 blend) {
  return (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base;
}

vec3 blendHardLight(vec3 base, vec3 blend) {
  vec3 low  = 2.0 * base * blend;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(low, high, step(0.5, blend));
}

vec3 blendDarken(vec3 base, vec3 blend) {
  return min(base, blend);
}

vec3 blendLighten(vec3 base, vec3 blend) {
  return max(base, blend);
}

vec3 blendDifference(vec3 base, vec3 blend) {
  return abs(base - blend);
}

vec3 blendExclusion(vec3 base, vec3 blend) {
  return base + blend - 2.0 * base * blend;
}

vec3 blendColorDodge(vec3 base, vec3 blend) {
  return base / max(vec3(1e-5), (1.0 - blend));
}

vec3 blendColorBurn(vec3 base, vec3 blend) {
  return 1.0 - ((1.0 - base) / max(vec3(1e-5), blend));
}

vec3 blendHue(vec3 base, vec3 blend) {
  vec3 hb = rgb2hsl(base);
  vec3 hs = rgb2hsl(blend);
  return hsl2rgb(vec3(hs.x, hb.y, hb.z));
}

vec3 blendSaturation(vec3 base, vec3 blend) {
  vec3 hb = rgb2hsl(base);
  vec3 hs = rgb2hsl(blend);
  return hsl2rgb(vec3(hb.x, hs.y, hb.z));
}

vec3 blendColorMode(vec3 base, vec3 blend) {
  vec3 hb = rgb2hsl(base);
  vec3 hs = rgb2hsl(blend);
  return hsl2rgb(vec3(hs.x, hs.y, hb.z));
}

vec3 blendLuminosity(vec3 base, vec3 blend) {
  vec3 hb = rgb2hsl(base);
  vec3 hs = rgb2hsl(blend);
  return hsl2rgb(vec3(hb.x, hb.y, hs.z));
}

/* =========================
   A/B color looping
   ========================= */

float midpointRemap(float x, float m) {
  // m in [0,1], shifts where A<->B transition occurs
  m = clamp(m, 0.001, 0.999);
  if (x < m) {
    return 0.5 * (x / m);
  } else {
    return 0.5 + 0.5 * ((x - m) / (1.0 - m));
  }
}

float waveSawAB(float t) {
  return fract(t);
}

float waveSawBA(float t) {
  return 1.0 - fract(t);
}

float waveTriABA(float t) {
  float x = fract(t);
  return 1.0 - abs(x * 2.0 - 1.0);
}

float waveTriBAB(float t) {
  float x = fract(t);
  return abs(x * 2.0 - 1.0);
}

vec3 evalABColor(float dist01) {
  float loops = max(1.0, Color_Loops);
  float phase = Color_Phase / 360.0;
  float t = dist01 * loops + phase;

  float mode = floor(Color_Looping + 0.5);
  float w;

  if (mode < 0.5) {
    w = waveSawAB(t);      // 0 = Sawtooth A>B
  } else if (mode < 1.5) {
    w = waveSawBA(t);      // 1 = Sawtooth B>A
  } else if (mode < 2.5) {
    w = waveTriABA(t);     // 2 = Triangle A>B>A
  } else {
    w = waveTriBAB(t);     // 3 = Triangle B>A>B
  }

  w = midpointRemap(w, A_B_Midpoint / 100.0);
  return mix(Color_A, Color_B, w);
}

/* =========================
   Source extraction
   ========================= */

vec4 sampleSource(vec2 uv, float dist01) {
  vec4 s = texture2D(tDiffuse, uv);

  float threshold = Glow_Threshold / 100.0;
  float basis;

  // 0 = Alpha Channel, 1 = Color Channels
  if (Glow_Based_On < 0.5) {
    basis = s.a;
  } else {
    basis = luma(s.rgb);
  }

  // small softness around threshold to avoid harsh clipping
  float mask = smoothstep(threshold - 0.02, threshold + 0.02, basis);

  // AE-like behavior:
  // Alpha mode = any opaque pixel can glow regardless of RGB brightness
  // Color mode = brightness drives glow
  if (Glow_Based_On < 0.5) {
    // alpha-based
    if (Glow_Colors < 0.5) {
      // original colors
      return vec4(s.rgb * mask, mask);
    } else {
      // A & B colors
      vec3 ab = evalABColor(dist01);
      return vec4(ab * mask, mask);
    }
  } else {
    // color-based
    if (Glow_Colors < 0.5) {
      // original colors
      return vec4(s.rgb * mask, mask);
    } else {
      // A & B colors
      vec3 ab = evalABColor(dist01);
      float strength = mask * basis;
      return vec4(ab * strength, strength);
    }
  }
}

/* =========================
   Glow blur accumulation
   ========================= */

vec4 buildGlow(vec2 uv) {
  float radiusPx = max(0.0, Glow_Radius);
  if (radiusPx < 0.001) {
    return vec4(0.0);
  }

  vec2 px = 1.0 / resolution;
  vec2 radiusUV = px * radiusPx;

  vec4 accum = vec4(0.0);
  float totalW = 0.0;

  float dims = floor(Glow_Dimensions + 0.5);

  // center contribution
  {
    vec4 c0 = sampleSource(uv, 0.0);
    float w0 = 1.0;
    accum += c0 * w0;
    totalW += w0;
  }

  if (dims < 0.5) {
    // 0 = Horizontal and Vertical (full 2D glow)
    const int DIRS = 8;
    const int STEPS = 6;

    for (int d = 0; d < DIRS; d++) {
      float ang = float(d) * (2.0 * PI / float(DIRS));
      vec2 dir = vec2(cos(ang), sin(ang));

      for (int i = 1; i <= STEPS; i++) {
        float t = float(i) / float(STEPS);
        vec2 off = dir * radiusUV * t;

        float w = exp(-4.0 * t * t); // gaussian-ish
        vec4 c = sampleSource(uv + off, t);
        accum += c * w;
        totalW += w;
      }
    }
  } else if (dims < 1.5) {
    // 1 = Horizontal
    const int STEPS = 10;
    for (int i = 1; i <= STEPS; i++) {
      float t = float(i) / float(STEPS);
      vec2 off = vec2(radiusUV.x * t, 0.0);
      float w = exp(-4.0 * t * t);

      vec4 c1 = sampleSource(uv + off, t);
      vec4 c2 = sampleSource(uv - off, t);

      accum += (c1 + c2) * w;
      totalW += 2.0 * w;
    }
  } else {
    // 2 = Vertical
    const int STEPS = 10;
    for (int i = 1; i <= STEPS; i++) {
      float t = float(i) / float(STEPS);
      vec2 off = vec2(0.0, radiusUV.y * t);
      float w = exp(-4.0 * t * t);

      vec4 c1 = sampleSource(uv + off, t);
      vec4 c2 = sampleSource(uv - off, t);

      accum += (c1 + c2) * w;
      totalW += 2.0 * w;
    }
  }

  vec4 glow = accum / max(totalW, 1e-5);
  glow.rgb *= Glow_Intensity;
  glow.a = saturate1(glow.a * Glow_Intensity);

  return glow;
}

/* =========================
   Glow Operation compositing
   ========================= */

vec4 applyGlowOperation(vec4 base, vec4 glow, vec2 uv) {
  int op = int(floor(Glow_Operation + 0.5));
  vec3 resultRGB = base.rgb;

  // Use glow alpha as blend amount
  float a = saturate1(glow.a);

  if (op == 0) {
    // None
    return glow;
  } else if (op == 1) {
    // Normal
    resultRGB = mix(base.rgb, blendNormal(base.rgb, glow.rgb), a);
  } else if (op == 2) {
    // Add
    resultRGB = base.rgb + glow.rgb;
  } else if (op == 3) {
    // Multiply
    resultRGB = mix(base.rgb, blendMultiply(base.rgb, glow.rgb), a);
  } else if (op == 4) {
    // Dissolve
    float n = hash12(floor(uv * resolution));
    float m = step(n, a);
    resultRGB = mix(base.rgb, glow.rgb, m);
  } else if (op == 5) {
    // Screen
    resultRGB = mix(base.rgb, blendScreen(base.rgb, glow.rgb), a);
  } else if (op == 6) {
    // Overlay
    resultRGB = mix(base.rgb, blendOverlay(base.rgb, glow.rgb), a);
  } else if (op == 7) {
    // Soft Light
    resultRGB = mix(base.rgb, blendSoftLight(base.rgb, glow.rgb), a);
  } else if (op == 8) {
    // Hard Light
    resultRGB = mix(base.rgb, blendHardLight(base.rgb, glow.rgb), a);
  } else if (op == 9) {
    // Darken
    resultRGB = mix(base.rgb, blendDarken(base.rgb, glow.rgb), a);
  } else if (op == 10) {
    // Lighten
    resultRGB = mix(base.rgb, blendLighten(base.rgb, glow.rgb), a);
  } else if (op == 11) {
    // Difference
    resultRGB = mix(base.rgb, blendDifference(base.rgb, glow.rgb), a);
  } else if (op == 12) {
    // Hue
    resultRGB = mix(base.rgb, blendHue(base.rgb, glow.rgb), a);
  } else if (op == 13) {
    // Saturation
    resultRGB = mix(base.rgb, blendSaturation(base.rgb, glow.rgb), a);
  } else if (op == 14) {
    // Color
    resultRGB = mix(base.rgb, blendColorMode(base.rgb, glow.rgb), a);
  } else if (op == 15) {
    // Luminosity
    resultRGB = mix(base.rgb, blendLuminosity(base.rgb, glow.rgb), a);
  } else if (op == 16) {
    // Color Dodge
    resultRGB = mix(base.rgb, blendColorDodge(base.rgb, glow.rgb), a);
  } else if (op == 17) {
    // Color Burn
    resultRGB = mix(base.rgb, blendColorBurn(base.rgb, glow.rgb), a);
  } else if (op == 18) {
    // Exclusion
    resultRGB = mix(base.rgb, blendExclusion(base.rgb, glow.rgb), a);
  } else if (op == 19) {
    // Stencil Alpha
    return vec4(glow.rgb * base.a, glow.a * base.a);
  } else if (op == 20) {
    // Stencil Luma
    float lm = luma(glow.rgb);
    return vec4(glow.rgb * lm, glow.a * lm);
  } else if (op == 21) {
    // Silhouette Alpha
    float cutA = base.a * (1.0 - glow.a);
    return vec4(base.rgb * cutA, cutA);
  } else if (op == 22) {
    // Silhouette Luma
    float cutL = 1.0 - saturate1(luma(glow.rgb));
    float outA = base.a * cutL;
    return vec4(base.rgb * outA, outA);
  } else if (op == 23) {
    // Luminescent Premultiply
    // Tries to avoid dark premult halos on transparency
    vec3 premulSafe = base.rgb + glow.rgb * (1.0 - base.a + glow.a);
    float outA = max(base.a, glow.a);
    return vec4(premulSafe, outA);
  } else if (op == 24) {
    // Alpha Add
    vec3 rgb = base.rgb + glow.rgb * glow.a;
    float outA = saturate1(base.a + glow.a);
    return vec4(rgb, outA);
  }

  float outA = 1.0 - (1.0 - base.a) * (1.0 - glow.a);
  return vec4(resultRGB, outA);
}

void main() {
  vec2 uv = vUvScaled;

  vec4 original = texture2D(tDiffuse, uv);
  vec4 glow = buildGlow(uv);

  // Composite Original:
  // 0 = On Top
  // 1 = Behind
  // 2 = None

  int comp = int(floor(Composite_Original + 0.5));
  vec4 finalColor;

  if (comp == 2) {
    // None = show only glow
    finalColor = glow;
  } else if (comp == 0) {
    // On Top = original over glow
    finalColor = overComposite(original, glow);
  } else {
    // Behind = glow blended onto original using Glow Operation
    finalColor = applyGlowOperation(original, glow, uv);
  }

  gl_FragColor = vec4(saturate3(finalColor.rgb), saturate1(finalColor.a));
}
