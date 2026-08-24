uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform float density;
uniform float decay;
uniform float weight;
uniform vec2 center;

#ifdef DITHER
uniform float dither;
#endif

const int SAMPLES = 24;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.0, 289.0))) * 45758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 centerOffset = 0.5 + center.xy * 0.45;
  vec2 tuv = uv - centerOffset;
  float angleStep = density * 0.2 / float(SAMPLES);

#ifdef DITHER
  float noise = hash(floor(uv * resolution));
  float angleOffset = angleStep * (noise * 2.0 - 1.0) * dither;
  float c0 = cos(angleOffset);
  float s0 = sin(angleOffset);
  tuv = mat2(c0, -s0, s0, c0) * tuv;
#endif

#ifdef CONSTANT_BRIGHTNESS
  vec4 color = vec4(0.0);
#else
  vec2 sampleUV = tuv + centerOffset;
  vec4 color = texture2D(tDiffuse, sampleUV * uvScale) * 0.25;
#endif

  float wt = weight;
  float sum = 0.0;
  float aspect = resolution.x / resolution.y;
  float c = cos(angleStep);
  float s = sin(angleStep);
  mat2 rotPos = mat2(c, -s, s, c);
  mat2 rotNeg = mat2(c, s, -s, c);
  vec2 tuvPos = tuv;
  vec2 tuvNeg = tuv;

  vec2 pos = tuv + centerOffset;
  color += texture2D(tDiffuse, pos * uvScale) * wt;
  sum += wt;
  wt *= decay;

  for (int i = 0; i < SAMPLES / 2; i++) {
    tuvPos.x *= aspect;
    tuvPos = rotPos * tuvPos;
    tuvPos.x /= aspect;
    pos = tuvPos + centerOffset;
    color += texture2D(tDiffuse, pos * uvScale) * wt;
    sum += wt;

    tuvNeg.x *= aspect;
    tuvNeg = rotNeg * tuvNeg;
    tuvNeg.x /= aspect;
    pos = tuvNeg + centerOffset;
    color += texture2D(tDiffuse, pos * uvScale) * wt;
    sum += wt;
    wt *= decay;
  }

#ifdef CONSTANT_BRIGHTNESS
  color /= sum;
  gl_FragColor = color;
#else
  color *= 1.0 - dot(tuv, tuv) * 0.75;
  gl_FragColor = smoothstep(0.0, 1.0, color);
#endif
}
