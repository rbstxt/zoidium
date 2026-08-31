precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUvScaled;

// === Properties ===
uniform float Width;      // pixels
uniform float Height;     // pixels
uniform float Overlaps;   // AE-like small values recommended (0..10)
uniform float Direction;  // degrees
uniform vec2  Center;     // AE PIXELS (e.g. 960,540)
uniform float Coverage;   // 0..100
uniform float Shadowing;  // 0..100
uniform float Texture;    // 0..100 (adds fiber/irregularity)

// --- helpers ---
mat2 rot2(float a){
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

// stable hash/noise (no derivatives)
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Band mask with manual AA in tile space
float bandMask(float x, float h, float aa){
  return 1.0 - smoothstep(h, h + aa, abs(x));
}

// Cloth-like bevel shading without derivatives
float bevelShade(float coord, float halfT, float sh){
  float ht = max(halfT, 1e-4);
  float d = clamp(abs(coord) / ht, 0.0, 1.0);     // 0 center -> 1 edge
  float profile = 1.0 - smoothstep(0.0, 1.0, d);  // bright center, darker edge

  // fake light from upper-left
  float dir = 0.5 + 0.5 * (-coord / ht);
  float light = mix(0.88, 1.18, dir);

  return mix(1.0, profile * light, sh);
}

void main(){
  // Sample input mainly to preserve alpha and allow tinting from layer color
  vec4 src = texture2D(tDiffuse, vUvScaled);

  // Current pixel position in AE pixel space
  vec2 p = vUvScaled * resolution;

  // Rotate around AE pixel Center
  float ang = radians(Direction);
  vec2 pr = rot2(ang) * (p - Center) + Center;

  // Tile size
  vec2 tile = vec2(max(Width, 0.001), max(Height, 0.001));

  // Manual AA estimate: approx one pixel in tile space
  float aax = 1.25 / tile.x;
  float aay = 1.25 / tile.y;

  // Tile coordinates anchored at Center
  vec2 g = (pr - Center) / tile;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5; // -0.5..0.5 in each tile

  float cov = clamp(Coverage / 100.0, 0.0, 1.0);
  float sh  = clamp(Shadowing / 100.0, 0.0, 1.0);
  float texAmt = clamp(Texture / 100.0, 0.0, 1.0);

  // Texture -> organic thickness variation (fabric roughness)
  float n1 = noise2(pr * 0.035);   // broad
  float n2 = noise2(pr * 0.160);   // fine
  float rough = mix(n1, n2, 0.55); // 0..1
  float thickJitter = (rough - 0.5) * 0.28 * texAmt;

  // Coverage -> thickness within tile
  float halfT = mix(0.03, 0.50, cov);
  halfT *= (1.0 + thickJitter);
  halfT = clamp(halfT, 0.01, 0.50);

  // Two thread sets
  float horiz = bandMask(f.y, halfT, aay);
  float vert  = bandMask(f.x, halfT, aax);

  // Basket-weave alternation
  float parity = mod(cell.x + cell.y, 2.0);
  float topIsHoriz = 1.0 - step(0.5, parity);

  float topMask    = mix(vert,  horiz, topIsHoriz);
  float bottomMask = mix(horiz, vert,  topIsHoriz);

  // Crossings
  float cross = horiz * vert;

  // Overlaps: AE-like small values (0..10 recommended)
  float ov = clamp(Overlaps / 10.0, 0.0, 1.0);

  // Suppress bottom at crossings based on overlap
  bottomMask *= (1.0 - cross * ov);

  float thread = max(topMask, bottomMask);
  float gap = 1.0 - thread;

  // Shading (no derivatives)
  float shadeH = bevelShade(f.y, halfT, sh);
  float shadeV = bevelShade(f.x, halfT, sh);

  float topShade = mix(shadeV, shadeH, topIsHoriz);
  float botShade = mix(shadeH, shadeV, topIsHoriz);

  float shade = 1.0;
  shade *= mix(1.0, topShade, topMask);
  shade *= mix(1.0, botShade, bottomMask);

  // Gap AO + overlap shadow
  shade *= (1.0 - gap * 0.62 * sh);
  shade *= (1.0 - cross * ov * 0.22 * sh);

  // Micro fiber contrast from Texture
  float micro = (noise2(pr * 0.9) - 0.5) * 0.10 * texAmt;
  shade *= (1.0 + micro);

  // Generated pattern luminance
  float bg = mix(0.72, 0.46, sh);
  float th = mix(0.94, 0.80, sh) * shade;
  float patternLum = mix(bg, th, thread);

  // Tinting:
  // Best AE-like workflow: apply shader to a colored solid.
  // Here we use input RGB as the fabric tint; if transparent, default to white.
  vec3 tint = (src.a > 0.0) ? src.rgb : vec3(1.0);
  vec3 outRgb = tint * patternLum;

  // Preserve alpha so it can be used on text/logos too
  gl_FragColor = vec4(outRgb, src.a);
}
