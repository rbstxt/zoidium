precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/* ---- Panzoid custom properties ---- */
uniform float Tones;                 // 0=Duotone, 1=Tritone, 2=Pentone, 3=Solid
uniform vec3 Highlights;
uniform vec3 Brights;
uniform vec3 Midtones;
uniform vec3 Darktones;
uniform vec3 Shadows;
uniform float Blend_With_Original;   // 0..100 (0 = full effect, 100 = original)

/* Luma weights (Rec.601-like; closest to many AE/Cycore legacy behaviors) */
float luma601(vec3 c)
{
  return dot(c, vec3(0.299, 0.587, 0.114));
}

/* Toggle interpolation space:
   1 = mix in linear light (often closer to AE with linearized workflows)
   0 = mix in sRGB (often closer to AE legacy/non-linear look)
*/
#define USE_LINEAR_MIX 1

vec3 toLinear(vec3 c)
{
#if USE_LINEAR_MIX
  return pow(max(c, 0.0), vec3(2.2));
#else
  return c;
#endif
}

vec3 toSRGB(vec3 c)
{
#if USE_LINEAR_MIX
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
#else
  return c;
#endif
}

/* Tone mapping */
vec3 mapTones(float y, int mode)
{
  y = clamp(y, 0.0, 1.0);

  vec3 cH = toLinear(Highlights);
  vec3 cB = toLinear(Brights);
  vec3 cM = toLinear(Midtones);
  vec3 cD = toLinear(Darktones);
  vec3 cS = toLinear(Shadows);

  vec3 outC = cM;

  if (mode == 3)
  {
    // SOLID: use Midtones as single swatch
    outC = cM;
  }
  else if (mode == 0)
  {
    // DUOTONE: Shadows -> Highlights
    outC = mix(cS, cH, y);
  }
  else if (mode == 1)
  {
    // TRITONE: Shadows -> Midtones -> Highlights (mid at 0.5)
    if (y < 0.5)
    {
      float t = y / 0.5;
      outC = mix(cS, cM, t);
    }
    else
    {
      float t = (y - 0.5) / 0.5;
      outC = mix(cM, cH, t);
    }
  }
  else
  {
    // PENTONE: 0.00,0.25,0.50,0.75,1.00
    if (y < 0.25)
    {
      float t = y / 0.25;
      outC = mix(cS, cD, t);
    }
    else if (y < 0.50)
    {
      float t = (y - 0.25) / 0.25;
      outC = mix(cD, cM, t);
    }
    else if (y < 0.75)
    {
      float t = (y - 0.50) / 0.25;
      outC = mix(cM, cB, t);
    }
    else
    {
      float t = (y - 0.75) / 0.25;
      outC = mix(cB, cH, t);
    }
  }

  return toSRGB(outC);
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  float y = luma601(texel.rgb);

  // Round float to nearest int mode safely (NO int clamp()!)
  int mode = int(floor(Tones + 0.5));
  if (mode < 0) mode = 0;
  if (mode > 3) mode = 3;

  vec3 toned = mapTones(y, mode);

  // 0 = full effect, 100 = original
  float blend = clamp(Blend_With_Original / 100.0, 0.0, 1.0);
  vec3 finalRGB = mix(toned, texel.rgb, blend);

  gl_FragColor = vec4(finalRGB, texel.a);
}
