precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

varying vec2 vUvScaled;

uniform float View;         // 0 = Final Output, 1 = Matte [1](https://helpx.adobe.com/in_hi/after-effects/using/matte-effects.html)
uniform float Choke_Matte;  // + = choke, - = spread [1](https://helpx.adobe.com/in_hi/after-effects/using/matte-effects.html)

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 clampUv(vec2 uv) { return clamp(uv, vec2(0.0), vec2(1.0)); }

const int TAP_COUNT = 64;

vec2 tapOffset(int i)
{
  // First 32 taps (same base set)
  if (i ==  0) return vec2(-0.613392,  0.617481);
  if (i ==  1) return vec2( 0.170019, -0.040254);
  if (i ==  2) return vec2(-0.299417,  0.791925);
  if (i ==  3) return vec2( 0.645680,  0.493210);
  if (i ==  4) return vec2(-0.651784,  0.717887);
  if (i ==  5) return vec2( 0.421003,  0.027070);
  if (i ==  6) return vec2(-0.817194, -0.271096);
  if (i ==  7) return vec2(-0.705374, -0.668203);
  if (i ==  8) return vec2( 0.977050, -0.108615);
  if (i ==  9) return vec2( 0.063326,  0.142369);
  if (i == 10) return vec2( 0.203528,  0.214331);
  if (i == 11) return vec2(-0.667531,  0.326090);
  if (i == 12) return vec2(-0.098422, -0.295755);
  if (i == 13) return vec2(-0.885922,  0.215369);
  if (i == 14) return vec2( 0.566637,  0.605213);
  if (i == 15) return vec2( 0.039766, -0.396100);
  if (i == 16) return vec2( 0.751946,  0.453352);
  if (i == 17) return vec2( 0.078707, -0.715323);
  if (i == 18) return vec2(-0.075838, -0.529344);
  if (i == 19) return vec2( 0.724479, -0.580798);
  if (i == 20) return vec2( 0.222999, -0.215125);
  if (i == 21) return vec2(-0.467574, -0.405438);
  if (i == 22) return vec2(-0.248268, -0.814753);
  if (i == 23) return vec2( 0.354411, -0.887570);
  if (i == 24) return vec2( 0.175817,  0.382366);
  if (i == 25) return vec2( 0.487472, -0.063082);
  if (i == 26) return vec2(-0.084078,  0.898312);
  if (i == 27) return vec2( 0.488876, -0.783441);
  if (i == 28) return vec2( 0.470016,  0.217933);
  if (i == 29) return vec2(-0.696890, -0.549791);
  if (i == 30) return vec2(-0.149693,  0.605762);
  if (i == 31) return vec2( 0.034211,  0.979980);

  // Next 16 taps (32..47) – denser neighborhood
  if (i == 32) return vec2(-0.934000, -0.121000);
  if (i == 33) return vec2( 0.900000,  0.192000);
  if (i == 34) return vec2(-0.215000,  0.965000);
  if (i == 35) return vec2( 0.246000,  0.827000);
  if (i == 36) return vec2( 0.489000,  0.872000);
  if (i == 37) return vec2(-0.959000,  0.282000);
  if (i == 38) return vec2(-0.373000, -0.114000);
  if (i == 39) return vec2( 0.122000, -0.930000);
  if (i == 40) return vec2( 0.940000, -0.322000);
  if (i == 41) return vec2(-0.562000, -0.015000);
  if (i == 42) return vec2( 0.010000,  0.550000);
  if (i == 43) return vec2(-0.206000,  0.439000);
  if (i == 44) return vec2( 0.622000, -0.019000);
  if (i == 45) return vec2(-0.283000, -0.959000);
  if (i == 46) return vec2( 0.517000, -0.787000);
  if (i == 47) return vec2(-0.739000,  0.012000);

  // Final 16 taps (48..63) – extra fill for smoother “disk”
  if (i == 48) return vec2( 0.833000,  0.520000);
  if (i == 49) return vec2(-0.520000,  0.833000);
  if (i == 50) return vec2(-0.833000, -0.520000);
  if (i == 51) return vec2( 0.520000, -0.833000);
  if (i == 52) return vec2( 0.000000, -0.650000);
  if (i == 53) return vec2( 0.000000,  0.650000);
  if (i == 54) return vec2( 0.650000,  0.000000);
  if (i == 55) return vec2(-0.650000,  0.000000);
  if (i == 56) return vec2( 0.300000,  0.953000);
  if (i == 57) return vec2(-0.300000, -0.953000);
  if (i == 58) return vec2( 0.953000, -0.300000);
  if (i == 59) return vec2(-0.953000,  0.300000);
  if (i == 60) return vec2( 0.707000,  0.707000);
  if (i == 61) return vec2(-0.707000,  0.707000);
  if (i == 62) return vec2( 0.707000, -0.707000);
  if (i == 63) return vec2(-0.707000, -0.707000);

  return vec2(0.0);
}

float chokedAlpha(vec2 uv, float radiusPx, float spreadFlag)
{
  // MIN for choke/erode, MAX for spread/dilate [2](https://www.cs.auckland.ac.nz/courses/compsci773s1c/lectures/ImageProcessing-html/topic4.htm)[1](https://helpx.adobe.com/in_hi/after-effects/using/matte-effects.html)
  float aCenter = texture2D(tDiffuse, uv).a;
  if (radiusPx <= 0.0001) return aCenter;

  vec2 texel = 1.0 / resolution;
  float acc = (spreadFlag > 0.5) ? 0.0 : 1.0;

  if (spreadFlag > 0.5) acc = max(acc, aCenter);
  else                  acc = min(acc, aCenter);

  for (int i = 0; i < TAP_COUNT; i++)
  {
    vec2 off = tapOffset(i) * (radiusPx * texel);
    float sa = texture2D(tDiffuse, clampUv(uv + off)).a;

    if (spreadFlag > 0.5) acc = max(acc, sa);
    else                  acc = min(acc, sa);
  }

  // axis + diagonal stabilizers
  vec2 dx = vec2(radiusPx * texel.x, 0.0);
  vec2 dy = vec2(0.0, radiusPx * texel.y);
  vec2 dd1 = vec2(radiusPx * texel.x,  radiusPx * texel.y);
  vec2 dd2 = vec2(radiusPx * texel.x, -radiusPx * texel.y);

  float ax1 = texture2D(tDiffuse, clampUv(uv + dx)).a;
  float ax2 = texture2D(tDiffuse, clampUv(uv - dx)).a;
  float ay1 = texture2D(tDiffuse, clampUv(uv + dy)).a;
  float ay2 = texture2D(tDiffuse, clampUv(uv - dy)).a;

  float ad1 = texture2D(tDiffuse, clampUv(uv + dd1)).a;
  float ad2 = texture2D(tDiffuse, clampUv(uv - dd1)).a;
  float ad3 = texture2D(tDiffuse, clampUv(uv + dd2)).a;
  float ad4 = texture2D(tDiffuse, clampUv(uv - dd2)).a;

  if (spreadFlag > 0.5) {
    acc = max(acc, max(max(ax1, ax2), max(ay1, ay2)));
    acc = max(acc, max(max(ad1, ad2), max(ad3, ad4)));
  } else {
    acc = min(acc, min(min(ax1, ax2), min(ay1, ay2)));
    acc = min(acc, min(min(ad1, ad2), min(ad3, ad4)));
  }

  return saturate(acc);
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  float r = abs(Choke_Matte);
  float spreadFlag = (Choke_Matte < 0.0) ? 1.0 : 0.0; // AE sign rule [1](https://helpx.adobe.com/in_hi/after-effects/using/matte-effects.html)

  float newA = chokedAlpha(vUvScaled, r, spreadFlag);

  float oldA = texel.a;
  vec3 rgb = texel.rgb;
  if (oldA > 1e-6) rgb *= (newA / oldA);

  vec4 outCol = vec4(rgb, newA);

  // AE-like Matte preview [1](https://helpx.adobe.com/in_hi/after-effects/using/matte-effects.html)
  if (View >= 0.5) {
    gl_FragColor = vec4(vec3(newA), 1.0);
  } else {
    gl_FragColor = outCol;
  }
}
