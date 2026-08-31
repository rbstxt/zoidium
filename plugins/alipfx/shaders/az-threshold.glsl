precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/*
Create these Panzoid properties:

Threshold            (dynamic number) 0..255   default 127.5
Channel              (dynamic number) 0..3     default 0
  0 = Luminance
  1 = RGB
  2 = Saturation
  3 = Alpha
Invert               (dynamic number) 0..1     default 0
Blend_w_Original     (dynamic number) 0..100   default 0
*/

uniform float Threshold;
uniform float Channel;
uniform float Invert;
uniform float Blend_w_Original;

// Rec.709 relative luminance weights (common “true luminance” approximation)
float luminance709(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));  // Rec.709 [3](https://stackoverflow.com/questions/596216/formula-to-determine-perceived-brightness-of-rgb-color)[4](https://contrastchecker.online/color-relative-luminance-calculator)
}

// HSV-style saturation: (max-min)/max, 0 when max==0
float saturationHSV(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  return (mx <= 0.0) ? 0.0 : (mx - mn) / mx;
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // AE Threshold is 0..255 with default 127.5 [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
  float thr = clamp(Threshold, 0.0, 255.0) / 255.0;

  // Invert toggle (treat >0.5 as ON) [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
  float inv = (Invert > 0.5) ? 1.0 : 0.0;

  // Mix back to original: 0% = full effect, 100% = original [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
  float blend = clamp(Blend_w_Original, 0.0, 100.0) / 100.0;

  int ch = int(floor(Channel + 0.5));

  vec4 effected = texel;

  if (ch == 0) {
    // Luminance → black/white, keep alpha
    float v = luminance709(texel.rgb);
    float m = step(thr, v);              // v >= thr → 1 [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
    m = mix(m, 1.0 - m, inv);
    effected = vec4(vec3(m), texel.a);

  } else if (ch == 1) {
    // RGB → per-channel threshold (8 possible colors), keep alpha [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
    vec3 m = step(vec3(thr), texel.rgb);
    m = mix(m, vec3(1.0) - m, inv);
    effected = vec4(m, texel.a);

  } else if (ch == 2) {
    // Saturation → black/white based on saturation, keep alpha [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
    float s = saturationHSV(texel.rgb);
    float m = step(thr, s);
    m = mix(m, 1.0 - m, inv);
    effected = vec4(vec3(m), texel.a);

  } else {
    // Alpha → threshold alpha only (mostly irrelevant for opaque footage), RGB preserved [1](https://blog.csdn.net/qq_41176800/article/details/147867093)
    float m = step(thr, texel.a);
    m = mix(m, 1.0 - m, inv);
    effected = vec4(texel.rgb, m);
  }

  gl_FragColor = mix(effected, texel, blend);
}
