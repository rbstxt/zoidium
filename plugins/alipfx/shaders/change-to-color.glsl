precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform vec3 From;
uniform vec3 To;

uniform float Change;
uniform float Change_By;
uniform float Hue;
uniform float Lightness;
uniform float Saturation;
uniform float Softness;
uniform float View_Correction_Matte;

float sat1(float x)
{
  return clamp(x, 0.0, 1.0);
}

vec3 sat3(vec3 x)
{
  return clamp(x, 0.0, 1.0);
}

float max3(float a, float b, float c)
{
  return max(a, max(b, c));
}

float colorDiffMax(vec3 a, vec3 b)
{
  vec3 d = abs(a - b);
  return max3(d.r, d.g, d.b);
}

float luma709(vec3 c)
{
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hueWrap(float h)
{
  return fract(h + 1.0);
}

float shortestHueDelta(float a, float b)
{
  float d = b - a;
  if (d > 0.5) d -= 1.0;
  if (d < -0.5) d += 1.0;
  return d;
}

float hueDistance01(float a, float b)
{
  float d = abs(a - b);
  d = min(d, 1.0 - d);
  return d * 2.0;
}

vec3 rgb2hsl(vec3 c)
{
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float h = 0.0;
  float s = 0.0;
  float l = 0.5 * (maxc + minc);
  float d = maxc - minc;

  if (d > 1e-6)
  {
    s = d / (1.0 - abs(2.0 * l - 1.0));

    if (maxc == c.r)
    {
      h = mod((c.g - c.b) / d, 6.0);
    }
    else if (maxc == c.g)
    {
      h = ((c.b - c.r) / d) + 2.0;
    }
    else
    {
      h = ((c.r - c.g) / d) + 4.0;
    }

    h /= 6.0;
    if (h < 0.0) h += 1.0;
  }

  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t)
{
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl)
{
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;

  if (s <= 1e-6)
  {
    return vec3(l);
  }

  float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
  float p = 2.0 * l - q;

  return vec3(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0)
  );
}

float featherMask(float dist, float tol, float softness)
{
  tol = sat1(tol);
  softness = sat1(softness);

  // Percent-based softness:
  // 0%  = almost hard edge
  // 100% = very wide feather
  float feather = max(0.0001, softness);

  if (dist <= tol) return 1.0;
  if (dist >= tol + feather) return 0.0;

  return 1.0 - smoothstep(tol, tol + feather, dist);
}

float computeHueMask(vec3 pxHSL, vec3 fromHSL, float hueTol, float softness)
{
  float d = hueDistance01(pxHSL.x, fromHSL.x);
  float base = featherMask(d, hueTol, softness);

  // Hue is unreliable for very low saturation colors.
  // Instead of forcing full match, softly reduce its authority.
  float reliability = smoothstep(0.02, 0.15, max(pxHSL.y, fromHSL.y));
  return mix(0.5 + 0.5 * base, base, reliability);
}

float computeLightMask(vec3 pxHSL, vec3 fromHSL, float lightTol, float softness)
{
  float d = abs(pxHSL.z - fromHSL.z);
  return featherMask(d, lightTol, softness);
}

float computeSatMask(vec3 pxHSL, vec3 fromHSL, float satTol, float softness)
{
  float d = abs(pxHSL.y - fromHSL.y);
  return featherMask(d, satTol, softness);
}

vec3 preserveLuma(vec3 srcRGB, vec3 dstRGB)
{
  float srcL = luma709(srcRGB);
  float dstL = luma709(dstRGB);

  if (dstL < 1e-5)
  {
    return dstRGB;
  }

  vec3 scaled = dstRGB * (srcL / dstL);
  return sat3(mix(dstRGB, scaled, 0.85));
}

bool effectIsNoOp(vec3 fromHSL, vec3 toHSL, int changeMode, int changeByMode)
{
  // If RGB colors are nearly identical, effect should do nothing.
  if (colorDiffMax(From, To) < 0.001)
  {
    return true;
  }

  float hueDelta = abs(shortestHueDelta(fromHSL.x, toHSL.x));
  float satDelta = abs(fromHSL.y - toHSL.y);
  float ligDelta = abs(fromHSL.z - toHSL.z);

  // Hue-only with achromatic destination should not invent hue.
  if (changeByMode == 0 && changeMode == 0 && toHSL.y < 0.001)
  {
    return true;
  }

  // General mode-based no-op detection
  if (changeMode == 0)
  {
    return hueDelta < 0.0005;
  }
  else if (changeMode == 1)
  {
    return hueDelta < 0.0005 && ligDelta < 0.0005;
  }
  else if (changeMode == 2)
  {
    return hueDelta < 0.0005 && satDelta < 0.0005;
  }
  else
  {
    return hueDelta < 0.0005 && satDelta < 0.0005 && ligDelta < 0.0005;
  }
}

vec3 applySetToColor(vec3 pxHSL, vec3 toHSL, int changeMode)
{
  vec3 outHSL = pxHSL;

  if (changeMode == 0)
  {
    // Hue
    // If target is achromatic, hue should not be forced.
    if (toHSL.y > 0.001)
    {
      outHSL.x = toHSL.x;
    }
  }
  else if (changeMode == 1)
  {
    // Hue & Lightness
    if (toHSL.y > 0.001)
    {
      outHSL.x = toHSL.x;
    }
    outHSL.z = toHSL.z;
  }
  else if (changeMode == 2)
  {
    // Hue & Saturation
    if (toHSL.y > 0.001)
    {
      outHSL.x = toHSL.x;
    }
    outHSL.y = toHSL.y;
  }
  else
  {
    // Hue, Lightness & Saturation
    // Full replacement is allowed here
    outHSL = toHSL;
  }

  outHSL.x = hueWrap(outHSL.x);
  outHSL.y = sat1(outHSL.y);
  outHSL.z = sat1(outHSL.z);

  return outHSL;
}

vec3 applyTransformToColor(vec3 pxHSL, vec3 fromHSL, vec3 toHSL, int changeMode)
{
  vec3 outHSL = pxHSL;

  float dHue = shortestHueDelta(fromHSL.x, toHSL.x);
  float dSat = toHSL.y - fromHSL.y;
  float dLig = toHSL.z - fromHSL.z;

  if (changeMode == 0)
  {
    if (fromHSL.y > 0.001 && toHSL.y > 0.001)
    {
      outHSL.x = hueWrap(pxHSL.x + dHue);
    }
  }
  else if (changeMode == 1)
  {
    if (fromHSL.y > 0.001 && toHSL.y > 0.001)
    {
      outHSL.x = hueWrap(pxHSL.x + dHue);
    }
    outHSL.z = sat1(pxHSL.z + dLig);
  }
  else if (changeMode == 2)
  {
    if (fromHSL.y > 0.001 && toHSL.y > 0.001)
    {
      outHSL.x = hueWrap(pxHSL.x + dHue);
    }
    outHSL.y = sat1(pxHSL.y + dSat);
  }
  else
  {
    if (fromHSL.y > 0.001 && toHSL.y > 0.001)
    {
      outHSL.x = hueWrap(pxHSL.x + dHue);
    }
    outHSL.y = sat1(pxHSL.y + dSat);
    outHSL.z = sat1(pxHSL.z + dLig);
  }

  return outHSL;
}

void main()
{
  vec4 src = texture2D(tDiffuse, vUvScaled);

  vec3 pxRGB = src.rgb;
  vec3 pxHSL = rgb2hsl(pxRGB);
  vec3 fromHSL = rgb2hsl(From);
  vec3 toHSL = rgb2hsl(To);

  int changeMode = int(floor(Change + 0.5));
  int changeByMode = int(floor(Change_By + 0.5));

  // HARD SAFETY: true no-op on default / identical colors
  if (effectIsNoOp(fromHSL, toHSL, changeMode, changeByMode))
  {
    if (View_Correction_Matte >= 0.5)
    {
      gl_FragColor = vec4(0.0, 0.0, 0.0, src.a);
    }
    else
    {
      gl_FragColor = src;
    }
    return;
  }

  // 0..100% controls
  float hueTol  = sat1(Hue / 100.0);
  float ligTol  = sat1(Lightness / 100.0);
  float satTol  = sat1(Saturation / 100.0);
  float softAmt = sat1(Softness / 100.0);

  float mHue = computeHueMask(pxHSL, fromHSL, hueTol, softAmt);
  float mLig = computeLightMask(pxHSL, fromHSL, ligTol, softAmt);
  float mSat = computeSatMask(pxHSL, fromHSL, satTol, softAmt);

  float matte = pow(sat1(mHue * mLig * mSat), mix(1.25, 0.75, softAmt));
  matte = sat1(matte);

  vec3 outHSL;

  if (changeByMode == 0)
  {
    outHSL = applySetToColor(pxHSL, toHSL, changeMode);
  }
  else
  {
    outHSL = applyTransformToColor(pxHSL, fromHSL, toHSL, changeMode);
  }

  vec3 changedRGB = hsl2rgb(outHSL);

  if (changeMode == 0 || changeMode == 2)
  {
    changedRGB = preserveLuma(pxRGB, changedRGB);
  }

  vec3 finalRGB = mix(pxRGB, changedRGB, matte);

  if (View_Correction_Matte >= 0.5)
  {
    gl_FragColor = vec4(vec3(matte), src.a);
  }
  else
  {
    gl_FragColor = vec4(sat3(finalRGB), src.a);
  }
}
