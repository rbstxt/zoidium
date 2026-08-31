precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

/* Panzoid properties (spaces become underscores) */
uniform float Dots;              // 0 = Black, 1 = White
uniform float Dots_Frequency;    // Sapphire-like "frequency", not dots-across-width
uniform float Dots_Angle;        // degrees CCW
uniform float Dots_Rel_Width;    // ellipse stretch
uniform float Dots_Sharpness;    // edge hardness
uniform float Dots_Lighten;      // -1..1
uniform float Smooth_Source;     // preblur amount
uniform vec3  Color1;            // bright
uniform vec3  Color0;            // dark
uniform float Dots_Shift_X;      // pixels
uniform float Dots_Shift_Y;      // pixels

/* --- Helpers --- */

float luma709(vec3 c) {
  // Sapphire docs don't specify exact luma formula; 709 is a close AE-style choice.
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

mat2 rot2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float safe(float x) { return max(x, 1e-6); }

vec4 blur9(vec2 uv, float radiusPx) {
  // Small 3x3 gaussian-ish blur (WebGL1 safe, no loops needed)
  vec2 px = radiusPx / resolution;
  vec4 c = vec4(0.0);

  c += texture2D(tDiffuse, uv + px * vec2(-1.0, -1.0)) * 1.0;
  c += texture2D(tDiffuse, uv + px * vec2( 0.0, -1.0)) * 2.0;
  c += texture2D(tDiffuse, uv + px * vec2( 1.0, -1.0)) * 1.0;

  c += texture2D(tDiffuse, uv + px * vec2(-1.0,  0.0)) * 2.0;
  c += texture2D(tDiffuse, uv + px * vec2( 0.0,  0.0)) * 4.0;
  c += texture2D(tDiffuse, uv + px * vec2( 1.0,  0.0)) * 2.0;

  c += texture2D(tDiffuse, uv + px * vec2(-1.0,  1.0)) * 1.0;
  c += texture2D(tDiffuse, uv + px * vec2( 0.0,  1.0)) * 2.0;
  c += texture2D(tDiffuse, uv + px * vec2( 1.0,  1.0)) * 1.0;

  return c / 16.0;
}

void main() {
  vec4 src = texture2D(tDiffuse, vUvScaled);

  float freq = max(Dots_Frequency, 0.0);
  if (freq < 0.0001) {
    gl_FragColor = src;
    return;
  }

  // --- Smooth Source (pre-blur before dot sizing) ---
  vec4 smp = src;
  float smoothPx = max(Smooth_Source, 0.0);
  if (smoothPx > 0.0001) {
    smp = blur9(vUvScaled, smoothPx);
  }

  float L = clamp(luma709(smp.rgb), 0.0, 1.0);

  // --- Frequency mapping (Sapphire-like behavior) ---
  // Sapphire docs say "frequency of dots pattern" (default 50), not dots across width. [1](https://borisfx.com/documentation/sapphire/ae/halftone/)[2](https://y-yamazaki.tv/Sapphire_docs/HalfTone.html)
  // Use min dimension so 1920x1080 with freq=50 gives ~89 dots across width (dense like Sapphire).
  float minDim  = min(resolution.x, resolution.y);
  float spacing = max(1.0, minDim / safe(freq));   // pixels per cell
  float halfCell = 0.5 * spacing;

  // Pixel position
  vec2 p = vUvScaled * resolution;

  // Rotate grid about center
  vec2 center = 0.5 * resolution;
  float ang = radians(Dots_Angle);
  vec2 pr = rot2(ang) * (p - center) + center;

  // Shift grid (in pixels, like AE “Dots Shift”) [2](https://y-yamazaki.tv/Sapphire_docs/HalfTone.html)
  pr += vec2(Dots_Shift_X, Dots_Shift_Y);

  // Cell center
  vec2 cell = (floor(pr / spacing) + 0.5) * spacing;

  // Ellipse control
  float rw = max(Dots_Rel_Width, 0.001);
  vec2 d = pr - cell;
  d.x /= rw;
  float dist = length(d); // pixels

  // Polarity: 0=Black, 1=White
  float mode = step(0.5, Dots);

  // Ink coverage: Black mode -> more ink in dark areas; White mode -> more ink in bright areas
  float ink = mix(1.0 - L, L, mode);

  // Lighten bias: increase to lighten result (docs: -1..1) [2](https://y-yamazaki.tv/Sapphire_docs/HalfTone.html)
  ink += mix(-Dots_Lighten, Dots_Lighten, mode);
  ink = clamp(ink, 0.0, 1.0);

  // Radius mapping: sqrt makes dot AREA respond more linearly to tone
  float radius = sqrt(ink) * halfCell;

  // Derivative-free edge softness
  float sharp = max(Dots_Sharpness, 0.001);
  float edgePx = max(1.0, halfCell / (1.0 + 2.0 * sharp));

  float mask = 1.0 - smoothstep(radius - edgePx, radius + edgePx, dist);

  // Duotone colors, swapped for White mode
  vec3 bg = mix(Color1, Color0, mode);
  vec3 fg = mix(Color0, Color1, mode);

  vec3 outRGB = mix(bg, fg, mask);

  gl_FragColor = vec4(outRGB, src.a);
}
