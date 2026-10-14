// Time Difference (Native FX): difference between the layer now and the layer
// at a time offset. The two frames arrive as premultiplied textures; the
// arithmetic below mirrors EffectCraft's CPU/GPU time_difference (unpremultiply,
// gain 1 + contrast/25, optional absolute value, nine alpha-channel modes,
// re-premultiply). Sampled with uv * uvScale because CM3 effect buffers can be
// larger than the layer.
precision highp float;

uniform sampler2D tBase;
uniform sampler2D tOther;
uniform float uGain;
uniform int uAbs;
uniform int uAlphaMode;

varying vec2 vUvScaled;

vec4 unpremul(vec4 color) {
  if (color.a > 0.0) {
    return vec4(color.rgb / color.a, color.a);
  }
  return vec4(0.0, 0.0, 0.0, max(color.a, 0.0));
}

void main() {
  vec4 current = unpremul(texture2D(tBase, vUvScaled));
  vec4 target = unpremul(texture2D(tOther, vUvScaled));
  vec3 diff = current.rgb - target.rgb;
  vec3 rgb;
  if (uAbs != 0) {
    rgb = clamp(abs(diff) * uGain, vec3(0.0), vec3(1.0));
  } else {
    rgb = clamp(0.5 + diff * 0.5 * uGain, vec3(0.0), vec3(1.0));
  }
  float brightest = max(max(rgb.r, rgb.g), rgb.b);
  float darkest = min(min(rgb.r, rgb.g), rgb.b);
  float lightness = (brightest + darkest) * 0.5;
  float alpha = current.a;
  if (uAlphaMode == 1) {
    alpha = target.a;
  } else if (uAlphaMode == 2) {
    alpha = (current.a + target.a) * 0.5;
  } else if (uAlphaMode == 3) {
    alpha = max(current.a, target.a);
  } else if (uAlphaMode == 4) {
    alpha = 1.0;
  } else if (uAlphaMode == 5) {
    alpha = lightness;
  } else if (uAlphaMode == 6) {
    alpha = brightest;
  } else if (uAlphaMode == 7) {
    alpha = abs(current.a - target.a) * uGain;
  } else if (uAlphaMode == 8) {
    alpha = clamp(abs(current.a - target.a) * uGain, 0.0, 1.0);
    rgb = vec3(1.0);
  }
  alpha = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(rgb * alpha, alpha);
}
