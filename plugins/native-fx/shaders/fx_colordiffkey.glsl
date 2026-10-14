uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;

uniform vec3 keyColor;
uniform float keyDiff1;
uniform float keyDiff2;
uniform float keyPrimary;
uniform float keyOther1;
uniform float keyOther2;
uniform float accurate;
uniform float view;
uniform vec4 partialA;
uniform vec4 partialB;
uniform float partialAGamma;
uniform float partialBGamma;
uniform vec3 matteLevels;

float cdkLinear(float v) {
  if (v <= 0.04045) {
    return v / 12.92;
  }
  return pow((v + 0.055) / 1.055, 2.4);
}

float cdkPick(vec3 c, float idx) {
  if (idx < 0.5) {
    return c.r;
  }
  if (idx < 1.5) {
    return c.g;
  }
  return c.b;
}

float cdkLevels(float v, float inBlack, float inWhite, float gamma, float outBlack, float outWhite) {
  float t = clamp((v - inBlack / 255.0) / max((inWhite - inBlack) / 255.0, 0.0001), 0.0, 1.0);
  t = pow(t, 1.0 / max(gamma, 0.01));
  return clamp(outBlack / 255.0 + t * (outWhite - outBlack) / 255.0, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv * uvScale;
  vec4 px = texture2D(tDiffuse, uv);
  if (view > 0.5 && view < 1.5) {
    gl_FragColor = px;
    return;
  }
  float a0 = max(px.a, 0.0);
  vec3 c = vec3(0.0);
  if (px.a > 0.000001) {
    c = px.rgb / px.a;
  }
  if (accurate > 0.5) {
    c = vec3(
      cdkLinear(clamp(c.r, 0.0, 1.0)),
      cdkLinear(clamp(c.g, 0.0, 1.0)),
      cdkLinear(clamp(c.b, 0.0, 1.0))
    );
  }
  float ua = 1.0 - clamp((cdkPick(c, keyPrimary) - cdkPick(c, keyOther1)) / keyDiff1, 0.0, 1.0);
  float ub = 1.0 - clamp((cdkPick(c, keyPrimary) - cdkPick(c, keyOther2)) / keyDiff2, 0.0, 1.0);
  float ca = cdkLevels(ua, partialA.x, partialA.y, partialAGamma, partialA.z, partialA.w);
  float cb = cdkLevels(ub, partialB.x, partialB.y, partialBGamma, partialB.z, partialB.w);
  float um = max(ua, ub);
  float cm = cdkLevels(max(ca, cb), matteLevels.x, matteLevels.y, matteLevels.z, 0.0, 255.0);
  if (view > 1.5) {
    float g = cm;
    if (view > 2.5 && view < 3.5) {
      g = um;
    } else if (view > 3.5 && view < 4.5) {
      g = ca;
    } else if (view > 4.5) {
      g = cb;
    }
    float m = g * a0;
    gl_FragColor = vec4(m, m, m, 1.0);
    return;
  }
  gl_FragColor = px * cm;
}
