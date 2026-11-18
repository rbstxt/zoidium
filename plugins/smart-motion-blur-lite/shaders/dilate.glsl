precision highp float;
varying vec2 vUv;
uniform sampler2D tFlow;
uniform vec2 levelSize;
uniform vec2 resolution;
uniform float strength;
uniform float radius;
void main() {
  vec2 own = smbDecode(texture2D(tFlow, vUv));
  vec2 best = own;
  float speed = length(best);
  vec2 cellPixels = resolution / levelSize;
  vec2 stride = max(vec2(1.0), ceil(vec2(radius * 0.5) / (3.0 * cellPixels)));
  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      vec2 offset = vec2(float(x), float(y)) * stride;
      vec2 p = clamp(vUv + offset / levelSize, 0.5 / levelSize, 1.0 - 0.5 / levelSize);
      vec2 v = smbDecode(texture2D(tFlow, p));
      float magnitude = length(v);
      vec2 trail = v * strength;
      trail *= min(1.0, radius / max(length(trail), 0.0001));
      vec2 d = (vUv - p) * resolution;
      float t = clamp(dot(d, trail) / max(dot(trail, trail), 0.0001), -0.5, 0.5);
      float separation = length(d - trail * t);
      if (magnitude > speed && separation <= 1.5 * max(cellPixels.x, cellPixels.y)) {
        best = v; speed = magnitude;
      }
    }
  }
  gl_FragColor = smbEncode(best);
}
