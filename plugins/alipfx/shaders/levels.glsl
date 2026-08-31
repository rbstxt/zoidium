precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Panzoid properties (Dynamic Numbers)
uniform float Channel;               // 0=RGB, 1=R, 2=G, 3=B, 4=Alpha
uniform float Input_Black;           // 0..255
uniform float Input_White;           // 0..255
uniform float Gamma;                 // 0..5 (AE-style)
uniform float Output_Black;          // 0..255
uniform float Output_White;          // 0..255
uniform float Clip_To_Output_Black;  // 0=On, 1=Off, 2=Off for 32bpc
uniform float Clip_To_Output_White;  // 0=On, 1=Off, 2=Off for 32bpc

float safeDiv(float a, float b)
{
  // Preserve sign; avoid division by 0
  float s  = (b < 0.0) ? -1.0 : 1.0;
  float ab = max(abs(b), 1e-6);
  return a / (s * ab);
}

// AE-like Levels mapping with Gamma.
// Workflow:
// 1) Normalize: t = (x - inB) / (inW - inB)
// 2) Apply gamma curve only inside 0..1
// 3) Map to output: y = t*(outW - outB) + outB
float levels1(float x, float inB, float inW, float gammaVal, float outB, float outW)
{
  float t = safeDiv((x - inB), (inW - inB));

  // Gamma safety
  float g = max(gammaVal, 1e-4);

  // Apply gamma only in 0..1 region
  float tMid = clamp(t, 0.0, 1.0);
  float tShaped = pow(tMid, g);

  float tFinal = (t < 0.0) ? t : ((t > 1.0) ? t : tShaped);

  return tFinal * (outW - outB) + outB;
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // Convert 0..255 UI into 0..1 working range
  float inB  = Input_Black  / 255.0;
  float inW  = Input_White  / 255.0;
  float outB = Output_Black / 255.0;
  float outW = Output_White / 255.0;

  int ch = int(floor(Channel + 0.5));

  vec4 outCol = texel;

  if (ch == 0)
  {
    // RGB master = apply same mapping to each channel independently
    outCol.r = levels1(texel.r, inB, inW, Gamma, outB, outW);
    outCol.g = levels1(texel.g, inB, inW, Gamma, outB, outW);
    outCol.b = levels1(texel.b, inB, inW, Gamma, outB, outW);
    // Alpha unchanged in RGB mode
  }
  else if (ch == 1)
  {
    outCol.r = levels1(texel.r, inB, inW, Gamma, outB, outW);
  }
  else if (ch == 2)
  {
    outCol.g = levels1(texel.g, inB, inW, Gamma, outB, outW);
  }
  else if (ch == 3)
  {
    outCol.b = levels1(texel.b, inB, inW, Gamma, outB, outW);
  }
  else // ch == 4 (Alpha)
  {
    float oldA = texel.a;
    float newA = levels1(texel.a, inB, inW, Gamma, outB, outW);

    outCol.a = newA;

    // Make Alpha mode affect visible opacity/transparency in the comp
    // and behave better with downstream blur by scaling RGB with alpha change.
    float alphaScale = (oldA > 1e-6) ? (newA / oldA) : 0.0;
    outCol.rgb *= alphaScale;
  }

  // Clip toggles:
  // 0 = On => clamp to display range
  // 1/2 = Off => allow values outside 0..1
  bool clipBlack = (int(floor(Clip_To_Output_Black + 0.5)) == 0);
  bool clipWhite = (int(floor(Clip_To_Output_White + 0.5)) == 0);

  if (clipBlack)
  {
    outCol = max(outCol, vec4(0.0));
  }
  if (clipWhite)
  {
    outCol = min(outCol, vec4(1.0));
  }

  gl_FragColor = outCol;
}
