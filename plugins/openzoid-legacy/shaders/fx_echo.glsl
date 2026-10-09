uniform sampler2D tBase;
uniform sampler2D tTap;
uniform vec2 uvScale;
uniform float weight;
uniform float threshold;
uniform float wsum;
uniform float finalize;
uniform float useScaledBase;

varying vec2 vUv;
varying vec2 vUvScaled;

float echoLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float echoGate(vec3 c) {
  if (threshold < 0.001) return 1.0;
  return smoothstep(threshold - 0.08, threshold + 0.08, echoLuma(c));
}

void main()
{
  vec2 buv = mix(vUv, vUvScaled, clamp(useScaledBase, 0.0, 1.0));
  vec4 base = texture2D(tBase, buv);
  vec4 tap = texture2D(tTap, vUv);
  tap *= echoGate(tap.rgb) * weight;

  vec4 outc;
#if ECHO_MODE==3
  // Screen: filmic-style light trails, softer clipping than additive.
  outc = vec4(vec3(1.0) - (vec3(1.0) - base.rgb) * (vec3(1.0) - clamp(tap.rgb, 0.0, 1.0)), max(base.a, tap.a));
#elif ECHO_MODE==2
  // Additive: long-exposure buildup, clamps at white.
  outc = clamp(base + tap, vec4(0.0), vec4(1.0));
#elif ECHO_MODE==1
  // Maximum: clean light trails, stable on static frames.
  outc = max(base, tap);
#else
  // Smear: normalized motion-blur average. Intermediate steps accumulate
  // the weighted sum; the final step divides by the total weight.
  vec4 s = base + tap;
  outc = (finalize > 0.5) ? s / max(wsum, 0.0001) : s;
#endif

  gl_FragColor = outc;
}
