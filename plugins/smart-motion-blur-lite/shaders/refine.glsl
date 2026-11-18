precision highp float;
varying vec2 vUv;
uniform sampler2D tPair;
uniform sampler2D tFlow;
uniform vec2 levelSize;
uniform vec2 resolution;
vec2 previous(vec2 p) {
  return texture2D(tPair, clamp(p, 0.5 / levelSize, 1.0 - 0.5 / levelSize)).ba;
}
float patchCost(vec2 v) {
  float sum = 0.0;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    vec2 p=clamp(vUv + vec2(float(x),float(y))/levelSize,0.5/levelSize,1.0-0.5/levelSize);
    vec2 q=p+v/resolution;
    if (any(lessThan(q,vec2(0.0))) || any(greaterThan(q,vec2(1.0)))) return 2.0;
    vec2 d=previous(q)-texture2D(tPair,p).rg;
    sum += d.x*d.x+0.5*d.y*d.y;
  }
  return sum;
}
void main() {
  vec2 v = smbDecode(texture2D(tFlow, vUv));
  vec2 stepUV = 1.0 / levelSize;
  float xx = 0.0, xy = 0.0, yy = 0.0;
  vec2 b = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 p = clamp(vUv + vec2(float(x), float(y)) * stepUV, stepUV * 0.5, 1.0 - stepUV * 0.5);
      vec2 q = p + v / resolution;
      vec2 gx = 0.5 * (previous(q + vec2(stepUV.x, 0.0)) - previous(q - vec2(stepUV.x, 0.0)));
      vec2 gy = 0.5 * (previous(q + vec2(0.0, stepUV.y)) - previous(q - vec2(0.0, stepUV.y)));
      vec2 residual = previous(q) - texture2D(tPair, p).rg;
      // Alpha contributes to the normal equations without dividing by alpha.
      gx.y *= 0.7; gy.y *= 0.7; residual.y *= 0.7;
      float w = 1.0 / (1.0 + 8.0 * length(residual));
      xx += dot(gx, gx) * w; xy += dot(gx, gy) * w; yy += dot(gy, gy) * w;
      b += vec2(dot(gx, residual), dot(gy, residual)) * w;
    }
  }
  float regularizer = 0.000001 + 0.01 * (xx + yy);
  xx += regularizer; yy += regularizer;
  float determinant = max(xx * yy - xy * xy, 0.00000001);
  vec2 delta = -vec2(yy * b.x - xy * b.y, xx * b.y - xy * b.x) / determinant;
  delta = clamp(delta, vec2(-0.75), vec2(0.75));
  vec2 candidate = v + delta * resolution / levelSize;
  gl_FragColor = smbEncode(patchCost(candidate) < patchCost(v) ? candidate : v);
}

