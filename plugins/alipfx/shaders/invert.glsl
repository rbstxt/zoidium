precision highp float;
precision highp int;

/* --- Panzoid built-ins --- */
uniform sampler2D tDiffuse;
uniform vec2      uvScale;
uniform vec2      resolution;
varying vec2      vUv;
varying vec2      vUvScaled;

/* --- Properties from the UI --- */
uniform float Channel;              // 0..12 (rounded to int)
uniform float Blend_With_Original;  // 0..100 (percent, AE-style)

/* ===========================
   HLS (HSL) helpers
   =========================== */
float hue2rgb(float p, float q, float t)
{
  t = fract(t);
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0/2.0) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

// Returns H,L,S
vec3 rgb2hls(vec3 c)
{
  float maxc = max(max(c.r, c.g), c.b);
  float minc = min(min(c.r, c.g), c.b);
  float l = 0.5 * (maxc + minc);
  float d = maxc - minc;

  float h = 0.0;
  float s = 0.0;

  if (d > 1e-6) {
    s = d / (1.0 - abs(2.0 * l - 1.0));
    if (maxc == c.r) {
      h = ( (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0) ) / 6.0;
    } else if (maxc == c.g) {
      h = ( (c.b - c.r) / d + 2.0 ) / 6.0;
    } else {
      h = ( (c.r - c.g) / d + 4.0 ) / 6.0;
    }
  }

  return vec3(h, l, s);
}

vec3 hls2rgb(vec3 hls)
{
  float h = hls.x;
  float l = hls.y;
  float s = hls.z;

  if (s <= 1e-6) {
    return vec3(l); // grayscale
  }

  float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
  float p = 2.0 * l - q;

  float r = hue2rgb(p, q, h + 1.0/3.0);
  float g = hue2rgb(p, q, h);
  float b = hue2rgb(p, q, h - 1.0/3.0);
  return vec3(r, g, b);
}

/* ===========================
   YIQ helpers (NTSC)
   =========================== */
vec3 rgb2yiq(vec3 c)
{
  float Y = 0.299   * c.r + 0.587   * c.g + 0.114   * c.b;
  float I = 0.595716* c.r - 0.274453* c.g - 0.321263* c.b;
  float Q = 0.211456* c.r - 0.522591* c.g + 0.311135* c.b;
  return vec3(Y, I, Q);
}

vec3 yiq2rgb(vec3 yIQ)
{
  float Y = yIQ.x;
  float I = yIQ.y;
  float Q = yIQ.z;
  float r = Y + 0.9563 * I + 0.6210 * Q;
  float g = Y - 0.2721 * I - 0.6474 * Q;
  float b = Y - 1.1070 * I + 1.7046 * Q;
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

/* ===========================
   Main
   =========================== */
void main()
{
  vec4 src = texture2D(tDiffuse, vUvScaled);
  vec3 rgb = src.rgb;
  float a  = src.a;

  // Round and clamp Channel (no int clamp in GLSL ES 1.0)
  int ch = int(floor(Channel + 0.5));
  if (ch < 0)  ch = 0;
  if (ch > 12) ch = 12;

  // AE-style percent: strictly 0..100
  float bw = Blend_With_Original;
  if (bw < 0.0)   bw = 0.0;
  if (bw > 100.0) bw = 100.0;
  float bw01 = bw * 0.01; // convert to 0..1 for mix()

  vec3 outRGB = rgb;
  float outA  = a;

  if (ch == 0) {
    // RGB
    outRGB = 1.0 - rgb;
  } else if (ch == 1) {
    // Red
    outRGB = rgb; outRGB.r = 1.0 - rgb.r;
  } else if (ch == 2) {
    // Green
    outRGB = rgb; outRGB.g = 1.0 - rgb.g;
  } else if (ch == 3) {
    // Blue
    outRGB = rgb; outRGB.b = 1.0 - rgb.b;
  } else if (ch == 4 || ch == 5 || ch == 6 || ch == 7) {
    // HLS variants
    vec3 hls = rgb2hls(rgb);
    if (ch == 4) {
      hls.x = fract(hls.x + 0.5);
      hls.y = 1.0 - hls.y;
      hls.z = 1.0 - hls.z;
    } else if (ch == 5) {
      hls.x = fract(hls.x + 0.5);
    } else if (ch == 6) {
      hls.y = 1.0 - hls.y;
    } else { // 7
      hls.z = 1.0 - hls.z;
    }
    outRGB = hls2rgb(hls);
  } else if (ch == 8 || ch == 9 || ch == 10 || ch == 11) {
    // YIQ variants
    vec3 yiq = rgb2yiq(rgb);
    if (ch == 8) {
      yiq.x = 1.0 - yiq.x;
      yiq.y = -yiq.y;
      yiq.z = -yiq.z;
    } else if (ch == 9) {
      yiq.x = 1.0 - yiq.x;
    } else if (ch == 10) {
      yiq.y = -yiq.y;
    } else { // 11
      yiq.z = -yiq.z;
    }
    outRGB = yiq2rgb(yiq);
  } else {
    // 12: Alpha
    outA = 1.0 - a;
  }

  // Blend With Original: 0% = fully inverted, 100% = original
  vec4 inverted = vec4(outRGB, outA);
  gl_FragColor = mix(inverted, src, bw01);
}
