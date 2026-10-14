// Radial Shadow: single-pass shadow of the layer cast away from a point
// light source (radial scale k = 1 + distance/100 about the light point),
// tinted with the shadow color, blurred with a small fixed kernel, and
// composited behind the original. All sampling goes through uvScale, so no
// scratch targets are needed.
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform vec3 shadowColor;
uniform float shadowAlpha;
uniform vec2 lightSource;
uniform float projectionDistance;
uniform float colorInfluence;
uniform float renderMode;
uniform float softPx;
uniform float shadowOnly;

vec4 sampleLayer(vec2 luv) {
  if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) {
    return vec4(0.0);
  }
  return texture2D(tDiffuse, luv * uvScale);
}

vec4 shadowAt(vec2 luv) {
  float k = 1.0 + max(projectionDistance, 0.0) / 100.0;
  vec2 suv = lightSource + (luv - lightSource) / k;
  vec4 s = sampleLayer(suv);
  float sa = s.a;
  vec3 sc = sa > 0.00001 ? s.rgb / sa : vec3(0.0);
  float a = sa;
  if (renderMode > 0.5) {
    a = clamp(sa * (1.0 - sa) * 4.0, 0.0, 1.0);
  }
  a *= shadowAlpha;
  vec3 c = shadowColor + (sc - shadowColor) * clamp(colorInfluence, 0.0, 1.0);
  return vec4(c * a, a);
}

void main() {
  vec4 shadow;
  if (softPx <= 0.0) {
    shadow = shadowAt(vUv);
  } else {
    // 5x5 binomial blur over +/- softPx/2 layer pixels. A coarse but smooth
    // approximation for large radii; exact (single tap) at 0.
    vec2 stepUv = vec2((softPx * 0.125) / max(resolution.x, 1.0), (softPx * 0.125) / max(resolution.y, 1.0));
    vec4 sum = vec4(0.0);
    float wsum = 0.0;
    for (int j = -2; j <= 2; j++) {
      float wj = j == 0 ? 6.0 : ((j == 1 || j == -1) ? 4.0 : 1.0);
      for (int i = -2; i <= 2; i++) {
        float wi = i == 0 ? 6.0 : ((i == 1 || i == -1) ? 4.0 : 1.0);
        float w = wi * wj;
        sum += shadowAt(vUv + vec2(float(i), float(j)) * stepUv) * w;
        wsum += w;
      }
    }
    shadow = sum / wsum;
  }
  if (shadowOnly > 0.5) {
    gl_FragColor = shadow;
    return;
  }
  vec4 original = texture2D(tDiffuse, vUv * uvScale);
  gl_FragColor = original + shadow * (1.0 - original.a);
}
