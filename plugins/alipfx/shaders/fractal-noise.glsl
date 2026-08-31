precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// ====== Panzoid Properties (spaces become underscores) ======
uniform float Fractal_Type;       // 0..16
uniform float Noise_Type;         // 0..3
uniform float Invert;             // 0..1
uniform float Contrast;           // -200..200
uniform float Brightness;         // -100..100
uniform float Overflow;           // 0..3
uniform float Rotation;           // degrees
uniform float Uniform_Scaling;    // 0..1
uniform float Scale;              // percent
uniform float Scale_Width;        // percent
uniform float Scale_Height;       // percent
uniform vec2  Offset_Turbulence;  // pixels recommended
uniform float Perspective_Offset; // 0..1 checkbox
uniform float Complexity;         // 1..12 (fractional ok)
uniform float Sub_Influence;      // 0..100
uniform float Sub_Scaling;        // 0..200 (% size of sub layers)
uniform float Sub_Rotation;       // degrees
uniform vec2  Sub_Offset;         // pixels recommended
uniform float Center_Subscale;    // 0..1 checkbox
uniform float Evolution;          // degrees
uniform float Cycle_Evolution;    // 0..1
uniform float Cycle;              // revolutions
uniform float Random_Seed;        // any
uniform float Opacity;            // 0..100
uniform float Blending_Mode;      // 0..16

// ===================== Helpers =====================
float sat(float x){ return clamp(x, 0.0, 1.0); }

mat2 rot2(float a){
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

// Seedable hash (3D)
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p){
  return vec3(
    hash13(p + vec3(0.0, 0.0, 0.0)),
    hash13(p + vec3(19.19, 7.77, 3.33)),
    hash13(p + vec3(2.71, 11.11, 5.55))
  );
}

float fadeSoft(float t){ return t*t*(3.0-2.0*t); }
float fadeSpline(float t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

// ===================== Base noises =====================

// 3D value noise with selectable interpolation
float valueNoise3(vec3 p, float seed, int interpMode){
  vec3 i = floor(p);
  vec3 f = fract(p);

  vec3 u = f;
  if(interpMode == 1) u = vec3(fadeSoft(f.x), fadeSoft(f.y), fadeSoft(f.z));
  if(interpMode == 2) u = vec3(fadeSpline(f.x), fadeSpline(f.y), fadeSpline(f.z));

  float v000 = hash13(i + vec3(0,0,0) + seed);
  float v100 = hash13(i + vec3(1,0,0) + seed);
  float v010 = hash13(i + vec3(0,1,0) + seed);
  float v110 = hash13(i + vec3(1,1,0) + seed);
  float v001 = hash13(i + vec3(0,0,1) + seed);
  float v101 = hash13(i + vec3(1,0,1) + seed);
  float v011 = hash13(i + vec3(0,1,1) + seed);
  float v111 = hash13(i + vec3(1,1,1) + seed);

  float x00 = mix(v000, v100, u.x);
  float x10 = mix(v010, v110, u.x);
  float x01 = mix(v001, v101, u.x);
  float x11 = mix(v011, v111, u.x);

  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);

  return mix(y0, y1, u.z);
}

// 3D gradient noise (Perlin-ish) for Spline
float gradNoise3(vec3 p, float seed){
  vec3 i = floor(p);
  vec3 f = fract(p);

  vec3 g000 = normalize(hash33(i + vec3(0,0,0) + seed) * 2.0 - 1.0);
  vec3 g100 = normalize(hash33(i + vec3(1,0,0) + seed) * 2.0 - 1.0);
  vec3 g010 = normalize(hash33(i + vec3(0,1,0) + seed) * 2.0 - 1.0);
  vec3 g110 = normalize(hash33(i + vec3(1,1,0) + seed) * 2.0 - 1.0);
  vec3 g001 = normalize(hash33(i + vec3(0,0,1) + seed) * 2.0 - 1.0);
  vec3 g101 = normalize(hash33(i + vec3(1,0,1) + seed) * 2.0 - 1.0);
  vec3 g011 = normalize(hash33(i + vec3(0,1,1) + seed) * 2.0 - 1.0);
  vec3 g111 = normalize(hash33(i + vec3(1,1,1) + seed) * 2.0 - 1.0);

  float n000 = dot(g000, f - vec3(0,0,0));
  float n100 = dot(g100, f - vec3(1,0,0));
  float n010 = dot(g010, f - vec3(0,1,0));
  float n110 = dot(g110, f - vec3(1,1,0));
  float n001 = dot(g001, f - vec3(0,0,1));
  float n101 = dot(g101, f - vec3(1,0,1));
  float n011 = dot(g011, f - vec3(0,1,1));
  float n111 = dot(g111, f - vec3(1,1,1));

  vec3 u = vec3(fadeSpline(f.x), fadeSpline(f.y), fadeSpline(f.z));

  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);

  float y0 = mix(x00, x10, u.y);
  float y1 = mix(x01, x11, u.y);

  float n = mix(y0, y1, u.z);
  return n * 0.5 + 0.5; // [-1..1] -> [0..1]
}

float blockNoise3(vec3 p, float seed){
  return hash13(floor(p) + seed);
}

// Noise Type selector: 0 Block, 1 Linear, 2 Soft Linear, 3 Spline
float baseNoise(vec3 p, float seed){
  int nt = int(floor(Noise_Type + 0.5));
  if(nt == 0) return blockNoise3(p, seed);
  if(nt == 1) return valueNoise3(p, seed, 0);
  if(nt == 2) return valueNoise3(p, seed, 1);
  return gradNoise3(p, seed);
}

// ===================== AE-ish Tone Controls =====================
float applyCB(float x){
  float c = Contrast / 100.0;
  float b = Brightness / 100.0;
  x += b;
  float gain = 1.0 + c * 0.6; // tuned
  return (x - 0.5) * gain + 0.5;
}

float applyOverflow(float x){
  int of = int(floor(Overflow + 0.5));
  if(of == 0) return clamp(x, 0.0, 1.0); // Clip
  if(of == 1){
    float y = x;
    if(y < 0.0) y = - (1.0 - exp(y));
    if(y > 1.0) y = 1.0 + (1.0 - exp(1.0-y));
    return clamp(y, 0.0, 1.0);
  }
  if(of == 2){
    float t = fract(x);
    return 1.0 - abs(t * 2.0 - 1.0);
  }
  return x; // Allow HDR
}

// ===================== Blend modes (0..16) =====================
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 blend(vec3 base, vec3 fx, int mode){
  if(mode == 0) return fx; // None (replace)
  if(mode == 1) return fx; // Normal
  if(mode == 2) return base + fx;
  if(mode == 3) return base * fx;
  if(mode == 4) return 1.0 - (1.0-base)*(1.0-fx);
  if(mode == 5) return mix(2.0*base*fx, 1.0-2.0*(1.0-base)*(1.0-fx), step(0.5, base)); // Overlay
  if(mode == 6) return (1.0 - 2.0*fx)*base*base + 2.0*fx*base; // Soft Light approx
  if(mode == 7) return mix(2.0*base*fx, 1.0-2.0*(1.0-base)*(1.0-fx), step(0.5, fx));  // Hard Light
  if(mode == 8) return base / max(1.0 - fx, 1e-5); // Color Dodge
  if(mode == 9) return 1.0 - (1.0-base) / max(fx, 1e-5); // Color Burn
  if(mode == 10) return min(base, fx); // Darken
  if(mode == 11) return max(base, fx); // Lighten
  if(mode == 12) return abs(base - fx); // Difference
  if(mode == 13) return base + fx - 2.0*base*fx; // Exclusion
  if(mode == 14){
    vec3 hb = rgb2hsv(base), hs = rgb2hsv(fx);
    return hsv2rgb(vec3(hs.x, hb.y, hb.z));
  }
  if(mode == 15){
    vec3 hb = rgb2hsv(base), hs = rgb2hsv(fx);
    return hsv2rgb(vec3(hb.x, hs.y, hb.z));
  }
  vec3 hb = rgb2hsv(base), hs = rgb2hsv(fx);
  return hsv2rgb(vec3(hb.x, hb.y, hs.z)); // 16 Luminosity
}

// ===================== Fractal Type shaping =====================
float turbulence(float n){ return 1.0 - abs(n * 2.0 - 1.0); }
float ridged(float n){ float t = turbulence(n); return t*t; }

vec3 domainWarp(vec3 p, float seed, float amount){
  float a = baseNoise(p * 0.75 + vec3(12.3, 4.56, 1.11), seed + 101.0);
  float b = baseNoise(p * 0.75 + vec3(7.89, 1.23, 9.99), seed + 202.0);
  float c = baseNoise(p * 0.75 + vec3(5.55, 6.66, 2.22), seed + 303.0);
  vec3 w = (vec3(a,b,c) - 0.5) * 2.0;
  return p + w * amount;
}

float applyFractalTypeSample(int ft, float n, vec3 pp, float seed, float evoPhase, int octave){
  // 0 Basic
  if(ft == 0) return n;

  // 1..3 turbulence variants
  if(ft == 1){ float t = turbulence(n); return smoothstep(0.0, 1.0, t); } // Turbulent Smooth
  if(ft == 2) return turbulence(n);                                       // Turbulent Basic
  if(ft == 3) return pow(sat(turbulence(n)), 2.2);                        // Turbulent Sharp

  // 4..6 dynamic family
  if(ft == 4){
    float m = baseNoise(pp + vec3(1.7, -2.1, evoPhase*1.1), seed + 777.0);
    return mix(n, m, 0.35);
  }
  if(ft == 5){
    vec3 q = pp + vec3(float(octave) * 0.35, float(octave) * -0.25, evoPhase*1.6);
    float m = baseNoise(q, seed + 888.0 + float(octave)*13.0);
    return mix(n, m, 0.45);
  }
  if(ft == 6){
    float ang = (baseNoise(pp*0.35 + vec3(0.0,0.0,evoPhase), seed+505.0) - 0.5) * 2.2;
    vec2 xy = rot2(ang) * pp.xy;
    float m = baseNoise(vec3(xy, pp.z), seed + 606.0);
    return mix(n, m, 0.55);
  }

  // 7 Max
  if(ft == 7) return ridged(n);

  // 8..9 smeary/swirly (mostly warp handled outside)
  if(ft == 8) return mix(n, turbulence(n), 0.35);
  if(ft == 9) return mix(n, ridged(n), 0.25);

  // 10 Rocky
  if(ft == 10) return pow(sat(ridged(n)), 1.6);

  // 11 Cloudy
  if(ft == 11){ float t = turbulence(n); return smoothstep(0.15, 0.95, t); }

  // 12 Terrain
  if(ft == 12){ float r = ridged(n); return mix(n, r, 0.65); }

  // 13 Subscale
  if(ft == 13) return mix(n, turbulence(n), 0.5);

  // 14 Small Bumps
  if(ft == 14){
    float x = (n - 0.5) * 1.6 + 0.5;
    return sat(mix(n, x, 0.65));
  }

  // 15 Strings / 16 Threads
  if(ft == 15){ float t = turbulence(n); return smoothstep(0.62, 0.90, t); }
  float t = turbulence(n);
  return smoothstep(0.78, 0.93, t);
}

// ===================== Fractal core (Center Subscale FIXED) =====================
float fractalNoise(vec3 p, float evoPhase, vec2 scalePx){
  const int MAX_OCT = 12;

  float comp = clamp(Complexity, 1.0, float(MAX_OCT));
  int oct = int(floor(comp));
  float fracOct = comp - float(oct);

  float seed = Random_Seed * 10.0;

  float subSize = max(Sub_Scaling, 0.001);
  float lacunarity = 100.0 / subSize;            // 50% => 2.0
  float gain = clamp(Sub_Influence / 100.0, 0.0, 0.999);

  float sum = 0.0;
  float amp = 1.0;
  float ampSum = 0.0;
  float freq = 1.0;

  float subRot = radians(Sub_Rotation);
  vec2 subOff = Sub_Offset / max(scalePx, vec2(1.0));

  // Pivot controls where octave scaling originates
  vec2 pivot = (Center_Subscale > 0.5)
    ? vec2(0.0)
    : (-0.5 * resolution) / max(scalePx, vec2(1.0));

  int ft = int(floor(Fractal_Type + 0.5));

  // Coordinate warps for some types
  if(ft == 8){
    p = domainWarp(p, seed, 0.9);
  }else if(ft == 9){
    float a = (baseNoise(p*0.30, seed+404.0) - 0.5) * 6.2831853;
    p.xy = rot2(a) * p.xy;
    p = domainWarp(p, seed, 0.65);
  }else if(ft == 6){
    p = domainWarp(p, seed, 0.25);
  }

  for(int i = 0; i < MAX_OCT; i++){
    if(i > oct) break;

    vec3 pp = p;

    if(i > 0){
      // sub-rotation + sub-offset around pivot
      vec2 pxy = pp.xy - pivot;
      pxy = rot2(subRot * float(i)) * pxy;
      pxy += pivot;
      pxy += subOff * float(i);
      pp.xy = pxy;

      freq *= lacunarity;
      amp *= gain;
    }

    // Scale each octave about pivot (this is Center Subscale)
    vec3 coord = pp;
    coord.xy = (pp.xy - pivot) * freq + pivot;
    coord.z  = pp.z * freq;

    float n = baseNoise(coord, seed + float(i) * 37.0);
    n = applyFractalTypeSample(ft, n, coord, seed, evoPhase, i);

    float w = 1.0;
    if(ft == 13 && i > 0){
      w = 1.0 + 0.75 * gain;
    }

    sum += n * amp * w;
    ampSum += amp * w;

    // fractional complexity blend
    if(i == oct && fracOct > 0.0){
      sum = mix(sum - n*amp*w, sum, fracOct);
      ampSum = mix(ampSum - amp*w, ampSum, fracOct);
    }
  }

  return (ampSum > 0.0) ? (sum / ampSum) : 0.5;
}

// ===================== Main =====================
void main(){
  vec4 texel = texture2D(tDiffuse, vUvScaled);
  vec2 uv = vUv;

  // Centered pixel space (AE-ish)
  vec2 pPx = (uv - 0.5) * resolution;

  // Rotate in pixel space like Transform Rotation
  pPx = rot2(radians(Rotation)) * pPx;

  // Scale mapping: % of comp min dimension
  float minDim = max(min(resolution.x, resolution.y), 1.0);

  float sU  = max(Scale, 0.001) / 100.0;
  float sxP = (Uniform_Scaling > 0.5) ? sU : max(Scale_Width, 0.001) / 100.0;
  float syP = (Uniform_Scaling > 0.5) ? sU : max(Scale_Height, 0.001) / 100.0;

  vec2 scalePx = vec2(sxP * minDim, syP * minDim);
  scalePx = max(scalePx, vec2(1.0));

  // Convert to noise space
  pPx /= scalePx;

  // Evolution (phase + Z)
  float evoTurns = Evolution / 360.0;
  float evoPhase;
  float z;

  if(Cycle_Evolution > 0.5){
    float cyc = max(Cycle, 0.001);
    float phase = evoTurns * (6.2831853 / cyc);
    z = cos(phase) * 2.0 + sin(phase) * 2.0;
    evoPhase = phase;
  }else{
    z = evoTurns * 4.0;
    evoPhase = evoTurns * 6.2831853;
  }

  // Base translation (Offset Turbulence) — always applied normally
  vec2 off = Offset_Turbulence / scalePx;
  pPx += off;

  // ===================== Perspective Offset (AE-like depth, NO net shift, vertical-only, reacts to X/Y equally) =====================
  if(Perspective_Offset > 0.5)
  {
    // TOP is near
    float depth = pow(uv.y, 1.35);
    float depthMid = pow(0.5, 1.35);
    float d = depth - depthMid; // centered depth (zero at midline)

    // React equally to X and Y movement
    float move = length(off);

    // Smooth saturating mapping (so big offsets don't explode)
    float moveAmt = 1.0 - exp(-move * 0.60);

    // Vertical stretch only (no X changes => no smear)
    const float V_STRETCH = 2.20;
    const float STAB_Y    = 0.55;

    float sy = 1.0 + d * (V_STRETCH * moveAmt);
    pPx.y *= sy;

    // stabilize Y so small Scale doesn't blow up
    pPx.y /= (1.0 + abs(d) * (STAB_Y * moveAmt));
  }

  vec3 p3 = vec3(pPx, z);

  // Fractal noise (Center Subscale uses scalePx internally)
  float n = fractalNoise(p3, evoPhase, scalePx);

  // Invert
  if(Invert > 0.5) n = 1.0 - n;

  // Contrast/Brightness + Overflow
  n = applyCB(n);
  n = applyOverflow(n);

  // Grayscale output
  vec3 noiseRGB = vec3(n);

  // Opacity
  float a = clamp(Opacity / 100.0, 0.0, 1.0);

  // Blend
  int bm = int(floor(Blending_Mode + 0.5));
  vec3 outBlend = blend(texel.rgb, noiseRGB, bm);

  vec3 outRGB;
  if(bm == 0 || bm == 1){
    outRGB = mix(texel.rgb, noiseRGB, a);
  }else{
    outRGB = mix(texel.rgb, outBlend, a);
  }

  gl_FragColor = vec4(outRGB, texel.a);
}
