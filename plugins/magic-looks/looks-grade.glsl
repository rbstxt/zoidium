// Magic Looks — full-chain color grade fragment shader (WebGL 1).
//
// Mirrors the Looks.grade JS reference in looks-color.js tool-for-tool.
// Lens Distortion is a geometric resample that runs before the chain; the
// remaining tools run in the order given by u_chain (u_chainCount entries).
// The order is a uniform, so reordering or removing tools never recompiles
// the shader. Each tool is gated by its enable uniform; identity defaults
// pass the image through.
//
// Color is straight inside the chain: premultiplied input is unpremultiplied
// once (and per neighbour tap), graded, clamped to [0,1] and premultiplied on
// output. Alpha passes through unchanged.
//
// Tool dispatch index (u_chain values, catalog order in looks-tools.js):
//   0 color-contrast      1 hsl-colors         2 color-ranges
//   3 crush               4 contrast           5 color-reversal
//   6 three-strip         7 lift-gamma-gain    8 ranged-saturation
//   9 warm-cool          10 four-way          11 mojo
//  12 auto-shoulder      13 curves            14 s-curve
//  15 lut               16 lightflex         17 deflare
//  18 vignette          19 haze-flare        20 pop
//  21 diffusion         22 star-filter       23 anamorphic-flare
//  24 lens-distortion   25 shutter-streak    26 edge-softness
//  27 chromatic-aberration 28 telecine-net

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform sampler2D uCurvesLUT;
uniform sampler2D uSCurveLUT;
uniform float u_chain[29];
uniform float u_chainCount;

varying vec2 vUv;

// --- enables ---
uniform float u_ccEnable;
uniform float u_hslEnable;
uniform float u_crEnable;
uniform float u_cruEnable;
uniform float u_conEnable;
uniform float u_crevEnable;
uniform float u_stripEnable;
uniform float u_lggEnable;
uniform float u_rsatEnable;
uniform float u_wcEnable;
uniform float u_fw4Enable;
uniform float u_mojoEnable;
uniform float u_ashEnable;
uniform float u_curvEnable;
uniform float u_scvEnable;
uniform float u_lutEnable;
uniform float u_lflEnable;
uniform float u_dflEnable;
uniform float u_vigEnable;
uniform float u_hazeEnable;
uniform float u_popEnable;
uniform float u_difEnable;
uniform float u_starEnable;
uniform float u_anaEnable;
uniform float u_lensEnable;
uniform float u_shutEnable;
uniform float u_edgeEnable;
uniform float u_caEnable;
uniform float u_teleEnable;

// --- numbers ---
uniform float u_ccPivot;
uniform float u_ccExposure;
uniform float u_crStrength;
uniform float u_crHighlight;
uniform float u_crMidtone;
uniform float u_crShadow;
uniform float u_crShowThreshold;
uniform float u_cruGamma;
uniform float u_cruExposure;
uniform float u_conContrast;
uniform float u_conPivot;
uniform float u_conExposure;
uniform float u_crevStrength;
uniform float u_crevExposure;
uniform float u_stripStrength;
uniform float u_stripExposure;
uniform float u_lggGammaSpace;
uniform float u_lggStrength;
uniform float u_lggExposure;
uniform float u_rsatSatHighlight;
uniform float u_rsatSatMidtone;
uniform float u_rsatSatShadow;
uniform float u_rsatThresholdHighlight;
uniform float u_rsatThresholdMidtone;
uniform float u_rsatThresholdShadow;
uniform float u_rsatShowThreshold;
uniform float u_rsatExposure;
uniform float u_wcWarmCool;
uniform float u_wcTint;
uniform float u_wcExposure;
uniform float u_fw4Exposure;
uniform float u_fw4Contrast;
uniform float u_fw4Strength;
uniform float u_fw4Preview;
uniform float u_mojoMojo;
uniform float u_mojoPunch;
uniform float u_mojoBleach;
uniform float u_mojoFade;
uniform float u_mojoBlueSqueeze;
uniform float u_mojoSkinSqueeze;
uniform float u_mojoExposure;
uniform float u_mojoCoolWarm;
uniform float u_mojoGreenMagenta;
uniform float u_mojoSkinYellowPink;
uniform float u_mojoStrength;
uniform float u_ashStrength;
uniform float u_lflBoost;
uniform float u_lflExposure;
uniform float u_dflStrength;
uniform float u_dflExposure;
uniform float u_vigCenterX;
uniform float u_vigCenterY;
uniform float u_vigRadius;
uniform float u_vigAspect;
uniform float u_vigSpread;
uniform float u_vigFalloff;
uniform float u_vigStrength;
uniform float u_vigExposure;
uniform float u_hazeSpillage;
uniform float u_hazeSoftness;
uniform float u_hazeReach;
uniform float u_hazeExposure;
uniform float u_hazeReflectionExposure;
uniform float u_hazeReflection;
uniform float u_hazeMatteBoxSize;
uniform float u_hazeMatteBoxShade;
uniform float u_popPop;
uniform float u_popSize;
uniform float u_popPreserveDetail;
uniform float u_difSize;
uniform float u_difGrade;
uniform float u_difGlow;
uniform float u_difHighlightsOnly;
uniform float u_difHighlightBias;
uniform float u_difExposure;
uniform float u_starSize;
uniform float u_starBoost;
uniform float u_starThreshold;
uniform float u_starShowThreshold;
uniform float u_starAngle;
uniform float u_anaSize;
uniform float u_anaBoost;
uniform float u_anaThreshold;
uniform float u_anaShowThreshold;
uniform float u_anaReflection;
uniform float u_anaReflectionBoost;
uniform float u_lensDistortion;
uniform float u_lensFlatten;
uniform float u_shutSize;
uniform float u_shutBoost;
uniform float u_shutFalloff;
uniform float u_edgeBlurSize;
uniform float u_edgeQuality;
uniform float u_edgeCenterX;
uniform float u_edgeCenterY;
uniform float u_edgeRadius;
uniform float u_edgeAspect;
uniform float u_edgeSpread;
uniform float u_caRedCyan;
uniform float u_caGreenMagenta;
uniform float u_caBlueYellow;
uniform float u_teleSize;
uniform float u_teleStrength;
uniform float u_teleExposure;

// --- wheel tints ---
uniform vec3 u_ccContrastTint;
uniform vec3 u_crHighlightTint;
uniform vec3 u_crMidtoneTint;
uniform vec3 u_crShadowTint;
uniform vec3 u_cruColorTint;
uniform vec3 u_lggLiftTint;
uniform vec3 u_lggGammaTint;
uniform vec3 u_lggGainTint;
uniform vec3 u_rsatBalanceTint;
uniform vec3 u_fw4ShadowsTint;
uniform vec3 u_fw4MidtonesTint;
uniform vec3 u_fw4HighlightsTint;
uniform vec3 u_fw4GlobalTint;
uniform vec3 u_lflColorTint;
uniform vec3 u_hazeTintTint;
uniform vec3 u_difColorTint;
uniform vec3 u_starColorTint;
uniform vec3 u_anaColorTint;
uniform vec3 u_vigColorTint;

// --- HSL anchors (red, orange, yellow, green, cyan, blue, purple, magenta) ---
uniform float u_hslSat0;
uniform float u_hslSat1;
uniform float u_hslSat2;
uniform float u_hslSat3;
uniform float u_hslSat4;
uniform float u_hslSat5;
uniform float u_hslSat6;
uniform float u_hslSat7;
uniform float u_hslLight0;
uniform float u_hslLight1;
uniform float u_hslLight2;
uniform float u_hslLight3;
uniform float u_hslLight4;
uniform float u_hslLight5;
uniform float u_hslLight6;
uniform float u_hslLight7;

// --- LUT tool ---
uniform float u_lutMode;
uniform float u_lutStrength;
uniform float u_lutGamma;

float lkLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 lkSat(vec3 c, float s) {
  float l = lkLuma(c);
  return vec3(l) + (c - vec3(l)) * s;
}

vec3 lkContrast(vec3 c, float k, float p) {
  return vec3(p) + (c - vec3(p)) * (1.0 + k);
}

vec3 lkExposure(vec3 c, float e) {
  return c * exp2(e);
}

vec3 lkPowV(vec3 x, vec3 e) {
  return pow(max(x, vec3(0.000001)), max(e, vec3(0.001)));
}

// Guarded smoothstep: a degenerate edge pair acts as a step.
float lkSmooth(float a, float b, float x) {
  float d = b - a;
  if (abs(d) < 0.000001) return x >= b ? 1.0 : 0.0;
  float t = clamp((x - a) / d, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float lkHueOf(vec3 c0) {
  vec3 c = clamp(c0, 0.0, 1.0);
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  if (d < 0.000001) return 0.0;
  float h = 0.0;
  if (mx == c.r) h = 60.0 * mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = 60.0 * ((c.b - c.r) / d + 2.0);
  else h = 60.0 * ((c.r - c.g) / d + 4.0);
  if (h < 0.0) h += 360.0;
  return h;
}

float lkCircDist(float a, float b) {
  float d = mod(abs(a - b), 360.0);
  return d > 180.0 ? 360.0 - d : d;
}

// Zone weights (shadow, mid, highlight) from three positional thresholds,
// sorted like the JS reference.
vec3 lkZones(float l, float t0, float t1, float t2) {
  float lo = min(min(t0, t1), t2);
  float hi = max(max(t0, t1), t2);
  float md = t0 + t1 + t2 - lo - hi;
  float sh = 1.0 - lkSmooth(lo, md, l);
  float hh = lkSmooth(md, hi, l);
  float mm = clamp(1.0 - sh - hh, 0.0, 1.0);
  return vec3(sh, mm, hh);
}

vec2 lkTexel() {
  return vec2(1.0) / max(resolution, vec2(1.0));
}

// Straight color of a premultiplied texel (zero where alpha is zero).
vec3 lkTap(vec2 uv) {
  vec4 t = texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));
  return t.a > 0.000001 ? t.rgb / t.a : vec3(0.0);
}

// Five-tap box (nine with diag) of radius r pixels.
vec3 lkBox(vec2 uv, float r, float diag) {
  vec2 tx = vec2(r) * lkTexel();
  vec3 acc = lkTap(uv) + lkTap(uv + vec2(tx.x, 0.0)) + lkTap(uv - vec2(tx.x, 0.0)) +
    lkTap(uv + vec2(0.0, tx.y)) + lkTap(uv - vec2(0.0, tx.y));
  float n = 5.0;
  if (diag > 0.5) {
    vec2 d = vec2(0.7071) * tx;
    acc += lkTap(uv + vec2(d.x, d.y)) + lkTap(uv + vec2(-d.x, d.y)) +
      lkTap(uv + vec2(d.x, -d.y)) + lkTap(uv + vec2(-d.x, -d.y));
    n = 9.0;
  }
  return acc / n;
}

// Average of `count` taps spanning [-r, r] along dir (half = count / 2).
vec3 lkLine(vec2 uv, float r, vec2 dir, int count) {
  int hl = count / 2;
  float div = max(float(hl), 1.0);
  vec3 acc = vec3(0.0);
  float n = 0.0;
  for (int i = -4; i <= 4; i++) {
    if (i < -hl || i > hl) continue;
    float fi = float(i);
    acc += lkTap(uv + dir * (r * fi / div) * lkTexel());
    n += 1.0;
  }
  return acc / max(n, 1.0);
}

// Texel mapping for a 256-entry table: entry k holds the value at x = k/255.
vec2 lkLutUv(float x) {
  return vec2((clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5);
}

// ---------- chain stages: (c, uv) -> c ----------

vec3 fxCc(vec3 c, vec2 uv) {
  if (u_ccEnable < 0.5) return c;
  vec3 r = lkContrast(c, 0.37, u_ccPivot) * u_ccContrastTint;
  return lkExposure(r, u_ccExposure);
}

vec3 fxHsl(vec3 c, vec2 uv) {
  if (u_hslEnable < 0.5) return c;
  float h = lkHueOf(c);
  float g0 = exp(-pow(lkCircDist(h, 0.0) / 28.0, 2.0));
  float g1 = exp(-pow(lkCircDist(h, 30.0) / 28.0, 2.0));
  float g2 = exp(-pow(lkCircDist(h, 60.0) / 28.0, 2.0));
  float g3 = exp(-pow(lkCircDist(h, 120.0) / 28.0, 2.0));
  float g4 = exp(-pow(lkCircDist(h, 180.0) / 28.0, 2.0));
  float g5 = exp(-pow(lkCircDist(h, 240.0) / 28.0, 2.0));
  float g6 = exp(-pow(lkCircDist(h, 270.0) / 28.0, 2.0));
  float g7 = exp(-pow(lkCircDist(h, 300.0) / 28.0, 2.0));
  float satS = 1.0 + u_hslSat0 * g0 + u_hslSat1 * g1 + u_hslSat2 * g2 + u_hslSat3 * g3 +
    u_hslSat4 * g4 + u_hslSat5 * g5 + u_hslSat6 * g6 + u_hslSat7 * g7;
  float lite = (u_hslLight0 * g0 + u_hslLight1 * g1 + u_hslLight2 * g2 + u_hslLight3 * g3 +
    u_hslLight4 * g4 + u_hslLight5 * g5 + u_hslLight6 * g6 + u_hslLight7 * g7) * 0.5;
  return lkSat(c, max(satS, 0.0)) + vec3(lite);
}

vec3 fxCr(vec3 c, vec2 uv) {
  if (u_crEnable < 0.5) return c;
  vec3 zw = lkZones(lkLuma(c), u_crShadow, u_crMidtone, u_crHighlight);
  if (u_crShowThreshold > 0.5) return zw;
  vec3 m = mix(vec3(1.0), u_crHighlightTint, zw.z) * mix(vec3(1.0), u_crMidtoneTint, zw.y) *
    mix(vec3(1.0), u_crShadowTint, zw.x);
  return c * (vec3(1.0) + (m - vec3(1.0)) * clamp(u_crStrength, 0.0, 2.0));
}

vec3 fxCru(vec3 c, vec2 uv) {
  if (u_cruEnable < 0.5) return c;
  return lkExposure(lkPowV(c, vec3(u_cruGamma)) * u_cruColorTint, u_cruExposure);
}

vec3 fxCon(vec3 c, vec2 uv) {
  if (u_conEnable < 0.5) return c;
  return lkExposure(lkContrast(c, u_conContrast, u_conPivot), u_conExposure);
}

vec3 fxCrev(vec3 c, vec2 uv) {
  if (u_crevEnable < 0.5) return c;
  return lkExposure(mix(c, vec3(1.0) - c, clamp(u_crevStrength, 0.0, 1.0)), u_crevExposure);
}

vec3 fxStrip(vec3 c, vec2 uv) {
  if (u_stripEnable < 0.5) return c;
  vec3 r = vec3(
    c.r * 0.88 + c.g * 0.08 + c.b * 0.04,
    c.r * 0.06 + c.g * 0.82 + c.b * 0.12,
    c.r * 0.08 + c.g * 0.10 + c.b * 0.82);
  return lkExposure(mix(c, r, clamp(u_stripStrength, 0.0, 1.0)), u_stripExposure);
}

vec3 fxLgg(vec3 c, vec2 uv) {
  if (u_lggEnable < 0.5) return c;
  float gsp = max(u_lggGammaSpace, 0.5);
  vec3 r = lkPowV(c, vec3(gsp / 2.2));
  r = r + (u_lggLiftTint - vec3(1.0));
  r = r * u_lggGainTint;
  r = lkPowV(r, 1.0 / max(u_lggGammaTint, vec3(0.001)));
  r = lkPowV(r, vec3(2.2 / gsp));
  c = mix(c, r, clamp(u_lggStrength, 0.0, 1.0));
  return lkExposure(c, u_lggExposure);
}

vec3 fxRsat(vec3 c, vec2 uv) {
  if (u_rsatEnable < 0.5) return c;
  vec3 zw = lkZones(lkLuma(c), u_rsatThresholdShadow, u_rsatThresholdMidtone, u_rsatThresholdHighlight);
  float ss = zw.x * u_rsatSatShadow + zw.y * u_rsatSatMidtone + zw.z * u_rsatSatHighlight;
  vec3 r = lkSat(c, ss) * u_rsatBalanceTint;
  if (u_rsatShowThreshold > 0.5) r = zw;
  return lkExposure(r, u_rsatExposure);
}

vec3 fxMojo(vec3 c, vec2 uv) {
  if (u_mojoEnable < 0.5) return c;
  vec3 r = lkSat(c, 1.0 + u_mojoPunch * 1.5);
  float rl = lkLuma(r);
  r = mix(r, vec3(rl + 0.08), clamp(u_mojoBleach * 0.6, 0.0, 1.0));
  r = r * (1.0 - u_mojoFade * 0.4) + vec3(u_mojoFade * 0.12);
  r = r + vec3(u_mojoCoolWarm * 0.25, u_mojoCoolWarm * 0.08, -u_mojoCoolWarm * 0.25);
  r = r + vec3(-u_mojoGreenMagenta * 0.2, u_mojoGreenMagenta * 0.25, -u_mojoGreenMagenta * 0.2);
  float hue = lkHueOf(r);
  float wBlue = exp(-pow(lkCircDist(hue, 240.0) / 25.0, 2.0));
  float wSkin = exp(-pow(lkCircDist(hue, 25.0) / 20.0, 2.0));
  r = lkSat(r, 1.0 - u_mojoBlueSqueeze * 0.5 * wBlue);
  r = lkSat(r, 1.0 - u_mojoSkinSqueeze * 0.5 * wSkin);
  r = r + vec3(u_mojoSkinYellowPink * 0.15, u_mojoSkinYellowPink * 0.02, -u_mojoSkinYellowPink * 0.12) * wSkin;
  r = lkExposure(r, u_mojoExposure);
  return mix(c, r, clamp(u_mojoMojo, 0.0, 1.0) * clamp(u_mojoStrength, 0.0, 1.0));
}

vec3 fxAsh(vec3 c, vec2 uv) {
  if (u_ashEnable < 0.5) return c;
  vec3 v = max(c, vec3(0.0));
  vec3 r = v / (v + vec3(0.18)) * 1.18;
  return mix(c, r, clamp(u_ashStrength, 0.0, 1.0));
}

vec3 fxWc(vec3 c, vec2 uv) {
  if (u_wcEnable < 0.5) return c;
  vec3 r = c + vec3(u_wcWarmCool * 0.28 + u_wcTint * 0.18,
    u_wcWarmCool * 0.12 - u_wcTint * 0.18,
    -u_wcWarmCool * 0.28 + u_wcTint * 0.18);
  return lkExposure(r, u_wcExposure);
}

vec3 fxFw4(vec3 c, vec2 uv) {
  if (u_fw4Enable < 0.5) return c;
  float lw = lkLuma(c);
  float fsh = 1.0 - lkSmooth(0.2, 0.5, lw);
  float fhi = lkSmooth(0.5, 0.8, lw);
  float fmid = clamp(1.0 - fsh - fhi, 0.0, 1.0);
  if (u_fw4Preview > 0.5) return vec3(fsh, fmid, fhi);
  float s4 = clamp(u_fw4Strength, 0.0, 1.0);
  vec3 m = (vec3(1.0) + (u_fw4ShadowsTint - vec3(1.0)) * fsh * s4) *
    (vec3(1.0) + (u_fw4MidtonesTint - vec3(1.0)) * fmid * s4) *
    (vec3(1.0) + (u_fw4HighlightsTint - vec3(1.0)) * fhi * s4) *
    (vec3(1.0) + (u_fw4GlobalTint - vec3(1.0)) * s4);
  return lkExposure(lkContrast(c * m, u_fw4Contrast, 0.18), u_fw4Exposure);
}

vec3 fxCurv(vec3 c, vec2 uv) {
  if (u_curvEnable < 0.5) return c;
  return vec3(
    texture2D(uCurvesLUT, lkLutUv(c.r)).r,
    texture2D(uCurvesLUT, lkLutUv(c.g)).g,
    texture2D(uCurvesLUT, lkLutUv(c.b)).b);
}

vec3 fxScv(vec3 c, vec2 uv) {
  if (u_scvEnable < 0.5) return c;
  return vec3(
    texture2D(uSCurveLUT, lkLutUv(c.r)).r,
    texture2D(uSCurveLUT, lkLutUv(c.g)).r,
    texture2D(uSCurveLUT, lkLutUv(c.b)).r);
}

vec3 fxLut(vec3 c, vec2 uv) {
  if (u_lutEnable < 0.5 || u_lutMode < 0.5) return c;
  vec3 r = c;
  if (u_lutGamma > 0.5 && u_lutGamma < 1.5) r = lkPowV(r, vec3(2.2));
  if (u_lutMode < 1.5) {
    r = r * vec3(1.1, 1.0, 0.88) + vec3(0.035, 0.012, -0.02);
  } else if (u_lutMode < 2.5) {
    r = r * vec3(0.9, 0.97, 1.1) + vec3(-0.02, 0.0, 0.03);
  } else {
    r = lkContrast(lkSat(r, 0.2), 0.35, 0.18);
  }
  if (u_lutGamma > 1.5) r = lkPowV(r, vec3(1.0 / 2.2));
  return mix(c, r, clamp(u_lutStrength, 0.0, 1.0));
}

vec3 fxLfl(vec3 c, vec2 uv) {
  if (u_lflEnable < 0.5) return c;
  float lfl = lkLuma(c);
  vec3 r = c + u_lflColorTint * (u_lflBoost * 0.045 * (1.0 - lfl));
  return lkExposure(r, u_lflExposure);
}

vec3 fxDfl(vec3 c, vec2 uv) {
  if (u_dflEnable < 0.5) return c;
  float lum = lkLuma(c);
  float dff = lkSmooth(0.55, 0.95, lum) * clamp(u_dflStrength, 0.0, 1.0);
  vec3 r = mix(c, vec3(lum), dff * 0.7) + vec3(dff * 0.05);
  return lkExposure(r, u_dflExposure);
}

vec3 fxVig(vec3 c, vec2 uv) {
  if (u_vigEnable < 0.5) return c;
  vec2 vc = vec2(0.5 + u_vigCenterX * 0.5, 0.5 + u_vigCenterY * 0.5);
  vec2 vd = vec2((uv.x - vc.x) * u_vigAspect, uv.y - vc.y);
  float dd = length(vd);
  float inner = u_vigRadius * (1.0 - u_vigSpread * 0.85);
  float vm = lkSmooth(inner, max(u_vigRadius, inner + 0.0001), dd);
  float vf = pow(vm, max(u_vigFalloff * 2.0 + 0.3, 0.05)) * clamp(u_vigStrength, 0.0, 1.0);
  return lkExposure(c * mix(vec3(1.0), u_vigColorTint, vf), u_vigExposure);
}

vec3 fxHaze(vec3 c, vec2 uv) {
  if (u_hazeEnable < 0.5) return c;
  float hr = 1.0 + u_hazeSoftness * 14.0;
  vec3 glow = lkBox(uv, hr, 0.0);
  vec3 hazed = glow * u_hazeTintTint + vec3(0.02);
  vec3 r = mix(c, hazed, clamp(u_hazeSpillage, 0.0, 1.0));
  if (u_hazeReflection > 0.5 && u_hazeReflectionExposure != 0.0) {
    vec3 hs = lkLine(uv, u_hazeReach * resolution.x * 0.04, vec2(1.0, 0.0), 7);
    r = r + hs * u_hazeTintTint * (u_hazeReflectionExposure * 0.15);
  }
  float hbox = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
  float hout = lkSmooth(u_hazeMatteBoxSize, u_hazeMatteBoxSize + 0.08, hbox);
  if (u_hazeSpillage > 0.0) r = r * (1.0 - hout * u_hazeMatteBoxShade * 0.85);
  return lkExposure(r, u_hazeExposure);
}

vec3 fxPop(vec3 c, vec2 uv) {
  if (u_popEnable < 0.5 || u_popPop == 0.0) return c;
  float pr = 1.0 + u_popSize * 3.0;
  vec3 pd = c - lkBox(uv, pr, 0.0);
  float pkeep = 1.0 - u_popPreserveDetail * lkSmooth(0.0, 0.25, length(pd));
  return c + pd * u_popPop * pkeep;
}

vec3 fxDif(vec3 c, vec2 uv) {
  if (u_difEnable < 0.5) return c;
  if (u_difGlow != 0.0) {
    float dr = (1.0 + u_difSize * 10.0) * (0.5 + u_difGrade * 0.15);
    vec3 dg = lkBox(uv, dr, 1.0);
    float dl = lkLuma(c);
    float dmask = lkSmooth(u_difHighlightsOnly * 0.7,
      min(1.0, u_difHighlightsOnly * 0.7 + 0.25), dl + u_difHighlightBias * 0.15);
    c = c + dg * u_difColorTint * (u_difGlow * dmask * (0.35 + u_difGrade * 0.08));
  }
  return lkExposure(c, u_difExposure);
}

vec3 fxStar(vec3 c, vec2 uv) {
  if (u_starEnable < 0.5) return c;
  if (u_starBoost == 0.0) return u_starShowThreshold > 0.5 ? vec3(0.0) : c;
  float sar = u_starAngle * 3.14159265 / 180.0;
  float sr = 2.0 + u_starSize * 40.0;
  vec3 s1 = lkLine(uv, sr, vec2(cos(sar), sin(sar)), 5);
  vec3 s2 = lkLine(uv, sr, vec2(-sin(sar), cos(sar)), 5);
  float sl = max(lkLuma(s1), lkLuma(s2));
  float sm = clamp((sl - u_starThreshold) / max(1.0 - u_starThreshold, 0.001), 0.0, 1.0);
  if (u_starShowThreshold > 0.5) return vec3(sm);
  return c + u_starColorTint * (sm * u_starBoost * 0.3);
}

vec3 fxAna(vec3 c, vec2 uv) {
  if (u_anaEnable < 0.5) return c;
  if (u_anaBoost == 0.0) return u_anaShowThreshold > 0.5 ? vec3(0.0) : c;
  float ar = max(1.0, u_anaSize * 20.0);
  vec3 ag = lkLine(uv, ar, vec2(1.0, 0.0), 9);
  float al = lkLuma(ag);
  float am = clamp((al - u_anaThreshold) / max(1.0 - u_anaThreshold, 0.001), 0.0, 1.0);
  if (u_anaShowThreshold > 0.5) return vec3(am);
  vec3 r = c + u_anaColorTint * (am * u_anaBoost * 0.35);
  if (u_anaReflection > 0.5) {
    vec3 flip = lkTap(vec2(1.0 - uv.x, uv.y));
    r = r + flip * u_anaColorTint * (max(u_anaReflectionBoost, 0.0) * 0.15);
  }
  return r;
}

vec3 fxEdge(vec3 c, vec2 uv) {
  if (u_edgeEnable < 0.5 || u_edgeBlurSize == 0.0) return c;
  vec2 ec = vec2(0.5 + u_edgeCenterX * 0.5, 0.5 + u_edgeCenterY * 0.5);
  vec2 ed = vec2((uv.x - ec.x) * u_edgeAspect, uv.y - ec.y);
  float eout = lkSmooth(u_edgeRadius, u_edgeRadius + u_edgeSpread + 0.0001, length(ed));
  float ebr = u_edgeBlurSize * 300.0 * (0.5 + u_edgeQuality / 8.0);
  vec3 eb = lkBox(uv, ebr, 0.0);
  return mix(c, eb, eout * clamp(u_edgeBlurSize * 40.0, 0.0, 1.0));
}

vec3 fxCa(vec3 c, vec2 uv) {
  if (u_caEnable < 0.5) return c;
  if (u_caRedCyan == 0.0 && u_caGreenMagenta == 0.0 && u_caBlueYellow == 0.0) return c;
  vec2 co = uv - vec2(0.5);
  return vec3(
    lkTap(uv + co * u_caRedCyan * 0.02).r,
    lkTap(uv + co * u_caGreenMagenta * 0.02).g,
    lkTap(uv - co * u_caBlueYellow * 0.02).b);
}

vec3 fxShut(vec3 c, vec2 uv) {
  if (u_shutEnable < 0.5) return c;
  float smix = clamp(u_shutBoost * 0.5, 0.0, 1.0);
  if (smix <= 0.0) return c;
  float shr = max(1.0, u_shutSize * resolution.x * 0.02);
  float f = clamp(u_shutFalloff, 0.0, 1.0);
  float tx = lkTexel().x;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float w = 1.0 + (1.0 - abs(fi) / 4.0 - 1.0) * f;
    acc += lkTap(uv + vec2(shr * fi / 4.0 * tx, 0.0)) * w;
    wsum += w;
  }
  return mix(c, acc / max(wsum, 0.001), smix);
}

vec3 fxTele(vec3 c, vec2 uv) {
  if (u_teleEnable < 0.5) return c;
  if (u_teleStrength != 0.0) {
    float tf = max(u_teleSize, 0.004);
    float tu = uv.x / tf;
    float tv = uv.y / tf;
    float fu = tu - floor(tu);
    float fv = tv - floor(tv);
    float tdu = min(fu, 1.0 - fu);
    float tdv = min(fv, 1.0 - fv);
    float tnet = max(1.0 - lkSmooth(0.0, 0.03, tdu), 1.0 - lkSmooth(0.0, 0.03, tdv));
    c = c * (1.0 - tnet * u_teleStrength * 0.6);
  }
  return lkExposure(c, u_teleExposure);
}

// Dispatch by catalog index (see the header table). Index 24 (lens) is
// handled before the chain and is the identity here.
vec3 lkApply(float id, vec3 c, vec2 uv) {
  if (abs(id - 0.0) < 0.5) return fxCc(c, uv);
  if (abs(id - 1.0) < 0.5) return fxHsl(c, uv);
  if (abs(id - 2.0) < 0.5) return fxCr(c, uv);
  if (abs(id - 3.0) < 0.5) return fxCru(c, uv);
  if (abs(id - 4.0) < 0.5) return fxCon(c, uv);
  if (abs(id - 5.0) < 0.5) return fxCrev(c, uv);
  if (abs(id - 6.0) < 0.5) return fxStrip(c, uv);
  if (abs(id - 7.0) < 0.5) return fxLgg(c, uv);
  if (abs(id - 8.0) < 0.5) return fxRsat(c, uv);
  if (abs(id - 9.0) < 0.5) return fxWc(c, uv);
  if (abs(id - 10.0) < 0.5) return fxFw4(c, uv);
  if (abs(id - 11.0) < 0.5) return fxMojo(c, uv);
  if (abs(id - 12.0) < 0.5) return fxAsh(c, uv);
  if (abs(id - 13.0) < 0.5) return fxCurv(c, uv);
  if (abs(id - 14.0) < 0.5) return fxScv(c, uv);
  if (abs(id - 15.0) < 0.5) return fxLut(c, uv);
  if (abs(id - 16.0) < 0.5) return fxLfl(c, uv);
  if (abs(id - 17.0) < 0.5) return fxDfl(c, uv);
  if (abs(id - 18.0) < 0.5) return fxVig(c, uv);
  if (abs(id - 19.0) < 0.5) return fxHaze(c, uv);
  if (abs(id - 20.0) < 0.5) return fxPop(c, uv);
  if (abs(id - 21.0) < 0.5) return fxDif(c, uv);
  if (abs(id - 22.0) < 0.5) return fxStar(c, uv);
  if (abs(id - 23.0) < 0.5) return fxAna(c, uv);
  if (abs(id - 25.0) < 0.5) return fxShut(c, uv);
  if (abs(id - 26.0) < 0.5) return fxEdge(c, uv);
  if (abs(id - 27.0) < 0.5) return fxCa(c, uv);
  if (abs(id - 28.0) < 0.5) return fxTele(c, uv);
  return c;
}

void main() {
  vec2 uv = vUv;

  // Lens Distortion: geometric resample before the chain, when it is in the
  // chain and enabled.
  bool lensOn = false;
  for (int k = 0; k < 29; k++) {
    if (float(k) >= u_chainCount) break;
    if (abs(u_chain[k] - 24.0) < 0.5) lensOn = true;
  }
  if (lensOn && u_lensEnable > 0.5 && (u_lensDistortion != 0.0 || u_lensFlatten != 0.0)) {
    vec2 off = uv - vec2(0.5);
    float r2 = dot(off, off);
    float f = 1.0 + u_lensDistortion * r2 * 4.0;
    uv = vec2(0.5 + off.x * f, 0.5 + off.y * (1.0 + u_lensDistortion * r2 * 4.0 * u_lensFlatten));
  }

  vec4 src = texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));
  float a = src.a;
  vec3 c = a > 0.000001 ? src.rgb / a : vec3(0.0);

  for (int k = 0; k < 29; k++) {
    if (float(k) >= u_chainCount) break;
    c = lkApply(u_chain[k], c, uv);
  }

  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}
