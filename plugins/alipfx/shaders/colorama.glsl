precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/* ---- User properties ---- */
uniform float Get_Phase_From;        // 0..9
uniform float Add_Mode;              // 0 Wrap, 1 Clamp, 2 Average, 3 Screen
uniform float Add_Amount;            // 0..1  <-- NEW
uniform float Phase_Shift;           // 0..1
uniform float Cycle_Repetitions;     // >= 1
uniform float Interpolate_Palette;   // 0/1
uniform float Modify;                // 0..13
uniform float Modify_Alpha;          // 0/1
uniform float Change_Empty_Pixels;   // 0/1

uniform vec3  Matching_Colors;       // vec3
uniform float Matching_Mode;         // 0 Off, 1 RGB, 2 Hue, 3 Chroma
uniform float Matching_Tolerance;    // 0..1
uniform float Matching_Softness;     // 0..1

uniform float Masking_Mode;          // 0..4
uniform float Composite_Over_Layer;  // 0/1
uniform float Blend_With_Original;   // 0..1

uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;

/* ---- Helpers ---- */
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3  saturate(vec3 x)  { return clamp(x, vec3(0.0), vec3(1.0)); }

float luma(vec3 c){
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float chromaRGB(vec3 c){
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  return mx - mn;
}

/* RGB <-> HSV */
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

/* HSV circular interpolation (shortest hue path) */
vec3 mixHSV(vec3 aRgb, vec3 bRgb, float t){
  vec3 a = rgb2hsv(aRgb);
  vec3 b = rgb2hsv(bRgb);

  float dh = b.x - a.x;
  if(dh >  0.5) dh -= 1.0;
  if(dh < -0.5) dh += 1.0;

  float h = fract(a.x + dh * t);
  float s = mix(a.y, b.y, t);
  float v = mix(a.z, b.z, t);

  return hsv2rgb(vec3(h, s, v));
}

/* Phase extraction (0..1) */
float getPhase(vec4 src){
  float mode = floor(Get_Phase_From + 0.5);

  vec3 rgb = src.rgb;
  float a = src.a;
  vec3 hsv = rgb2hsv(rgb);

  // HSL Lightness isn't strictly needed for the ramp demo;
  // keeping your earlier mapping behavior (Lightness from luma-like HSL would be similar on grayscale).
  // For accuracy, Lightness here is approximated as (max+min)/2.
  float maxc = max(max(rgb.r, rgb.g), rgb.b);
  float minc = min(min(rgb.r, rgb.g), rgb.b);
  float lightness = (maxc + minc) * 0.5;

  if(mode == 0.0) return luma(rgb);      // Intensity
  if(mode == 1.0) return rgb.r;          // Red
  if(mode == 2.0) return rgb.g;          // Green
  if(mode == 3.0) return rgb.b;          // Blue
  if(mode == 4.0) return hsv.x;          // Hue
  if(mode == 5.0) return lightness;      // Lightness
  if(mode == 6.0) return hsv.y;          // Saturation
  if(mode == 7.0) return hsv.z;          // Value
  if(mode == 8.0) return a;              // Alpha
  return 0.0;                            // Zero
}

/* Output Cycle color fetch */
vec3 getCycleColor(int idx){
  if(idx == 0) return Color_1;
  if(idx == 1) return Color_2;
  if(idx == 2) return Color_3;
  if(idx == 3) return Color_4;
  if(idx == 4) return Color_5;
  return Color_6;
}

/* Output Cycle sampling (6-stop circular cycle) */
vec3 sampleCycle6(float t, float interpEnabled){
  float x = fract(t) * 6.0;
  float i0f = floor(x);
  float f = fract(x);

  int i0 = int(i0f);
  int i1 = int(mod(i0f + 1.0, 6.0));

  vec3 c0 = getCycleColor(i0);
  vec3 c1 = getCycleColor(i1);

  if(interpEnabled < 0.5){
    return c0; // hard steps
  }else{
    // HSV interpolation keeps rainbow vivid & smooth
    return mixHSV(c0, c1, f);
  }
}

/* Add Mode = literal combine mapped over source */
vec3 addCombine(vec3 srcRgb, vec3 mappedRgb){
  float m = floor(Add_Mode + 0.5);

  if(m == 0.0){
    return fract(srcRgb + mappedRgb);                 // Wrap
  }else if(m == 1.0){
    return saturate(srcRgb + mappedRgb);              // Clamp
  }else if(m == 2.0){
    return (srcRgb + mappedRgb) * 0.5;                // Average
  }else{
    return 1.0 - (1.0 - srcRgb) * (1.0 - mappedRgb);  // Screen
  }
}

/* Modify integration */
vec4 applyModify(vec4 orig, vec4 fx){
  float m = floor(Modify + 0.5);

  if(m == 13.0) return orig; // None
  if(m == 0.0)  return fx;   // All

  vec4 outc = fx;

  if(m == 1.0){ outc.rgb = vec3(fx.r, orig.g, orig.b); return outc; } // R
  if(m == 2.0){ outc.rgb = vec3(orig.r, fx.g, orig.b); return outc; } // G
  if(m == 3.0){ outc.rgb = vec3(orig.r, orig.g, fx.b); return outc; } // B
  if(m == 4.0){ outc.rgb = vec3(fx.r, fx.g, orig.b); return outc; }   // RG
  if(m == 5.0){ outc.rgb = vec3(orig.r, fx.g, fx.b); return outc; }   // GB
  if(m == 6.0){ outc.rgb = vec3(fx.r, orig.g, fx.b); return outc; }   // RB

  // Attribute modes (Hue/Sat/Lightness-ish)
  vec3 oHSV = rgb2hsv(orig.rgb);
  vec3 fHSV = rgb2hsv(fx.rgb);

  float maxo = max(max(orig.r, orig.g), orig.b);
  float mino = min(min(orig.r, orig.g), orig.b);
  float oL = (maxo + mino) * 0.5;

  float maxf = max(max(fx.r, fx.g), fx.b);
  float minf = min(min(fx.r, fx.g), fx.b);
  float fL = (maxf + minf) * 0.5;

  if(m == 7.0){ // Hue
    outc.rgb = hsv2rgb(vec3(fHSV.x, oHSV.y, oHSV.z));
    return outc;
  }
  if(m == 8.0){ // Lightness (approx)
    // Keep hue/sat from original but set value by matching lightness (approx)
    // (close visually on most content; exact HSL needs full conversion)
    vec3 hsv = oHSV;
    hsv.z = mix(oHSV.z, fHSV.z, 0.5); // pragmatic approximation
    outc.rgb = hsv2rgb(hsv);
    return outc;
  }
  if(m == 9.0){ // Saturation
    outc.rgb = hsv2rgb(vec3(oHSV.x, fHSV.y, oHSV.z));
    return outc;
  }
  if(m == 10.0){ // HL (approx)
    outc.rgb = hsv2rgb(vec3(fHSV.x, oHSV.y, mix(oHSV.z, fHSV.z, 0.5)));
    return outc;
  }
  if(m == 11.0){ // LS (approx)
    outc.rgb = hsv2rgb(vec3(oHSV.x, fHSV.y, mix(oHSV.z, fHSV.z, 0.5)));
    return outc;
  }
  if(m == 12.0){ // HS
    outc.rgb = hsv2rgb(vec3(fHSV.x, fHSV.y, oHSV.z));
    return outc;
  }

  return outc;
}

/* Matching mask controlled by Matching_Mode */
float matchingMask(vec3 srcRgb){
  float mode = floor(Matching_Mode + 0.5);

  if(mode == 0.0) return 1.0; // Off

  float tol  = saturate(Matching_Tolerance);
  float soft = max(1e-6, Matching_Softness);

  float d = 0.0;

  if(mode == 1.0){
    d = length(srcRgb - Matching_Colors); // RGB
  }
  else if(mode == 2.0){
    vec3 a = rgb2hsv(srcRgb);
    vec3 b = rgb2hsv(Matching_Colors);
    float dh = abs(a.x - b.x);
    dh = min(dh, 1.0 - dh);
    float satGuard = max(a.y, 0.001);
    d = dh / satGuard; // Hue becomes stricter when low saturation
  }
  else {
    float cA = chromaRGB(srcRgb);
    float cB = chromaRGB(Matching_Colors);
    d = abs(cA - cB); // Chroma
  }

  float w = 1.0 - smoothstep(tol, tol + soft, d);
  return saturate(w);
}

/* Masking mode based on intensity/alpha */
float maskingModeMask(vec4 src){
  float mode = floor(Masking_Mode + 0.5);
  float inten = luma(src.rgb);
  float a = src.a;

  if(mode == 0.0) return 1.0;
  if(mode == 1.0) return inten;
  if(mode == 2.0) return a;
  if(mode == 3.0) return 1.0 - inten;
  return 1.0 - a;
}

/* Porter-Duff "over" */
vec4 over(vec4 fg, vec4 bg){
  float outA = fg.a + bg.a * (1.0 - fg.a);
  vec3 outRGB = (fg.rgb * fg.a + bg.rgb * bg.a * (1.0 - fg.a)) / max(outA, 1e-10);
  return vec4(outRGB, outA);
}

void main(){
  vec4 src = texture2D(tDiffuse, vUvScaled);

  if(Change_Empty_Pixels < 0.5 && src.a <= 0.0){
    gl_FragColor = src;
    return;
  }

  // Phase
  float phase = getPhase(src);

  // Reps + shift
  float reps = max(1.0, Cycle_Repetitions);
  float p = fract(phase * reps + Phase_Shift);

  // Palette map
  vec3 mappedRgb = sampleCycle6(p, Interpolate_Palette);

  // Add stage: either pure mapped (Add_Amount=0) or combined (Add_Amount=1)
  vec3 combinedRgb = addCombine(src.rgb, mappedRgb);
  vec3 fxRgb = mix(mappedRgb, combinedRgb, saturate(Add_Amount));

  // Alpha
  float fxA = (Modify_Alpha > 0.5) ? p : src.a;
  vec4 fx = vec4(fxRgb, fxA);

  // Modify
  vec4 modified = applyModify(src, fx);

  if(Modify_Alpha < 0.5){
    modified.a = src.a;
  }

  // Matching + Masking
  float matchW = matchingMask(src.rgb);
  float maskW  = maskingModeMask(src);
  float effectW = saturate(matchW * maskW);

  // Blend with original (AE-like: 0=full effect, 1=original)
  float effectAmt = saturate(1.0 - Blend_With_Original);

  // Composite Over Layer
  if(Composite_Over_Layer > 0.5){
    vec4 fg = modified;
    fg.a *= (effectW * effectAmt);
    gl_FragColor = over(fg, src);
  }else{
    gl_FragColor = mix(src, modified, effectW * effectAmt);
  }
}
