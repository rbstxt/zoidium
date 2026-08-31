precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/*
  AE Levels (Individual Controls) + Channel routing (active)
  - All black/white sliders expect 0..255 exactly
  - All gamma sliders expect 0..5 (AE-like UI range per request)
  - Gamma behavior matches your description:
      Gamma > 1.0 => brighter midtones
      Gamma < 1.0 => darker midtones
    Implemented as exponent = 1/gamma
  - Clip toggles clamp to output endpoints when enabled
  - If clipping is Off, negative/superwhite values can pass (HDR-like)

  Changed:
  - Channel mode is forced to 4 (Alpha)
  - Alpha controls affect transparency / opacity
  - Alpha also drives an internal blur effect
*/

uniform float Channel; // kept for compatibility, but forced to 4 in main()

uniform float RGB_Input_Black;
uniform float RGB_Input_White;
uniform float RGB_Gamma;        // 0..5
uniform float RGB_Output_Black;
uniform float RGB_Output_White;

uniform float Red_Input_Black;
uniform float Red_Input_White;
uniform float Red_Gamma;        // 0..5
uniform float Red_Output_Black;
uniform float Red_Output_White;

uniform float Green_Input_Black;
uniform float Green_Input_White;
uniform float Green_Gamma;      // 0..5
uniform float Green_Output_Black;
uniform float Green_Output_White;

uniform float Blue_Input_Black;
uniform float Blue_Input_White;
uniform float Blue_Gamma;       // 0..5
uniform float Blue_Output_Black;
uniform float Blue_Output_White;

uniform float Alpha_Input_Black;
uniform float Alpha_Input_White;
uniform float Alpha_Gamma;      // 0..5
uniform float Alpha_Output_Black;
uniform float Alpha_Output_White;

// 0 = On (clip), 1 = Off, 2 = Off for 32bpc (treated like Off here)
uniform float Clip_To_Output_Black;
uniform float Clip_To_Output_White;

// Needed for blur sampling (1.0 / texture width, 1.0 / texture height)
uniform vec2 uTexelSize;

float clamp255(float v) { return clamp(v, 0.0, 255.0); }

// Gamma safety: user range is 0..5, but 0 would be invalid.
// We clamp internally to a tiny minimum, and also cap at 5.0.
float gammaSafe(float g) {
  return clamp(g, 1e-4, 5.0);
}

// Sign-preserving power so Off-clipping can support negatives (32bpc-like)
float signedPow(float x, float p) {
  float ax = abs(x);
  float sx = sign(x);
  return sx * pow(max(ax, 0.0), p);
}

float applyLevels1(
  float x,
  float inB, float inW,
  float gammaV,
  float outB, float outW,
  bool clipB, bool clipW
){
  // Convert AE 0..255 UI values to 0..1
  float iB = clamp255(inB) / 255.0;
  float iW = clamp255(inW) / 255.0;
  float oB = clamp255(outB) / 255.0;
  float oW = clamp255(outW) / 255.0;

  // Allow crossing (AE allows input white < input black)
  float denom = iW - iB;
  if (abs(denom) < 1e-6) denom = (denom < 0.0) ? -1e-6 : 1e-6;

  float t = (x - iB) / denom;

  // AE gamma direction per your spec: gamma>1 brightens => exponent = 1/gamma
  float g = gammaSafe(gammaV);
  float p = 1.0 / g;
  t = signedPow(t, p);

  // Map to output
  float y = mix(oB, oW, t);

  // Clip to output endpoints if enabled
  float mn = min(oB, oW);
  float mx = max(oB, oW);
  if (clipB) y = max(y, mn);
  if (clipW) y = min(y, mx);

  return y;
}

// Small Gaussian-like 9-tap blur
vec3 blur9(vec2 uv, float radiusPx) {
  vec2 r = uTexelSize * radiusPx;

  vec3 c = vec3(0.0);
  float w = 0.0;

  // center
  c += texture2D(tDiffuse, uv).rgb * 4.0;
  w += 4.0;

  // cross
  c += texture2D(tDiffuse, uv + vec2( r.x, 0.0)).rgb * 2.0;
  c += texture2D(tDiffuse, uv + vec2(-r.x, 0.0)).rgb * 2.0;
  c += texture2D(tDiffuse, uv + vec2(0.0,  r.y)).rgb * 2.0;
  c += texture2D(tDiffuse, uv + vec2(0.0, -r.y)).rgb * 2.0;
  w += 8.0;

  // diagonals
  c += texture2D(tDiffuse, uv + vec2( r.x,  r.y)).rgb;
  c += texture2D(tDiffuse, uv + vec2(-r.x,  r.y)).rgb;
  c += texture2D(tDiffuse, uv + vec2( r.x, -r.y)).rgb;
  c += texture2D(tDiffuse, uv + vec2(-r.x, -r.y)).rgb;
  w += 4.0;

  return c / max(w, 1e-6);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUvScaled);

  // Keep original RGB for blur source
  vec3 originalRGB = texel.rgb;

  // Toggle interpretation: 0 = On (clip), 1/2 = Off
  bool clipB = (int(floor(Clip_To_Output_Black + 0.5)) == 0);
  bool clipW = (int(floor(Clip_To_Output_White + 0.5)) == 0);

  // Force Channel mode = 4 (Alpha)
  int ch = 4;

  // --- 1) Channel decides where the MASTER RGB_* controls apply
  if (ch == 0) {
    // RGB master affects R,G,B
    texel.r = applyLevels1(texel.r, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
    texel.g = applyLevels1(texel.g, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
    texel.b = applyLevels1(texel.b, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
  } else if (ch == 1) {
    texel.r = applyLevels1(texel.r, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
  } else if (ch == 2) {
    texel.g = applyLevels1(texel.g, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
  } else if (ch == 3) {
    texel.b = applyLevels1(texel.b, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
  } else if (ch == 4) {
    texel.a = applyLevels1(texel.a, RGB_Input_Black, RGB_Input_White, RGB_Gamma, RGB_Output_Black, RGB_Output_White, clipB, clipW);
  }

  // --- 2) Individual Controls always apply (AE Individual Controls behavior)
  texel.r = applyLevels1(texel.r, Red_Input_Black,   Red_Input_White,   Red_Gamma,   Red_Output_Black,   Red_Output_White,   clipB, clipW);
  texel.g = applyLevels1(texel.g, Green_Input_Black, Green_Input_White, Green_Gamma, Green_Output_Black, Green_Output_White, clipB, clipW);
  texel.b = applyLevels1(texel.b, Blue_Input_Black,  Blue_Input_White,  Blue_Gamma,  Blue_Output_Black,  Blue_Output_White,  clipB, clipW);
  texel.a = applyLevels1(texel.a, Alpha_Input_Black, Alpha_Input_White, Alpha_Gamma, Alpha_Output_Black, Alpha_Output_White, clipB, clipW);

  // Alpha affects transparency / opacity
  float a = clamp(texel.a, 0.0, 1.0);

  // Lower alpha = more blur
  float blurAmount = 1.0 - a;

  // Internal blur radius in pixels (adjust 6.0 if you want stronger/weaker blur)
  vec3 blurredRGB = blur9(vUvScaled, 6.0 * blurAmount);

  // Mix original/current color with blurred color
  texel.rgb = mix(texel.rgb, blurredRGB, blurAmount);

  // Final output alpha
  texel.a = a;

  gl_FragColor = texel;
}
