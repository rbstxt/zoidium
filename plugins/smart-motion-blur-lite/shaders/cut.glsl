precision highp float;
varying vec2 vUv;
uniform sampler2D tPair;
uniform sampler2D tFlow;
uniform vec2 resolution;
void main() {
  float mismatch = 0.0;
  float change = 0.0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      vec2 p = (vec2(float(x), float(y)) + 0.5) / 8.0;
      vec4 pair = texture2D(tPair, p);
      change += abs(pair.r - pair.b) + 0.5 * abs(pair.g - pair.a);
      vec2 motion = smbDecode(texture2D(tFlow, p));
      vec2 warped = texture2D(tPair, clamp(p + motion / resolution, vec2(0.0), vec2(1.0))).ba;
      vec2 difference = abs(pair.rg - warped);
      mismatch += step(0.12, difference.x + 0.5 * difference.y);
    }
  }
  // Conservative global rejection, entirely on GPU. It is a heuristic,
  // not a semantic cut detector; local residual rejection remains active.
  float cut = max(step(0.70, mismatch / 64.0) * step(0.16, change / 64.0), step(0.45, change / 64.0));
  gl_FragColor = vec4(1.0 - cut, mismatch / 64.0, change / 64.0, 1.0);
}
