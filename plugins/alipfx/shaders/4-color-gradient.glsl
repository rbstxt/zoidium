precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---- Custom properties (Panzoid: spaces become underscores) ----
uniform vec2 Point_1;
uniform vec3 Color_1;

uniform vec2 Point_2;
uniform vec3 Color_2;

uniform vec2 Point_3;
uniform vec3 Color_3;

uniform vec2 Point_4;
uniform vec3 Color_4;

uniform float Blend;         // 0..100
uniform float Jitter;        // 0..100
uniform float Opacity;       // 0..100
uniform float Blending_Mode; // 0..17 (integers)

// --------------------- Utility: hash noise (stable per-pixel) ---------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  // Two independent hashes -> vec2 in [0,1)
  float n1 = hash12(p + vec2(17.13, 91.7));
  float n2 = hash12(p + vec2(71.7, 23.13));
  return vec2(n1, n2);
}

// --------------------- Color conversion: RGB <-> HSL ---------------------
float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 rgb2hsl(vec3 c) {
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float h = 0.0;
  float s = 0.0;
  float l = (maxc + minc) * 0.5;

  if (maxc != minc) {
    float d = maxc - minc;
    s = (l > 0.5) ? d / (2.0 - maxc - minc) : d / (maxc + minc);

    if (maxc == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
    else                  h = (c.r - c.g) / d + 4.0;

    h /= 6.0;
  }
  return vec3(h, s, l);
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  if (s == 0.0) return vec3(l);

  float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
  float p = 2.0 * l - q;

  float r = hue2rgb(p, q, h + 1.0/3.0);
  float g = hue2rgb(p, q, h);
  float b = hue2rgb(p, q, h - 1.0/3.0);

  return vec3(r, g, b);
}

// --------------------- Blend modes ---------------------
vec3 blend_normal(vec3 base, vec3 blend) { return blend; }
vec3 blend_add(vec3 base, vec3 blend) { return base + blend; }
vec3 blend_multiply(vec3 base, vec3 blend) { return base * blend; }
vec3 blend_screen(vec3 base, vec3 blend) { return 1.0 - (1.0 - base) * (1.0 - blend); }

vec3 blend_overlay(vec3 base, vec3 blend) {
  vec3 low  = 2.0 * base * blend;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(low, high, step(0.5, base));
}

vec3 blend_hard_light(vec3 base, vec3 blend) {
  vec3 low  = 2.0 * base * blend;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(low, high, step(0.5, blend));
}

float softlight_channel(float base, float blend) {
  if (blend < 0.5) {
    return base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  } else {
    float g = (base <= 0.25)
      ? (((16.0 * base - 12.0) * base + 4.0) * base)
      : sqrt(base);
    return base + (2.0 * blend - 1.0) * (g - base);
  }
}

vec3 blend_soft_light(vec3 base, vec3 blend) {
  return vec3(
    softlight_channel(base.r, blend.r),
    softlight_channel(base.g, blend.g),
    softlight_channel(base.b, blend.b)
  );
}

vec3 blend_color_dodge(vec3 base, vec3 blend) {
  return min(vec3(1.0), base / max(vec3(1e-6), (1.0 - blend)));
}

vec3 blend_color_burn(vec3 base, vec3 blend) {
  return 1.0 - min(vec3(1.0), (1.0 - base) / max(vec3(1e-6), blend));
}

vec3 blend_darken(vec3 base, vec3 blend) { return min(base, blend); }
vec3 blend_lighten(vec3 base, vec3 blend) { return max(base, blend); }
vec3 blend_difference(vec3 base, vec3 blend) { return abs(base - blend); }
vec3 blend_exclusion(vec3 base, vec3 blend) { return base + blend - 2.0 * base * blend; }

vec3 blend_hue(vec3 base, vec3 blend) {
  vec3 b = rgb2hsl(base);
  vec3 f = rgb2hsl(blend);
  return hsl2rgb(vec3(f.x, b.y, b.z));
}

vec3 blend_saturation(vec3 base, vec3 blend) {
  vec3 b = rgb2hsl(base);
  vec3 f = rgb2hsl(blend);
  return hsl2rgb(vec3(b.x, f.y, b.z));
}

vec3 blend_color(vec3 base, vec3 blend) {
  vec3 b = rgb2hsl(base);
  vec3 f = rgb2hsl(blend);
  return hsl2rgb(vec3(f.x, f.y, b.z));
}

vec3 blend_luminosity(vec3 base, vec3 blend) {
  vec3 b = rgb2hsl(base);
  vec3 f = rgb2hsl(blend);
  return hsl2rgb(vec3(b.x, b.y, f.z));
}

vec3 apply_blend_mode(int mode, vec3 base, vec3 blend) {
  if (mode == 1)  return blend_normal(base, blend);
  if (mode == 2)  return blend_add(base, blend);
  if (mode == 3)  return blend_multiply(base, blend);
  if (mode == 4)  return blend_screen(base, blend);
  if (mode == 5)  return blend_overlay(base, blend);
  if (mode == 6)  return blend_soft_light(base, blend);
  if (mode == 7)  return blend_hard_light(base, blend);
  if (mode == 8)  return blend_color_dodge(base, blend);
  if (mode == 9)  return blend_color_burn(base, blend);
  if (mode == 10) return blend_darken(base, blend);
  if (mode == 11) return blend_lighten(base, blend);
  if (mode == 12) return blend_difference(base, blend);
  if (mode == 13) return blend_exclusion(base, blend);
  if (mode == 14) return blend_hue(base, blend);
  if (mode == 15) return blend_saturation(base, blend);
  if (mode == 16) return blend_color(base, blend);
  if (mode == 17) return blend_luminosity(base, blend);
  return blend_normal(base, blend);
}

// --------------------- AE-like 4-color gradient core ---------------------
// AE: “four solid-color circles blended together”; Blend higher => more gradual transitions. [1](https://helpx.adobe.com/after-effects/using/generate-effects.html)
vec3 four_color_gradient(vec2 fragPx) {
  float diag = max(1.0, length(resolution));

  float d1 = distance(fragPx, Point_1) / diag;
  float d2 = distance(fragPx, Point_2) / diag;
  float d3 = distance(fragPx, Point_3) / diag;
  float d4 = distance(fragPx, Point_4) / diag;

  float t = clamp(Blend / 100.0, 0.0, 1.0);
  float power = mix(24.0, 1.0, t); // higher Blend => lower power => smoother

  float eps = 1e-4;
  float w1 = 1.0 / pow(d1 + eps, power);
  float w2 = 1.0 / pow(d2 + eps, power);
  float w3 = 1.0 / pow(d3 + eps, power);
  float w4 = 1.0 / pow(d4 + eps, power);

  float ws = w1 + w2 + w3 + w4;
  vec3 col = (Color_1 * w1 + Color_2 * w2 + Color_3 * w3 + Color_4 * w4) / max(1e-6, ws);

  return clamp(col, 0.0, 1.0);
}

void main() {
  // Original layer sample (Panzoid input buffer) [2](https://panzoid.com/community/official/37192?c=3)
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // Convert Panzoid UV to AE-style pixel coords:
  // Panzoid vUv is bottom-left; AE points are top-left => flip Y. [2](https://panzoid.com/community/official/37192?c=3)
  vec2 uvAE = vec2(vUv.x, 1.0 - vUv.y);
  vec2 fragPx = uvAE * resolution;

  float jit = clamp(Jitter / 100.0, 0.0, 1.0);

  // --------------------- NEW: spatial jitter ("scattering") ---------------------
  // Jitter in AE is mainly for banding reduction, but you want visible scattering.
  // So we jitter the sampling position by a few pixels at high values.
  // Tune MAX_SCATTER_PX to taste (8.0 = visible but not crazy).
  const float MAX_SCATTER_PX = 8.0;

  vec2 rnd2 = hash22(gl_FragCoord.xy);
  vec2 scatterOffsetPx = (rnd2 - 0.5) * (MAX_SCATTER_PX * jit);

  vec2 fragPxJ = fragPx + scatterOffsetPx;

  // Compute gradient using jittered position
  vec3 grad = four_color_gradient(fragPxJ);

  // --------------------- Dither jitter (anti-banding) ---------------------
  // Keep this subtle; scale it like a dither (roughly ~1/255 .. ~4/255 at max)
  vec3 n = vec3(
    hash12(gl_FragCoord.xy + vec2(0.0, 0.0)),
    hash12(gl_FragCoord.xy + vec2(19.19, 73.73)),
    hash12(gl_FragCoord.xy + vec2(47.47, 11.11))
  );

  float ditherAmp = mix(0.0, 4.0 / 255.0, jit);
  grad = clamp(grad + (n - 0.5) * ditherAmp, 0.0, 1.0);

  float op = clamp(Opacity / 100.0, 0.0, 1.0);
  int mode = int(floor(Blending_Mode + 0.5));

  vec3 outRGB;

  // Your rule: mode 0 mixes with original layer (normal composite)
  if (mode == 0) {
    outRGB = mix(texel.rgb, grad, op);
  } else {
    vec3 blended = apply_blend_mode(mode, texel.rgb, grad);
    outRGB = mix(texel.rgb, blended, op);
  }

  // Keep original alpha (Opacity is “gradient alpha strength”, not changing cutout)
  gl_FragColor = vec4(clamp(outRGB, 0.0, 1.0), texel.a);
}
