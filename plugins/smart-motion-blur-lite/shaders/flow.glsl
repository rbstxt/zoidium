precision highp float;
varying vec2 vUv;
uniform sampler2D tPair;
uniform sampler2D tCoarse;
uniform vec2 levelSize;
uniform vec2 resolution;
uniform vec2 coarseSize;
uniform float hasCoarse;
uniform float sensitivity;
// Signed full-buffer pixels in RG8; exact zero is byte 128.
vec2 decode(vec4 v) { return smbDecode(v); }
vec2 feature(vec2 p, bool previous) {
  vec2 h = 0.5 / levelSize;
  vec4 v = texture2D(tPair, clamp(p, h, 1.0 - h));
  return previous ? v.ba : v.rg;
}
float cost(vec2 displacement) {
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 p = clamp(vUv + vec2(float(x), float(y)) / levelSize, 0.5 / levelSize, 1.0 - 0.5 / levelSize);
    vec2 q = p + displacement / resolution;
    if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) return 2.0;
    vec2 d = feature(p, false) - feature(q, true);
    sum += d.x * d.x;
  }
  return sum / 9.0;
}
vec2 coarseVector() {
  vec2 grid = vUv * coarseSize - 0.5;
  vec2 cell = floor(grid), f = fract(grid), sum = vec2(0.0);
  for (int y=0;y<2;y++) for (int x=0;x<2;x++) {
    vec2 p = clamp((cell + vec2(float(x),float(y)) + 0.5) / coarseSize,
                   0.5 / coarseSize, 1.0 - 0.5 / coarseSize);
    float w = (x==0 ? 1.0-f.x : f.x) * (y==0 ? 1.0-f.y : f.y);
    sum += decode(texture2D(tCoarse,p)) * w;
  }
  return sum;
}
void main() {
  vec2 gridScale=levelSize/resolution; float penalty=0.00005;
  vec2 base = hasCoarse > 0.5 ? coarseVector() : vec2(0.0);
  vec2 best = base;
  float bestCost = cost(base);
  float zeroCost = cost(vec2(0.0));
  // Penalize departures from the coarse estimate. Reflective texture can
  // produce similar patch scores at incompatible displacements.
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (hasCoarse > 0.5 && (abs(float(x)) > 1.0 || abs(float(y)) > 1.0)) continue;
      vec2 d = clamp(base + vec2(float(x), float(y)) * resolution / levelSize,
                     vec2(-511.0), vec2(511.0));
      float c = cost(d);
      if (c + penalty * length((d - base)*gridScale) < bestCost + penalty * length((best - base)*gridScale)) {
        best = d;
        bestCost = c;
      }
    }
  }
  // An actual no-motion candidate must remain available at every level.
  if (zeroCost + penalty * length(base*gridScale) + 0.000001 < bestCost + penalty * length((best - base)*gridScale)) { best = vec2(0.0); bestCost = zeroCost; }
  float threshold = 0.0005;
  // Textureless regions cannot distinguish stationary from moving. Keep the
  // coarse estimate there instead of cutting holes into a moving surface.
  if (zeroCost < threshold * threshold && length(base) < 0.5) best = vec2(0.0);
  float confidence = 1.0 - smoothstep(0.025, 0.18, bestCost);
  vec2 matchUV = vUv + best / resolution;
  if (any(lessThan(matchUV, vec2(0.0))) || any(greaterThan(matchUV, vec2(1.0)))) confidence = 0.0;
  gl_FragColor = smbEncode(best);
}



