precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform sampler2D tSource;
uniform float sourceReady;
uniform float sourceOpacity;
varying vec2 vUvScaled;

void main() {
  vec4 base = texture2D(tDiffuse, vUvScaled);
  float baseAlpha = clamp(base.a, 0.0, 1.0);
  vec3 baseColor = base.rgb * baseAlpha;
  if (sourceReady < 0.5) {
    gl_FragColor = vec4(baseColor, baseAlpha);
    return;
  }

  vec4 source = texture2D(tSource, vUvScaled);
  float opacity = clamp(sourceOpacity, 0.0, 1.0);
  float sourceAlpha = clamp(source.a * opacity, 0.0, 1.0);
  float remainingBackground = baseAlpha * (1.0 - sourceAlpha);
  float outputAlpha = sourceAlpha + remainingBackground;
  vec3 outputColor = source.rgb * sourceAlpha + baseColor * (1.0 - sourceAlpha);
  gl_FragColor = vec4(outputColor, outputAlpha);
}
