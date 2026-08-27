precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Power;
uniform vec3 StartColor;
uniform vec3 EndColor;

vec4 premultiplyColor(vec4 colorValue) {
    float alpha = clamp(colorValue.a, 0.0, 1.0);
    return vec4(colorValue.rgb * alpha, alpha);
}

vec4 sourceOverColor(vec4 backgroundColor, vec3 effectColor, float effectAlpha) {
    float sourceAlpha = clamp(effectAlpha, 0.0, 1.0);
    float backgroundAlpha = clamp(backgroundColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = effectColor * sourceAlpha + backgroundColor.rgb * remainingBackground;
    return vec4(outputColor, outputAlpha);
}

varying vec2 vUvScaled;


float easeInOutPower(float t, float p) {
  if (t < 0.5) {
    return 0.5 * pow(2.0 * t, p);
  } else {
    return 1.0 - 0.5 * pow(2.0 * (1.0 - t), p);
  }
}
void main()
{
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  float eased = easeInOutPower(vUvScaled.x, Power);
  vec3 color = mix(StartColor, EndColor, eased);
  gl_FragColor = sourceOverColor(sourceTexel, color, 1.0);
}
