precision highp float;
varying vec2 vUv;
uniform sampler2D tCurrent;
uniform sampler2D tPrevious;
uniform vec2 uvScale;
uniform vec2 sourceSize;
uniform float footprint;
uniform float packedInput;
vec4 pairAt(vec2 p) {
  p = clamp(p, 0.5 / sourceSize, 1.0 - 0.5 / sourceSize);
  if (packedInput > 0.5) return texture2D(tCurrent, p);
  vec4 a = texture2D(tCurrent, p * uvScale);
  vec4 b = texture2D(tPrevious, p * uvScale);
  // Premultiplied luma plus alpha: transparent RGB cannot create motion.
  return vec4(dot(a.rgb, vec3(0.3, 0.59, 0.11)), a.a,
              dot(b.rgb, vec3(0.3, 0.59, 0.11)), b.a);
}
void main() {
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 d = (vec2(float(x), float(y)) + 0.5) / 4.0 - 0.5;
      sum += pairAt(vUv + d * footprint / sourceSize);
    }
  }
  gl_FragColor = sum / 16.0;
}
