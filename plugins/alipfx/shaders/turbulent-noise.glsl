precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

/* ==== AE-like controls (ALL as dynamic uniforms) ==== */
uniform float Fractal_Type;        // 0..16
uniform float Noise_Type;          // 0..3
uniform float Invert;              // 0/1
uniform float Contrast;            // default 100
uniform float Brightness;          // default 0 (-100..100)
uniform float Overflow;            // 0..3
uniform float Rotation;            // degrees
uniform float Uniform_Scaling;     // 0/1
uniform float Scale;               // percent
uniform float Scale_Width;         // percent
uniform float Scale_Height;        // percent
uniform vec2  Offset_Turbulence;   // pixels
uniform float Perspective_Offset;  // 0/1
uniform float Complexity;          // 1..12
uniform float Sub_Influence;       // 0..100
uniform float Sub_Scaling;         // 0..100
uniform float Evolution;           // degrees
uniform float Turbulence_Factor;   // 1..4 (your range)
uniform float Random_Seed;         // integer-ish
uniform float Opacity;             // 0..100
uniform float Blending_Mode;       // 0..16

/* ==== Tuning constant: AE-ish "Scale=100" feel in pixels ==== */
const float AE_BASE_SCALE_PX = 100.0;

/* Evolution scale:
   Controls how much the pattern changes over 0..360 degrees.
   If evolution feels too subtle, increase to ~6.0.
   If too jumpy, reduce to ~2.0.
*/
const float EVOLUTION_Z_CELLS_PER_360 = 4.0;

/* ===================== Utility ===================== */
float sat(float x){ return clamp(x, 0.0, 1.0); }

vec2 rot2(vec2 p, float a){
  float s = sin(a), c = cos(a);
  return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
}

/* Hash helpers (ES2-safe, no bit ops) */
float hash21(vec2 p, float seed){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed*0.001);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(vec3 p, float seed){
  vec3 p3 = fract(p * 0.1031 + seed*0.001);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* Interpolation kernels to mimic AE Noise Type feel */
float interpKernel(float t, int type){
  if(type == 0) return step(0.5, t);                 // Block
  if(type == 1) return t;                            // Linear
  if(type == 2) return t*t*(3.0 - 2.0*t);            // Soft Linear (smoothstep)
  return t*t*t*(t*(t*6.0 - 15.0) + 10.0);            // Spline (smootherstep)
}

/* ===== 3D value noise with selectable interpolation =====
   This is the key to AE-like Evolution:
   Evolution becomes the Z dimension, changing internal state without translating XY.
*/
float valueNoise3D(vec3 p, int ntype, float seed){
  vec3 i = floor(p);
  vec3 f = fract(p);

  float u = interpKernel(f.x, ntype);
  float v = interpKernel(f.y, ntype);
  float w = interpKernel(f.z, ntype);

  // 8 corners
  float n000 = hash31(i + vec3(0.0,0.0,0.0), seed);
  float n100 = hash31(i + vec3(1.0,0.0,0.0), seed);
  float n010 = hash31(i + vec3(0.0,1.0,0.0), seed);
  float n110 = hash31(i + vec3(1.0,1.0,0.0), seed);

  float n001 = hash31(i + vec3(0.0,0.0,1.0), seed);
  float n101 = hash31(i + vec3(1.0,0.0,1.0), seed);
  float n011 = hash31(i + vec3(0.0,1.0,1.0), seed);
  float n111 = hash31(i + vec3(1.0,1.0,1.0), seed);

  float x00 = mix(n000, n100, u);
  float x10 = mix(n010, n110, u);
  float y0  = mix(x00, x10, v);

  float x01 = mix(n001, n101, u);
  float x11 = mix(n011, n111, u);
  float y1  = mix(x01, x11, v);

  return mix(y0, y1, w);
}

/* ===== Fractional-octave fBm (AE-like smooth TF changes) ===== */
float fbm3D(vec3 p, int ntype, float seed, float octavesF, float lacunarity, float gain, float evoZ){
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float norm = 0.0;

  // octavesF supports fractional octaves (e.g. 7.35)
  for(int i = 0; i < 12; i++){
    float fi = float(i);
    float w = clamp(octavesF - fi, 0.0, 1.0);
    if(w <= 0.0) break;

    // decorrelate octaves in Z a bit (AE-like richer evolution)
    float z = evoZ + fi * 13.37;

    float n = valueNoise3D(vec3(p.xy * freq, z * freq), ntype, seed + fi*17.0);

    sum  += n * amp * w;
    norm += amp * w;

    freq *= lacunarity;
    amp  *= gain;
  }

  return (norm > 0.0) ? (sum / norm) : 0.0;
}

float turbulenceAbs(float x){ return abs(x*2.0 - 1.0); }               // 0..1
float ridged(float x){ float r = 1.0 - abs(x*2.0 - 1.0); return r*r; } // sharper ridges
float billow(float x){ return abs(x*2.0 - 1.0); }                      // cloud-ish

/* Domain warp using 3D noise (uses evoZ for true evolution) */
vec2 domainWarp(vec2 p, int ntype, float seed, float evoZ, float strength){
  float w1 = valueNoise3D(vec3(p*1.2 + vec2(13.1, 7.7), evoZ), ntype, seed+101.0);
  float w2 = valueNoise3D(vec3(p*1.2 + vec2(3.7, 19.3), evoZ), ntype, seed+202.0);
  vec2 w = vec2(w1, w2) * 2.0 - 1.0;
  return p + w * strength;
}

/* "Smeary" multi-sample */
float smearySample3D(vec3 p, int ntype, float seed){
  float n0 = valueNoise3D(p, ntype, seed);
  float n1 = valueNoise3D(p + vec3(0.65, 0.15, 0.25), ntype, seed);
  float n2 = valueNoise3D(p + vec3(-0.25, 0.55, -0.15), ntype, seed);
  return (n0*0.55 + n1*0.25 + n2*0.20);
}

/* Overflow modes */
float applyOverflow(float x, int mode){
  if(mode == 0) return clamp(x, 0.0, 1.0);  // Clip
  if(mode == 1){
    float y = 0.5 + 0.5 * ((x - 0.5) / (1.0 + abs(x - 0.5)));
    return clamp(y, 0.0, 1.0);             // Soft Clamp
  }
  if(mode == 2){
    float m = mod(x, 2.0);
    return 1.0 - abs(m - 1.0);             // Wrap Back (mirror wrap)
  }
  return x;                                 // Allow HDR
}

/* ===== Blend modes (same as before) ===== */
vec3 blendNormal(vec3 b, vec3 s){ return s; }
vec3 blendAdd(vec3 b, vec3 s){ return b + s; }
vec3 blendMultiply(vec3 b, vec3 s){ return b * s; }
vec3 blendScreen(vec3 b, vec3 s){ return 1.0 - (1.0-b)*(1.0-s); }
vec3 blendOverlay(vec3 b, vec3 s){
  return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, b));
}
vec3 blendSoftLight(vec3 b, vec3 s){
  return (1.0-2.0*s)*b*b + 2.0*s*b;
}
vec3 blendHardLight(vec3 b, vec3 s){
  return mix(2.0*b*s, 1.0 - 2.0*(1.0-b)*(1.0-s), step(0.5, s));
}
vec3 blendColorDodge(vec3 b, vec3 s){
  return b / max(vec3(1e-4), (1.0 - s));
}
vec3 blendColorBurn(vec3 b, vec3 s){
  return 1.0 - (1.0 - b) / max(vec3(1e-4), s);
}
vec3 blendDarken(vec3 b, vec3 s){ return min(b, s); }
vec3 blendLighten(vec3 b, vec3 s){ return max(b, s); }
vec3 blendDifference(vec3 b, vec3 s){ return abs(b - s); }
vec3 blendExclusion(vec3 b, vec3 s){ return b + s - 2.0*b*s; }

/* RGB <-> HSL for Hue/Sat/Lum blend modes */
float hue2rgb(float p, float q, float t){
  if(t < 0.0) t += 1.0;
  if(t > 1.0) t -= 1.0;
  if(t < 1.0/6.0) return p + (q-p)*6.0*t;
  if(t < 1.0/2.0) return q;
  if(t < 2.0/3.0) return p + (q-p)*(2.0/3.0 - t)*6.0;
  return p;
}
vec3 rgb2hsl(vec3 c){
  float maxc = max(max(c.r,c.g),c.b);
  float minc = min(min(c.r,c.g),c.b);
  float h = 0.0;
  float s = 0.0;
  float l = (maxc + minc)*0.5;
  float d = maxc - minc;
  if(d > 1e-6){
    s = d / (1.0 - abs(2.0*l - 1.0));
    if(maxc == c.r) h = mod((c.g - c.b)/d, 6.0);
    else if(maxc == c.g) h = (c.b - c.r)/d + 2.0;
    else h = (c.r - c.g)/d + 4.0;
    h /= 6.0;
    if(h < 0.0) h += 1.0;
  }
  return vec3(h,s,l);
}
vec3 hsl2rgb(vec3 hsl){
  float h=hsl.x, s=hsl.y, l=hsl.z;
  float r,g,b;
  if(s < 1e-6){
    r=g=b=l;
  }else{
    float q = (l < 0.5) ? (l*(1.0+s)) : (l + s - l*s);
    float p = 2.0*l - q;
    r = hue2rgb(p,q,h + 1.0/3.0);
    g = hue2rgb(p,q,h);
    b = hue2rgb(p,q,h - 1.0/3.0);
  }
  return vec3(r,g,b);
}

vec3 applyBlendMode(vec3 base, vec3 src, int mode){
  if(mode == 1) return blendNormal(base, src);
  if(mode == 2) return blendAdd(base, src);
  if(mode == 3) return blendMultiply(base, src);
  if(mode == 4) return blendScreen(base, src);
  if(mode == 5) return blendOverlay(base, src);
  if(mode == 6) return blendSoftLight(base, src);
  if(mode == 7) return blendHardLight(base, src);
  if(mode == 8) return blendColorDodge(base, src);
  if(mode == 9) return blendColorBurn(base, src);
  if(mode == 10) return blendDarken(base, src);
  if(mode == 11) return blendLighten(base, src);
  if(mode == 12) return blendDifference(base, src);
  if(mode == 13) return blendExclusion(base, src);

  vec3 bHSL = rgb2hsl(base);
  vec3 sHSL = rgb2hsl(src);
  if(mode == 14) return hsl2rgb(vec3(sHSL.x, bHSL.y, bHSL.z)); // Hue
  if(mode == 15) return hsl2rgb(vec3(bHSL.x, sHSL.y, bHSL.z)); // Saturation
  if(mode == 16) return hsl2rgb(vec3(bHSL.x, bHSL.y, sHSL.z)); // Luminosity

  return src;
}

/* ===================== Main Noise Builder ===================== */
float buildFractal(vec2 p, int ftype, int ntype, float seed, float octF, float lac, float gain, float evoZ){
  float n;

  if(ftype == 0){
    n = fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ);

  }else if(ftype == 1){
    n = fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ);
    n = smoothstep(0.0, 1.0, turbulenceAbs(n));

  }else if(ftype == 2){
    n = turbulenceAbs(fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ));

  }else if(ftype == 3){
    n = ridged(fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ));

  }else if(ftype == 4){
    vec2 pw = domainWarp(p, ntype, seed, evoZ, 0.75);
    n = fbm3D(vec3(pw, 0.0), ntype, seed, octF, lac, gain, evoZ);

  }else if(ftype == 5){
    // Dynamic Progressive: warp strength grows per octave but octF controls layers
    float sum = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;

    for(int i=0;i<12;i++){
      float fi = float(i);
      float w = clamp(octF - fi, 0.0, 1.0);
      if(w <= 0.0) break;

      float k = fi / max(1.0, (octF - 1.0));
      vec2 pw = domainWarp(p*freq, ntype, seed + fi*33.0, evoZ + fi*9.7, mix(0.35, 1.10, k));
      float ni = valueNoise3D(vec3(pw, evoZ + fi*13.37), ntype, seed + fi*11.0);

      sum  += ni * amp * w;
      norm += amp * w;

      freq *= lac;
      amp  *= gain;
    }
    n = (norm > 0.0) ? (sum / norm) : 0.0;

  }else if(ftype == 6){
    // Dynamic Twist: twist angle driven by evolving 3D noise
    float ang = (valueNoise3D(vec3(p*0.8 + vec2(4.0,9.0), evoZ), ntype, seed+77.0)*2.0-1.0) * 1.6;
    vec2 pt = rot2(p, ang);
    n = fbm3D(vec3(pt, 0.0), ntype, seed, octF, lac, gain, evoZ);

  }else if(ftype == 7){
    // Max: take maximum across layers (weighted by octF)
    float mx = 0.0;
    float freq = 1.0;
    float amp = 1.0;
    for(int i=0;i<12;i++){
      float fi = float(i);
      float w = clamp(octF - fi, 0.0, 1.0);
      if(w <= 0.0) break;

      float ni = valueNoise3D(vec3(p*freq, evoZ + fi*13.37), ntype, seed + fi*19.0);
      mx = max(mx, ni * amp * w);

      freq *= lac;
      amp  *= gain;
    }
    n = sat(mx);

  }else if(ftype == 8){
    float s = smearySample3D(vec3(p*0.9, evoZ), ntype, seed);
    float f = fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ);
    n = mix(s, f, 0.65);

  }else if(ftype == 9){
    vec2 q = p;
    float a = valueNoise3D(vec3(p*0.6 + vec2(6.2,3.1), evoZ), ntype, seed+300.0)*6.2831;
    q += rot2(vec2(0.35,0.0), a) * 1.1;
    n = fbm3D(vec3(q, 0.0), ntype, seed, octF, lac, gain, evoZ);

  }else if(ftype == 10){
    n = ridged(fbm3D(vec3(p*1.15, 0.0), ntype, seed, octF, lac, gain, evoZ));
    n = pow(sat(n), 0.75);

  }else if(ftype == 11){
    n = billow(fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ));
    n = smoothstep(0.0, 1.0, n);

  }else if(ftype == 12){
    float r = ridged(fbm3D(vec3(p, 0.0), ntype, seed, octF, lac, gain, evoZ));
    float oct2F = max(1.0, octF - 2.0);
    float b = fbm3D(vec3(p*0.5, 0.0), ntype, seed+55.0, oct2F, lac, gain, evoZ);
    n = sat(r*1.2 + b*0.15);

  }else if(ftype == 13){
    float octHalfF = max(1.0, octF * 0.5);
    float base = fbm3D(vec3(p, 0.0), ntype, seed, octHalfF, lac, gain, evoZ);
    float fine = fbm3D(vec3(p*2.5, 0.0), ntype, seed+88.0, octF, lac, gain*0.9, evoZ);
    n = sat(base*0.45 + fine*0.75);

  }else if(ftype == 14){
    float fine = fbm3D(vec3(p*3.0, 0.0), ntype, seed+222.0, octF, lac, gain, evoZ);
    n = pow(sat(fine), 1.8);

  }else if(ftype == 15){
    vec2 pa = vec2(p.x*3.0, p.y*0.55);
    float s = fbm3D(vec3(pa, 0.0), ntype, seed+444.0, octF, lac, gain, evoZ);
    n = smoothstep(0.52, 0.78, s);

  }else{
    vec2 pa = vec2(p.x*4.2, p.y*0.45);
    float s = fbm3D(vec3(pa, 0.0), ntype, seed+555.0, octF, lac, gain*0.92, evoZ);
    n = pow(sat(s), 2.2);
    n = smoothstep(0.55, 0.90, n);
  }

  return sat(n);
}

void main(){
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  int ftype = int(floor(Fractal_Type + 0.5));
  int ntype = int(floor(Noise_Type + 0.5));
  int oflow = int(floor(Overflow + 0.5));
  int bmode = int(floor(Blending_Mode + 0.5));

  float seed = Random_Seed;

  // === TRUE AE-like Evolution ===
  // Map degrees to a Z position in noise-space (internal state, no XY drift)
  float evoZ = (Evolution / 360.0) * EVOLUTION_Z_CELLS_PER_360;

  // Scaling selection
  float sx = (Uniform_Scaling >= 0.5) ? Scale : Scale_Width;
  float sy = (Uniform_Scaling >= 0.5) ? Scale : Scale_Height;
  sx = max(1e-3, sx);
  sy = max(1e-3, sy);

  // UV -> pixel space (Offset Turbulence is position control)
  vec2 uv = vUv;
  vec2 pPix = uv * resolution + Offset_Turbulence;

  // Center and rotate
  vec2 centered = pPix - 0.5 * resolution;
  centered = rot2(centered, radians(Rotation));

  // AE-like scale in pixels
  vec2 cell = AE_BASE_SCALE_PX * vec2(sx, sy) / 100.0;
  vec2 p = centered / max(cell, vec2(1e-4));

  // Perspective Offset
  if(Perspective_Offset >= 0.5){
    float y = (uv.y - 0.5);
    p.x += y * 0.35;
    p *= 1.0 + y*0.15;
  }

  // === TF FIX: Turbulence Factor controls layered detail (octaves) ===
  // AE-like gentler curve so TF=4 isn't insanely noisy
  float tf = clamp(Turbulence_Factor, 1.0, 4.0);
  float tfCurved = 1.0 + (tf - 1.0) * 0.55;           // 1..~2.65 instead of 1..4

  float baseOct = clamp(Complexity, 1.0, 12.0);
  float octF = clamp(baseOct * tfCurved, 1.0, 12.0);  // fractional octaves supported

  // Sub params (TF no longer touches lacunarity!)
  float lac  = pow(2.0, Sub_Scaling / 50.0);
  float gain = clamp(Sub_Influence / 100.0, 0.0, 0.99);

  float n = buildFractal(p, ftype, ntype, seed, octF, lac, gain, evoZ);

  if(Invert >= 0.5) n = 1.0 - n;

  // Contrast/Brightness (AE-like)
  float c = max(0.0, Contrast) / 100.0;
  float b = Brightness / 100.0;
  n = (n - 0.5) * c + 0.5 + b;

  n = applyOverflow(n, oflow);

  vec3 noiseColor = vec3(n);
  float op = clamp(Opacity / 100.0, 0.0, 1.0);

  vec3 outRgb;
  if(bmode == 0){
    outRgb = mix(texel.rgb, noiseColor, op);
  }else{
    vec3 blended = applyBlendMode(texel.rgb, noiseColor, bmode);
    outRgb = mix(texel.rgb, blended, op);
  }

  gl_FragColor = vec4(outRgb, texel.a);
}
