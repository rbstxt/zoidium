uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform float chatter;
uniform float contrast;
uniform float strength;
uniform float estSigma;
uniform float estStep;

void main() {
  vec2 uv = vUv * uvScale;
  vec2 texel = vec2(
    uvScale.x / max(resolution.x, 1.0),
    uvScale.y / max(resolution.y, 1.0)
  );
  vec4 px = texture2D(tDiffuse, uv);
  float a0 = max(px.a, 0.0);
  vec3 c = vec3(0.0);
  if (px.a > 0.000001) {
    c = px.rgb / px.a;
  }
  float na = a0;
  if (chatter > 0.5) {
    float sum = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        sum += texture2D(tDiffuse, uv + vec2(float(i), float(j)) * texel).a;
      }
    }
    na = clamp((sum / 25.0 - 0.5) * 1.5 + 0.5, 0.0, 1.0);
  }
  if (estSigma > 0.001 && strength > 0.001 && a0 > 0.0001 && a0 < 0.999) {
    float sig2 = 2.0 * estSigma * estSigma;
    vec3 csum = vec3(0.0);
    float asum = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        vec2 off = vec2(float(i), float(j)) * estStep * texel;
        float d2 = float(i * i + j * j) * estStep * estStep;
        float w = exp(-d2 / sig2);
        vec4 q = texture2D(tDiffuse, uv + off);
        csum += q.rgb * w;
        asum += max(q.a, 0.0) * w;
      }
    }
    if (asum > 0.0001) {
      float t = strength * (1.0 - a0);
      c += (csum / asum - c) * t;
    }
  }
  na = clamp((na - 0.5) * contrast + 0.5, 0.0, 1.0);
  if (a0 <= 0.000001) {
    na = 0.0;
  }
  gl_FragColor = vec4(c * na, na);
}
