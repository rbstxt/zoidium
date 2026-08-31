precision highp float;
precision highp int;

uniform sampler2D tDiffuse;

uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

/*
  === 9 PARAMETERS ===
  Center            : vec2  (NOW IN AE PIXELS!)
  Direction         : float (degrees)
  Shapes            : float (0 Linear, 1 Smooth, 2 Sharp)
  Width             : float (pixels)
  Sweep_Intensity   : float (percent-like)
  Edge_Intensity    : float (percent-like)
  Edge_Thickness    : float (pixels)
  Light_Color       : vec3
  Light_Reception   : float (0 Add, 1 Composite, 2 Cutout)
*/

uniform vec2  Center;
uniform float Direction;
uniform float Shapes;
uniform float Width;
uniform float Sweep_Intensity;
uniform float Edge_Intensity;
uniform float Edge_Thickness;
uniform vec3  Light_Color;
uniform float Light_Reception;

float saturate(float x) { return clamp(x, 0.0, 1.0); }

vec4 sampleLayer(vec2 uv01)
{
  return texture2D(tDiffuse, uv01 * uvScale);
}

float bandFalloff(float d, float halfW, float shapeMode)
{
  float t = saturate(1.0 - d / max(halfW, 1e-6));

  if (shapeMode < 0.5)        return t;                               // Linear
  else if (shapeMode < 1.5)   return t * t * (3.0 - 2.0 * t);         // Smooth
  else                       return pow(t, 8.0);                      // Sharp
}

float edgeMask(vec2 uv01, float thicknessPx)
{
  float minRes = min(resolution.x, resolution.y);
  float px = 1.0 / max(minRes, 1.0);

  float r1 = px;
  float r2 = max(thicknessPx / max(minRes, 1.0), px);

  float a0 = sampleLayer(uv01).a;
  if (a0 <= 0.0) return 0.0;

  float ax1 = sampleLayer(uv01 + vec2( r1, 0.0)).a;
  float ax2 = sampleLayer(uv01 + vec2(-r1, 0.0)).a;
  float ay1 = sampleLayer(uv01 + vec2(0.0,  r1)).a;
  float ay2 = sampleLayer(uv01 + vec2(0.0, -r1)).a;

  float bx1 = sampleLayer(uv01 + vec2( r2, 0.0)).a;
  float bx2 = sampleLayer(uv01 + vec2(-r2, 0.0)).a;
  float by1 = sampleLayer(uv01 + vec2(0.0,  r2)).a;
  float by2 = sampleLayer(uv01 + vec2(0.0, -r2)).a;

  float g1 = (abs(a0 - ax1) + abs(a0 - ax2) + abs(a0 - ay1) + abs(a0 - ay2)) * 0.25;
  float g2 = (abs(a0 - bx1) + abs(a0 - bx2) + abs(a0 - by1) + abs(a0 - by2)) * 0.25;

  float g = max(g1, g2);
  float edge = saturate(g * 6.0);

  return edge * a0;
}

void main()
{
  vec4 base = texture2D(tDiffuse, vUvScaled);

  vec2 uv = vUv;

  // === 1) Center (AE PIXELS -> UV) ===
  // AE pixel origin = top-left (y down). Panzoid vUv origin = bottom-left (y up).
  // Convert pixels to normalized UV and flip Y.
  vec2 c = vec2(
    Center.x / max(resolution.x, 1.0),
    1.0 - (Center.y / max(resolution.y, 1.0))
  );

  // === 2) Direction ===
  float rad = radians(Direction);
  vec2 axis = normalize(vec2(sin(rad), cos(rad))); // 0° vertical, 90° horizontal
  vec2 nrm  = vec2(axis.y, -axis.x);

  float dist = dot(uv - c, nrm);
  float ad   = abs(dist);

  // === 4) Width (px -> normalized) ===
  float minRes = min(resolution.x, resolution.y);
  float halfW = (max(Width, 0.0) / max(minRes, 1.0));

  // === 3) Shapes ===
  float sweepMask = bandFalloff(ad, halfW, Shapes);
  sweepMask = saturate(sweepMask + pow(sweepMask, 6.0) * 0.25); // subtle hot core

  // === 7) Edge Thickness ===
  float eMask = edgeMask(uv, Edge_Thickness);
  float edgeSweep = eMask * sweepMask;

  // === 5/6) Intensities ===
  float sweepI = Sweep_Intensity / 100.0;
  float edgeI  = Edge_Intensity  / 100.0;

  float lightAmount = (sweepMask * sweepI + edgeSweep * edgeI) * base.a;

  // === 8) Light Color ===
  vec3 lightRGB = Light_Color * lightAmount;

  // === 9) Light Reception ===
  vec3 outRGB = base.rgb;
  float outA  = base.a;

  if (Light_Reception < 0.5)             // Add
  {
    outRGB = base.rgb + lightRGB;
  }
  else if (Light_Reception < 1.5)        // Composite (screen-like)
  {
    outRGB = 1.0 - (1.0 - base.rgb) * (1.0 - lightRGB);
  }
  else                                   // Cutout
  {
    outRGB = base.rgb * sweepMask + (Light_Color * (sweepMask * sweepI + edgeSweep * edgeI)) * base.a;
    outA   = base.a * sweepMask;
  }

  gl_FragColor = vec4(clamp(outRGB, 0.0, 1.0), saturate(outA));
}
