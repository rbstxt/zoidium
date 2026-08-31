precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 resolution;   // built-in
uniform vec2 uvScale;      // built-in

varying vec2 vUv;
varying vec2 vUvScaled;

// === Panzoid custom properties ===
// Create these properties in the effect UI with the exact names:
uniform float Scale;                 // Number (dynamic)   default: 100.0
uniform vec2 Center;                 // 2D Vector          default: (resolution.x/2, resolution.y/2) -> set manually
uniform float Blend_With_Original;   // Number (dynamic)   default: 0.0

// Wrap UV manually (works even if sampler is clamped)
vec2 wrap01(vec2 uv) {
  return fract(uv); // fract handles negatives correctly (x - floor(x))
}

void main()
{
  // Original (untouched) sample
  vec4 original = texture2D(tDiffuse, vUvScaled);

  // Convert Center from pixel space (AE-like) to UV space (0..1)
  vec2 centerUv = Center / resolution;

  // AE CC Tiler scale logic:
  // 100% => factor 1.0 (no change)
  // 25%  => factor 4.0 (more repetition)
  // 200% => factor 0.5 (bigger tiles / zoom-in)
  float s = max(Scale, 0.0001);          // prevent divide-by-zero
  float factor = 100.0 / s;

  // Scale around Center pivot
  vec2 uv = vUv;
  vec2 tiledUv = (uv - centerUv) * factor + centerUv;

  // Repeat infinitely
  tiledUv = wrap01(tiledUv);

  // Sample tiled version (remember to map into buffer UV space)
  vec4 tiled = texture2D(tDiffuse, tiledUv * uvScale);

  // Blend With Original (AE meaning):
  // 0%   => show 100% tiled
  // 100% => show 100% original (effect visually off)
  float blend = clamp(Blend_With_Original / 100.0, 0.0, 1.0);
  gl_FragColor = mix(tiled, original, blend);
}
