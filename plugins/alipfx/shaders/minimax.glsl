precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

// ---- 5 user parameters (Dynamic Number) ----
uniform float Operation;           // 0=Maximum, 1=Minimum, 2=Opening, 3=Closing
uniform float Radius;              // 0..127 px
uniform float Channel;             // 0=Color, 1=Alpha+Color, 2=R, 3=G, 4=B, 5=Alpha
uniform float Direction;           // 0=H&V, 1=H only, 2=V only
uniform float Dont_Shrink_Edges;   // 0/1

// ---- EXTRA: Pass (Static Number property in Panzoid) ----
#ifndef Pass
  #define Pass 1
#endif

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

// Luma metric for "Color" channel behavior (gives natural "bright bleeds outward")
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Return the scalar key used to choose best neighbor sample depending on Channel mode.
float keyForChannel(vec4 s, int ch)
{
  // 0: Color -> use luminance
  if (ch == 0) return luma(s.rgb);

  // 1: Alpha and Color -> use alpha so alpha expands AND color follows
  if (ch == 1) return s.a;

  // 2/3/4: R/G/B -> use that channel
  if (ch == 2) return s.r;
  if (ch == 3) return s.g;
  if (ch == 4) return s.b;

  // 5: Alpha -> alpha key
  return s.a;
}

// Pick best sample along a 1D line neighborhood (horizontal or vertical),
// using a scalar key so full colors can "bleed" by copying the best neighbor sample.
void morphLinePick(
  bool doMax,
  int r,
  int ch,
  vec2 dirVec,
  out vec4 bestS,
  out float bestK
){
  vec2 px = pxSizeScaled();

  // Initialize with center
  bestS = tex(vUvScaled);
  bestK = keyForChannel(bestS, ch);

  for (int ii = 0; ii <= 2*MAX_RADIUS; ii++)
  {
    int i = ii - MAX_RADIUS;
    if (iabs(i) > r) continue;

    vec4 s = tex(vUvScaled + dirVec * float(i) * px);
    float k = keyForChannel(s, ch);

    if (doMax)
    {
      if (k > bestK) { bestK = k; bestS = s; }
    }
    else
    {
      if (k < bestK) { bestK = k; bestS = s; }
    }
  }
}

// Combine H and V results for Direction=0 by comparing their keys
void combineHVPick(
  bool doMax,
  vec4 hS, float hK,
  vec4 vS, float vK,
  out vec4 outS,
  out float outK
){
  if (doMax)
  {
    if (vK > hK) { outS = vS; outK = vK; }
    else        { outS = hS; outK = hK; }
  }
  else
  {
    if (vK < hK) { outS = vS; outK = vK; }
    else        { outS = hS; outK = hK; }
  }
}

void main()
{
  vec4 center = tex(vUvScaled);

  int op  = int(floor(Operation + 0.5));
  int ch  = int(floor(Channel + 0.5));
  int dir = int(floor(Direction + 0.5));

  int r = int(floor(Radius + 0.5));
  r = int(clamp(float(r), 0.0, float(MAX_RADIUS)));

  if (r == 0)
  {
    gl_FragColor = center;
    return;
  }

  // ---- Decide which stage this pass runs (true 2-pass for op 2/3) ----
  bool bypass = false;
  bool stageIsMax = true; // true = Maximum stage, false = Minimum stage

#if Pass == 1
  // Pass 1:
  // 0 Max, 1 Min, 2 Opening -> Min first, 3 Closing -> Max first
  stageIsMax = (op == 0 || op == 3);
  if (op == 1 || op == 2) stageIsMax = false;
#else
  // Pass 2:
  // For op 0/1, bypass completely.
  // For op 2 (Opening), do Max second.
  // For op 3 (Closing), do Min second.
  if (op == 0 || op == 1)
  {
    bypass = true;
  }
  else
  {
    stageIsMax = (op == 2); // Opening: Max second, Closing: Min second
  }
#endif

  if (bypass)
  {
    gl_FragColor = center;
    return;
  }

  // ---- Run morphology selection (pick best neighbor sample) ----
  vec4 hS = center; float hK = keyForChannel(center, ch);
  vec4 vS = center; float vK = keyForChannel(center, ch);

  if (dir == 1 || dir == 0)
    morphLinePick(stageIsMax, r, ch, vec2(1.0, 0.0), hS, hK);

  if (dir == 2 || dir == 0)
    morphLinePick(stageIsMax, r, ch, vec2(0.0, 1.0), vS, vK);

  vec4 pickedS = hS;
  float pickedK = hK;

  if (dir == 0)
    combineHVPick(stageIsMax, hS, hK, vS, vK, pickedS, pickedK);
  else if (dir == 2)
  { pickedS = vS; pickedK = vK; }

  // ---- Apply Channel output rules ----
  // These rules are what makes Color "bleed", and Alpha+Color expand alpha properly.
  vec4 outc = center;

  if (ch == 0)
  {
    // Color: copy RGB from picked sample, keep original alpha
    outc.rgb = pickedS.rgb;
    outc.a   = center.a;
  }
  else if (ch == 1)
  {
    // Alpha and Color: copy full RGBA from picked sample
    // (this makes alpha expand/shrink outward and color follows)
    outc = pickedS;
  }
  else if (ch == 2)
  {
    // Red only: modify red channel based on picked sample, keep others
    outc.r = pickedS.r;
  }
  else if (ch == 3)
  {
    // Green only
    outc.g = pickedS.g;
  }
  else if (ch == 4)
  {
    // Blue only
    outc.b = pickedS.b;
  }
  else // ch == 5
  {
    // Alpha only: modify alpha, keep RGB
    outc.a = pickedS.a;
  }

  // ---- Don't Shrink Edges (alpha protection on Minimum stage) ----
  // Only applies when alpha is being modified (Channel 1 or 5) AND this stage is Minimum.
  if (Dont_Shrink_Edges > 0.5)
  {
    bool alphaAffected = (ch == 1 || ch == 5);
    if (alphaAffected && !stageIsMax)
    {
      // prevent alpha from going below original alpha
      outc.a = max(outc.a, center.a);
    }
  }

  gl_FragColor = outc;
}
