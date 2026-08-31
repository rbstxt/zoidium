precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- Panzoid custom properties (Dynamic Numbers) ---
uniform float Channel;     // 0=RGB, 1=R, 2=G, 3=B, 4=A
uniform float Highlights;  // -1..1
uniform float Midtones;    // -1..1
uniform float Shadows;     // -1..1

float clamp01(float x) { return clamp(x, 0.0, 1.0); }

// Cubic Hermite interpolation between yA and yB with slopes mA,mB (dy/dx).
float hermite(float yA, float yB, float mA, float mB, float t, float dx)
{
  float t2 = t * t;
  float t3 = t2 * t;

  float h00 =  2.0*t3 - 3.0*t2 + 1.0;
  float h10 =      t3 - 2.0*t2 + t;
  float h01 = -2.0*t3 + 3.0*t2;
  float h11 =      t3 -     t2;

  return h00*yA + h10*dx*mA + h01*yB + h11*dx*mB;
}

// AE-like 3-point curve (Shadows/Midtones/Highlights) with fixed endpoints.
float curvesAE3(float x, float sh, float mid, float hi)
{
  x = clamp01(x);

  // Control point positions
  const float x0 = 0.00;
  const float x1 = 0.25;
  const float x2 = 0.50;
  const float x3 = 0.75;
  const float x4 = 1.00;

  // Scale user controls: -1..1 -> -0.25..0.25 vertical movement
  // This keeps curve behavior stable and "AE-like" (pulling curve handle).
  float s = 0.25;

  // Control point values (y)
  float y0 = 0.0;
  float y1 = clamp01(x1 + s * sh);
  float y2 = clamp01(x2 + s * mid);
  float y3 = clamp01(x3 + s * hi);
  float y4 = 1.0;

  // Tangents (slopes dy/dx). Catmull-Rom style across uniform spacing.
  // Endpoints use one-sided differences.
  float m0 = (y1 - y0) / (x1 - x0);      // /0.25
  float m1 = (y2 - y0) / (x2 - x0);      // /0.50
  float m2 = (y3 - y1) / (x3 - x1);      // /0.50
  float m3 = (y4 - y2) / (x4 - x2);      // /0.50
  float m4 = (y4 - y3) / (x4 - x3);      // /0.25

  // Evaluate correct segment
  if (x < x1)
  {
    float t = (x - x0) / (x1 - x0);
    return clamp01(hermite(y0, y1, m0, m1, t, (x1 - x0)));
  }
  else if (x < x2)
  {
    float t = (x - x1) / (x2 - x1);
    return clamp01(hermite(y1, y2, m1, m2, t, (x2 - x1)));
  }
  else if (x < x3)
  {
    float t = (x - x2) / (x3 - x2);
    return clamp01(hermite(y2, y3, m2, m3, t, (x3 - x2)));
  }
  else
  {
    float t = (x - x3) / (x4 - x3);
    return clamp01(hermite(y3, y4, m3, m4, t, (x4 - x3)));
  }
}

void main()
{
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // Round to nearest int (Panzoid uses float uniforms)
  int ch = int(floor(Channel + 0.5));

  // Apply curve depending on channel selection
  if (ch == 0)
  {
    // RGB master: apply same curve to each color channel
    texel.r = curvesAE3(texel.r, Shadows, Midtones, Highlights);
    texel.g = curvesAE3(texel.g, Shadows, Midtones, Highlights);
    texel.b = curvesAE3(texel.b, Shadows, Midtones, Highlights);
  }
  else if (ch == 1)
  {
    texel.r = curvesAE3(texel.r, Shadows, Midtones, Highlights);
  }
  else if (ch == 2)
  {
    texel.g = curvesAE3(texel.g, Shadows, Midtones, Highlights);
  }
  else if (ch == 3)
  {
    texel.b = curvesAE3(texel.b, Shadows, Midtones, Highlights);
  }
  else // ch == 4 (Alpha)
  {
    texel.a = curvesAE3(texel.a, Shadows, Midtones, Highlights);
  }

  gl_FragColor = texel;
}
