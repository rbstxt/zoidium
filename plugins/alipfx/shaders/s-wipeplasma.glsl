#extension GL_OES_standard_derivatives : enable

precision highp float;
precision highp int;

/* Panzoid built-ins */
uniform sampler2D tDiffuse;   
uniform vec2 resolution;      
uniform vec2 uvScale;         
varying vec2 vUvScaled;       
varying vec2 vUv;             

/* === User properties === */
uniform float Transition_Dir;      // 0 wipe off to bg/none, 1 wipe on from bg/none
uniform float Auto_Trans;          // 0 manual, 1 auto 
uniform float Wipe_Percent;        // 0..100

uniform float Edge_Softness;       // 0..100
uniform float Frequency;
uniform float Freq_Rel_X;
uniform float Octaves;
uniform float Seed;

uniform float Plasma_Grad;
uniform float Plasma_Grad_Angle;   // degrees
uniform float Layers;
uniform vec2  Shift_XY;            // pixels

uniform float Phase_Start;
uniform float Phase_Speed;

uniform float Grad_Add;
uniform float Grad_Angle;          // degrees

uniform float Border_Width;        // 0..100
uniform vec3  Border_Color;
uniform float Border_Opacity;
uniform float Border_Softness;     // 0..100
uniform float Border_Shift;        

uniform float time;

/* === Helpers === */
float saturate(float x) { return clamp(x, 0.0, 1.0); }

mat2 rot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float fastTanh(float x) {
  x = clamp(x, -6.0, 6.0);
  float e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}

/* Hash / noise */
float hash12(vec2 p, float seed) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);

  float a = hash12(i + vec2(0.0, 0.0), seed);
  float b = hash12(i + vec2(1.0, 0.0), seed);
  float c = hash12(i + vec2(0.0, 1.0), seed);
  float d = hash12(i + vec2(1.0, 1.0), seed);

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, float seed, float oct) {
  float sum = 0.0;
  float amp = 0.55;
  float f = 1.0;

  for (int i = 0; i < 10; i++) {
    if (float(i) >= oct) break;
    sum += amp * (valueNoise(p * f, seed + float(i) * 19.0) * 2.0 - 1.0);
    f *= 2.0;
    amp *= 0.5;
  }
  return sum; 
}

/* Sapphire-ish plasma */
float plasmaField(vec2 uv01, float phase) {
  vec2 p = uv01 - 0.5;
  p.x *= resolution.x / max(1.0, resolution.y);

  p += Shift_XY / max(vec2(1.0), resolution);

  float effFreq = max(0.001, Frequency) * 0.25;
  p.x *= max(0.001, Freq_Rel_X);
  p *= effFreq;

  float ga = radians(Grad_Angle + 180.0); 
  vec2 gdir = normalize(vec2(cos(ga), sin(ga)));
  float gradCoord = dot(uv01 - 0.5, gdir);
  p += gdir * gradCoord * Grad_Add * 0.55;

  vec2 t = vec2(phase, -phase * 0.73);

  float stripes = 0.0;
  if (Plasma_Grad > 0.0001) {
    float pa = radians(Plasma_Grad_Angle);
    vec2 pdir = normalize(vec2(cos(pa), sin(pa)));
    stripes = sin(dot(p, pdir) * 6.2831853 + phase * 1.25);
    stripes *= Plasma_Grad;
  }

  float lay = clamp(Layers, 1.0, 10.0);

  float w1 = fbm(p + t * 0.55, Seed * 31.7, clamp(Octaves, 1.0, 10.0));
  float w2 = fbm(p * 1.7 - t * 0.33, Seed * 57.3 + 9.1, clamp(Octaves, 1.0, 10.0));
  vec2 warp = vec2(w1, w2) * (0.55 + 0.06 * lay);

  float n = fbm(p + warp + t * 0.25, Seed * 97.13, clamp(Octaves, 1.0, 10.0));

  float marble = sin((n + 0.35 * w1 + 0.25 * w2 + stripes) * (3.5 + 0.35 * lay) * 3.1415926);
  float ridge = 1.0 - abs(n);
  ridge = pow(saturate(ridge), 1.25);

  float field = 0.55 * ridge + 0.45 * (0.5 + 0.5 * marble);
  field = 0.5 + 0.5 * fastTanh((field - 0.5) * 2.2);

  return saturate(field);
}

float filteredPlasmaField(vec2 uv, float phase) {
  vec2 texel = 1.0 / max(resolution, vec2(1.0));
  vec2 o = texel * 1.25;

  float c  = plasmaField(uv, phase);
  float x1 = plasmaField(uv + vec2(o.x, 0.0), phase);
  float x2 = plasmaField(uv - vec2(o.x, 0.0), phase);
  float y1 = plasmaField(uv + vec2(0.0, o.y), phase);
  float y2 = plasmaField(uv - vec2(0.0, o.y), phase);

  return (c * 0.40 + (x1 + x2 + y1 + y2) * 0.15);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  float manualProg = saturate(Wipe_Percent / 100.0);
  float useAuto = step(0.5, Auto_Trans);
  float autoProg = saturate(time);
  float prog = mix(manualProg, autoProg, useAuto);

  float phase = Phase_Start + Phase_Speed * mix(prog, time, useAuto);

  vec2 uv01 = vUv;
  float field = filteredPlasmaField(uv01, phase);

  float ga = radians(Grad_Angle + 180.0);
  vec2 gdir = normalize(vec2(cos(ga), sin(ga)));

  float g = dot(uv01 - 0.5, gdir);
  float g01 = g + 0.5;

  float amp = 0.60 + 0.10 * abs(Grad_Add);
  float wipeCoord = g01 + (field - 0.5) * amp;

  // Base AA to prevent jagged pixels when softness is 0
  float px = max(1e-6, fwidth(wipeCoord));

  // FIX: Unhooked Edge_Softness from fwidth so it blurs natively across the screen!
  float edgeSoft = max(1.25 * px, Edge_Softness * 0.01);

  float span = 0.5 * (abs(gdir.x) + abs(gdir.y));
  float gMin = 0.5 - span;
  float gMax = 0.5 + span;

  float wMin = gMin - 0.5 * amp;
  float wMax = gMax + 0.5 * amp;

  float margin = 0.01 + 3.0 * edgeSoft;
  float thr = mix(wMax + margin, wMin - margin, prog);

  float m = smoothstep(thr - edgeSoft, thr + edgeSoft, wipeCoord);

  float alphaOff = 1.0 - m;
  float alphaOn  = m;

  float dirIsOn = step(0.5, Transition_Dir);
  float alphaMask = mix(alphaOff, alphaOn, dirIsOn);

  // FIX: Unhooked Border Width/Softness from fwidth and applied symmetric blur
  float borderMask = 0.0;
  if (Border_Width > 0.0 && Border_Opacity > 0.0) {
    float shiftCoord = Border_Shift * 0.01;
    float d = abs((wipeCoord - thr) - shiftCoord);

    float bw = Border_Width * 0.01;
    float bs = max(0.001, Border_Softness * 0.01);

    borderMask = 1.0 - smoothstep(max(0.0, bw - bs), bw + bs, d);
    borderMask *= Border_Opacity;
  }

  vec3 rgb = mix(texel.rgb, Border_Color, saturate(borderMask));

  gl_FragColor = vec4(rgb, texel.a * alphaMask);
}
