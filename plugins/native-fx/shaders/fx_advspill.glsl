uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;

uniform float keyPrimary;
uniform float keyOther1;
uniform float keyOther2;
uniform float suppression;
uniform float spillRange;
uniform float lumaCorrection;
uniform float tolerance;
uniform float desaturate;
uniform float neutral;
uniform float keyHue;

float aspPick(vec3 c, float idx) {
  if (idx < 0.5) {
    return c.r;
  }
  if (idx < 1.5) {
    return c.g;
  }
  return c.b;
}

float aspLumaWeight(float idx) {
  if (idx < 0.5) {
    return 0.2126;
  }
  if (idx < 1.5) {
    return 0.7152;
  }
  return 0.0722;
}

float aspHue(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  if (d < 0.0000001) {
    return 0.0;
  }
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
  return h;
}

void main() {
  vec2 uv = vUv * uvScale;
  vec4 px = texture2D(tDiffuse, uv);
  if (px.a <= 0.0) {
    gl_FragColor = px;
    return;
  }
  vec3 s = px.rgb / px.a;
  float w = 1.0;
  if (tolerance < 1.0) {
    float h = aspHue(s);
    float d0 = abs(h - keyHue);
    float d = min(d0, 1.0 - d0);
    w = clamp(1.0 - d / max(tolerance * 0.5, 0.0001), 0.0, 1.0);
  }
  float cO1 = aspPick(s, keyOther1);
  float cO2 = aspPick(s, keyOther2);
  float mx = max(cO1, cO2);
  float avg = 0.5 * (cO1 + cO2);
  float lim = mx + (avg - mx) * spillRange;
  float spill = max(aspPick(s, keyPrimary) - lim, 0.0) * suppression * w;
  float back = spill * aspLumaWeight(keyPrimary) * lumaCorrection + spill * neutral / 3.0;
  vec3 outc = s + vec3(back);
  if (keyPrimary < 0.5) {
    outc.r -= spill;
  } else if (keyPrimary < 1.5) {
    outc.g -= spill;
  } else {
    outc.b -= spill;
  }
  if (desaturate > 0.0 && spill > 0.0) {
    float l = 0.2126 * outc.r + 0.7152 * outc.g + 0.0722 * outc.b;
    float k = min(desaturate * min(spill * 4.0, 1.0), 1.0);
    outc += (vec3(l) - outc) * k;
  }
  gl_FragColor = vec4(outc * px.a, px.a);
}
