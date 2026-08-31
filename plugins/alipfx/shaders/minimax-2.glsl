precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

// ---- 5 parameters (Dynamic Number) ----
uniform float Operation;           // 0=Maximum, 1=Minimum, 2=Opening, 3=Closing
uniform float Radius;              // 0..127 px
uniform float Channel;             // 0=Color, 1=Alpha+Color, 2=R, 3=G, 4=B, 5=Alpha
uniform float Direction;           // ANGLE in degrees (0..360)
uniform float Dont_Shrink_Edges;   // 0/1

// ---- Pass (Static Number) ----
#ifndef Pass
  #define Pass 1
#endif

// 0 = sample only along the rotated direction
// 1 = sample along rotated direction AND its perpendicular, combined like H&V
#define ROTATED_CROSS 0

#define MAX_RADIUS 127

int iabs(int x) { return (x < 0) ? -x : x; }

vec2 pxSizeScaled() { return uvScale / resolution; }

vec4 tex(vec2 uv)
{
  vec2 px = pxSizeScaled();
  vec2 lo = vec2(0.0);
  vec2 hi = uvScale - px * 0.5;
  return texture2D(tDiffuse, clamp(uv, lo, hi));
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float keyForChannel(vec4 s, int ch)
{
  if (ch == 0) return luma(s.rgb);
  if (ch == 1) return s.a;
  if (ch == 2) return s.r;
  if (ch == 3) return s.g;
  if (ch == 4) return s.b;
  return s.a;
}

// dirPix = direction in pixel space (already scaled by px size)
void morphLinePickPix(
  bool doMax,
  int r,
  int ch,
  vec2 dirPix,
  out vec4 bestS,
  out float bestK
){
  bestS = tex(vUvScaled);
  bestK = keyForChannel(bestS, ch);

  for (int ii = 0; ii <= 2*MAX_RADIUS; ii++)
  {
    int i = ii - MAX_RADIUS;
    if (iabs(i) > r) continue;

    vec4 s = tex(vUvScaled + dirPix * float(i));
    float k = keyForChannel(s, ch);

    if (doMax) { if (k > bestK) { bestK = k; bestS = s; } }
    else       { if (k < bestK) { bestK = k; bestS = s; } }
  }
}

void combinePick(
  bool doMax,
  vec4 aS, float aK,
  vec4 bS, float bK,
  out vec4 outS,
  out float outK
){
  if (doMax)
  {
    if (bK > aK) { outS = bS; outK = bK; }
    else        { outS = aS; outK = aK; }
  }
  else
  {
    if (bK < aK) { outS = bS; outK = bK; }
    else        { outS = aS; outK = aK; }
  }
}

void main()
{
  vec4 center = tex(vUvScaled);

  int op  = int(floor(Operation + 0.5));
  int ch  = int(floor(Channel + 0.5));

  int r = int(floor(Radius + 0.5));
  r = int(clamp(float(r), 0.0, float(MAX_RADIUS)));

  if (r == 0) { gl_FragColor = center; return; }

  // ---- Two-pass stage selection ----
  bool bypass = false;
  bool stageIsMax = true;

#if Pass == 1
  stageIsMax = (op == 0 || op == 3);
  if (op == 1 || op == 2) stageIsMax = false;
#else
  if (op == 0 || op == 1) bypass = true;
  else stageIsMax = (op == 2);
#endif

  if (bypass) { gl_FragColor = center; return; }

  // ---- Build rotated direction in pixel UV space ----
  // Direction is degrees
  float ang = radians(Direction);
  vec2 u = vec2(cos(ang), sin(ang));          // unit direction
  vec2 px = pxSizeScaled();
  vec2 dirPix = vec2(u.x * px.x, u.y * px.y); // scale by pixel size

  vec4 s1 = center; float k1 = keyForChannel(center, ch);
  morphLinePickPix(stageIsMax, r, ch, dirPix, s1, k1);

#if ROTATED_CROSS == 1
  // also sample perpendicular axis and combine like H&V
  vec2 v = vec2(-u.y, u.x);
  vec2 dirPix2 = vec2(v.x * px.x, v.y * px.y);
  vec4 s2 = center; float k2 = keyForChannel(center, ch);
  morphLinePickPix(stageIsMax, r, ch, dirPix2, s2, k2);

  vec4 pickedS; float pickedK;
  combinePick(stageIsMax, s1, k1, s2, k2, pickedS, pickedK);
#else
  vec4 pickedS = s1;
#endif

  // ---- Channel output rules ----
  vec4 outc = center;

  if (ch == 0) { outc.rgb = pickedS.rgb; outc.a = center.a; }
  else if (ch == 1) { outc = pickedS; }
  else if (ch == 2) { outc.r = pickedS.r; }
  else if (ch == 3) { outc.g = pickedS.g; }
  else if (ch == 4) { outc.b = pickedS.b; }
  else              { outc.a = pickedS.a; }

  // ---- Don't Shrink Edges ----
  if (Dont_Shrink_Edges > 0.5)
  {
    bool alphaAffected = (ch == 1 || ch == 5);
    if (alphaAffected && !stageIsMax)
      outc.a = max(outc.a, center.a);
  }

  gl_FragColor = outc;
}
