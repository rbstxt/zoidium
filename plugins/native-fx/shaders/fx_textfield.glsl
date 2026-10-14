// Text field overlay (NATIVE FX, shared by Numbers and Timecode): composites
// a CPU-rasterised glyph coverage texture (R = fill, G = stroke ring) with
// fill/stroke display options over the layer (or on transparency), plus an
// optional solid box behind the text (Timecode). Coverage bytes are analytic
// per-pixel values computed in JS, identical on every machine; rows are
// uploaded flipped so sampling uses plain vUv.
uniform sampler2D tDiffuse;
uniform sampler2D uText;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform vec4 uFill;     // straight rgb + alpha
uniform vec4 uStroke;   // straight rgb + alpha
uniform float uDisplay; // 0 fill only, 1 stroke only, 2 fill over stroke, 3 stroke over fill
uniform float uComposite; // 1 = over the layer, 0 = text on transparency
uniform vec4 uBoxRect;  // x0, x1, y0, y1 in buffer px (y down), valid when uBoxOn > 0.5
uniform vec4 uBoxColor; // straight rgb + alpha (opacity baked in)
uniform float uBoxOn;

vec4 over(vec4 dst, vec4 src) {
  return src + dst * (1.0 - src.a);
}

vec4 tint(vec4 c, float a0) {
  float a = clamp(a0 * c.a, 0.0, 1.0);
  return vec4(c.rgb * a, a);
}

void main() {
  vec4 out_;
  if (uComposite > 0.5) {
    out_ = texture2D(tDiffuse, vUv * uvScale);
  } else {
    out_ = vec4(0.0);
  }
  if (uBoxOn > 0.5) {
    float fx = vUv.x * resolution.x;
    float fy = (1.0 - vUv.y) * resolution.y;
    float cy = clamp(fy - uBoxRect.z + 0.5, 0.0, 1.0) * clamp(uBoxRect.w - fy + 0.5, 0.0, 1.0);
    if (cy > 0.0) {
      float cx = clamp(fx - uBoxRect.x + 0.5, 0.0, 1.0) * clamp(uBoxRect.y - fx + 0.5, 0.0, 1.0);
      float k = cx * cy * uBoxColor.a;
      if (k > 0.0) {
        out_ = over(out_, vec4(uBoxColor.rgb * k, k));
      }
    }
  }
  vec2 cov = texture2D(uText, vUv).rg;
  vec4 fill = tint(uFill, cov.x);
  vec4 stroke = tint(uStroke, cov.y);
  int mode = int(uDisplay + 0.5);
  if (mode == 1) {
    out_ = over(out_, stroke);
  } else if (mode == 2) {
    out_ = over(over(out_, stroke), fill);
  } else if (mode == 3) {
    out_ = over(over(out_, fill), stroke);
  } else {
    out_ = over(out_, fill);
  }
  gl_FragColor = out_;
}
