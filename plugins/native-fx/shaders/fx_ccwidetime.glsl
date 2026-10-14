// CC Wide Time (Native FX): one weighted-accumulation pass. The host evaluates
// the current frame (tBase on the first pass) plus explicitly requested
// forward/backward frame taps; this shader folds one tap texture per pass into
// the running total. Average mode divides by the tap count (uniform weight);
// accumulate mode sums like a photographic shutter. Sampled with uv * uvScale
// because CM3 effect buffers can be larger than the layer.
precision highp float;

uniform sampler2D tAcc;
uniform sampler2D tFrame;
uniform float uWeight;
uniform int uInit;
uniform int uAccumulate;

varying vec2 vUvScaled;

void main() {
  vec4 frame = texture2D(tFrame, vUvScaled);
  if (uInit != 0) {
    if (uAccumulate != 0) {
      gl_FragColor = frame;
    } else {
      gl_FragColor = frame * uWeight;
    }
    return;
  }
  vec4 acc = texture2D(tAcc, vUvScaled);
  if (uAccumulate != 0) {
    gl_FragColor = vec4(acc.rgb + frame.rgb, min(1.0, acc.a + frame.a));
  } else {
    gl_FragColor = acc + frame * uWeight;
  }
}
