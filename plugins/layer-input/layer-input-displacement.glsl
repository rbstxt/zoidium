precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform sampler2D tSource;
uniform vec3 uDisplacement;
uniform vec3 vDisplacement;
uniform float amount;
uniform vec2 uvScale;
uniform vec2 offset;
uniform float wrapMode;
uniform float sourceReady;

varying vec2 vUvScaled;
varying vec2 bgCoord;

void main() {
  vec2 baseUv = bgCoord;
  if (sourceReady < 0.5) {
    vec4 base = texture2D(tDiffuse, baseUv);
    float baseAlpha = clamp(base.a, 0.0, 1.0);
    gl_FragColor = vec4(base.rgb * baseAlpha, baseAlpha);
    return;
  }

  vec3 map = texture2D(tSource, fract(vUvScaled)).rgb;
  vec2 displacement = amount * vec2(dot(map, uDisplacement), dot(map, vDisplacement));
  vec2 uv = baseUv - displacement - offset;

  if (wrapMode < 0.5) {
    uv = min(uv, uvScale);
  } else if (wrapMode < 1.5) {
    uv = mod(uv, uvScale);
  } else {
    uv = abs(mod(uv + uvScale, uvScale * 2.0) - uvScale);
  }

  vec4 displaced = texture2D(tDiffuse, uv);
  float displacedAlpha = clamp(displaced.a, 0.0, 1.0);
  gl_FragColor = vec4(displaced.rgb * displacedAlpha, displacedAlpha);
}
