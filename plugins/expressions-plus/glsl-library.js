"use strict";
// Small, original GLSL ES 1.00 helpers. Prefixes keep them separate from the
// shader's own symbols. Including a chunk twice emits its implementation once.
module.exports = {
  hash: `float zHash(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float zHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float zHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`,
  noise: `// #include <zoidium/hash>
float zNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(zHash(i), zHash(i + vec2(1.0, 0.0)), f.x),
    mix(zHash(i + vec2(0.0, 1.0)), zHash(i + vec2(1.0)), f.x), f.y);
}
float zNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(zHash(i), zHash(i + vec3(1.0, 0.0, 0.0)), f.x),
    mix(zHash(i + vec3(0.0, 1.0, 0.0)), zHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(zHash(i + vec3(0.0, 0.0, 1.0)), zHash(i + vec3(1.0, 0.0, 1.0)), f.x),
    mix(zHash(i + vec3(0.0, 1.0, 1.0)), zHash(i + vec3(1.0)), f.x), f.y);
  return mix(a, b, f.z);
}`,
  color: `vec3 zSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4)), step(vec3(0.04045), c));
}
vec3 zLinearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 zHsvToRgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 zRgbToHsv(vec3 c) {
  float hi = max(c.r, max(c.g, c.b)), lo = min(c.r, min(c.g, c.b)), d = hi - lo;
  float h = d < 0.000001 ? 0.0 : hi == c.r ? mod((c.g - c.b) / d, 6.0) : hi == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(fract(h / 6.0), hi < 0.000001 ? 0.0 : d / hi, hi);
}`,
  sdf: `float zSdCircle(vec2 p, float radius) { return length(p) - radius; }
float zSdBox(vec2 p, vec2 halfSize) { vec2 q = abs(p) - halfSize; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float zSdSphere(vec3 p, float radius) { return length(p) - radius; }
float zSdBox(vec3 p, vec3 halfSize) { vec3 q = abs(p) - halfSize; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float zSmoothUnion(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.000001), 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }`,
};
