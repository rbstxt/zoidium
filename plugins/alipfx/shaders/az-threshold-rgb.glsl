precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Threshold sliders (0..255)
uniform float Red_Threshold;
uniform float Green_Threshold;
uniform float Blue_Threshold;

// Invert toggles (0 or 1 in UI, but we treat >0.5 as ON)
uniform float Invert_Red_Channel;
uniform float Invert_Green_Channel;
uniform float Invert_Blue_Channel;

// Blend (0..100)
uniform float Blend_With_Original;

float asToggle(float v)
{
  // <= 0.5 => 0 (OFF), > 0.5 => 1 (ON)
  return step(0.5, v);
}

// Matches AE: invert happens BEFORE thresholding
float thresholdChannel(float c, float thresh255, float invFlag)
{
  float inv = asToggle(invFlag);

  // invert channel pre-threshold
  c = mix(c, 1.0 - c, inv);

  // normalize threshold
  float t = clamp(thresh255 / 255.0, 0.0, 1.0);

  // hard threshold: value >= t => 1 else 0
  return step(t, c);
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  float r = thresholdChannel(texel.r, Red_Threshold, Invert_Red_Channel);
  float g = thresholdChannel(texel.g, Green_Threshold, Invert_Green_Channel);
  float b = thresholdChannel(texel.b, Blue_Threshold, Invert_Blue_Channel);

  vec4 threshRGB = vec4(r, g, b, texel.a);

  // Blend With Original: 0% = threshold only, 100% = original
  float blend = clamp(Blend_With_Original / 100.0, 0.0, 1.0);
  gl_FragColor = mix(threshRGB, texel, blend);
}
