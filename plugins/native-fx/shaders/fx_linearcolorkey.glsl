uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;

uniform vec3 keyColor;
uniform float matchMode;
uniform float tolerance;
uniform float softness;
uniform float keep;
uniform float view;

vec3 lckHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d < 0.0000001) {
    return vec3(0.0, 0.0, l);
  }
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) {
    h = (c.g - c.b) / d;
    if (c.g < c.b) {
      h += 6.0;
    }
    h /= 6.0;
  } else if (mx == c.g) {
    h = ((c.b - c.r) / d + 2.0) / 6.0;
  } else {
    h = ((c.r - c.g) / d + 4.0) / 6.0;
  }
  return vec3(h, s, l);
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
  float d;
  if (matchMode > 0.5 && matchMode < 1.5) {
    vec3 hc = lckHsl(c);
    vec3 hk = lckHsl(keyColor);
    if (hc.y < 0.02) {
      d = 1.0;
    } else {
      float dd = abs(hc.x - hk.x);
      d = min(dd, 1.0 - dd) * 2.0;
    }
  } else if (matchMode > 1.5) {
    float sc = c.r + c.g + c.b;
    float sk = keyColor.r + keyColor.g + keyColor.b;
    vec2 pc = sc <= 0.000001 ? vec2(1.0 / 3.0) : vec2(c.r / sc, c.g / sc);
    vec2 pk = sk <= 0.000001 ? vec2(1.0 / 3.0) : vec2(keyColor.r / sk, keyColor.g / sk);
    d = length(pc - pk) / 1.41421356;
  } else {
    d = length(c - keyColor) / 1.73205081;
  }
  float v;
  if (softness > 0.000001) {
    v = clamp((d - tolerance) / softness, 0.0, 1.0);
  } else if (d > tolerance) {
    v = 1.0;
  } else {
    v = 0.0;
  }
  if (keep > 0.5) {
    v = 1.0 - v;
  }
  if (view > 1.5) {
    float m = v * a0;
    gl_FragColor = vec4(m, m, m, 1.0);
    return;
  }
  gl_FragColor = px * v;
}
