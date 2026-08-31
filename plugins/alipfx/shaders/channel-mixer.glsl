precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// =====================================================
// AE-style Channel Mixer controls (dynamic Number props)
// =====================================================
// Recommended Panzoid property names exactly as below:
//
// Red_Red
// Red_Green
// Red_Blue
// Red_Const
//
// Green_Red
// Green_Green
// Green_Blue
// Green_Const
//
// Blue_Red
// Blue_Green
// Blue_Blue
// Blue_Const
//
// Monochrome
//
// Use Number (dynamic) for all.
// Percent-style values: usually range -200 to 200.
// Monochrome: 0 = off, 1 = on.
// =====================================================

uniform float Red_Red;
uniform float Red_Green;
uniform float Red_Blue;
uniform float Red_Const;

uniform float Green_Red;
uniform float Green_Green;
uniform float Green_Blue;
uniform float Green_Const;

uniform float Blue_Red;
uniform float Blue_Green;
uniform float Blue_Blue;
uniform float Blue_Const;

uniform float Monochrome;

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  vec3 src = texel.rgb;

  // Convert AE-style percentage sliders to normalized multipliers
  float rr = Red_Red      / 100.0;
  float rg = Red_Green    / 100.0;
  float rb = Red_Blue     / 100.0;
  float rc = Red_Const    / 100.0;

  float gr = Green_Red    / 100.0;
  float gg = Green_Green  / 100.0;
  float gb = Green_Blue   / 100.0;
  float gc = Green_Const  / 100.0;

  float br = Blue_Red     / 100.0;
  float bg = Blue_Green   / 100.0;
  float bb = Blue_Blue    / 100.0;
  float bc = Blue_Const   / 100.0;

  vec3 outRGB;

  // AE-style Monochrome:
  // Uses the RED output row as the grayscale mixer and replicates it to RGB.
  if (Monochrome >= 0.5)
  {
    float mono = src.r * rr + src.g * rg + src.b * rb + rc;
    mono = clamp(mono, 0.0, 1.0);
    outRGB = vec3(mono);
  }
  else
  {
    float outR = src.r * rr + src.g * rg + src.b * rb + rc;
    float outG = src.r * gr + src.g * gg + src.b * gb + gc;
    float outB = src.r * br + src.g * bg + src.b * bb + bc;

    outRGB = clamp(vec3(outR, outG, outB), 0.0, 1.0);
  }

  gl_FragColor = vec4(outRGB, texel.a);
}
