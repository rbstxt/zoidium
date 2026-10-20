// Magic Looks — full-chain color grade fragment shader.
//
// Mirrors the Looks.grade JS reference pipeline op-for-op: lens
// distortion first, then the color tools, curves/S-curve channel LUTs,
// the LUT tool, light tools, and lens tools. Per-tool enables gate every
// stage; identity defaults pass the image through untouched (except Color
// Contrast, whose fixed 0.37 amount is the tool character).
//
// NOTE: wheel vec3 uniforms carry a Tint suffix because the color-ranges
// zone-position numbers own the bare prop keys.

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform sampler2D uCurvesLUT;

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
uniform float u_crThreshold;
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
uniform float u_mojoTint;
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
uniform float u_scvLog;
uniform float u_lflBoost;
uniform float u_lflExposure;
uniform float u_dflSize;
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
uniform float u_starThresholdSoftness;
uniform float u_starAngle;
uniform float u_anaSize;
uniform float u_anaBoost;
uniform float u_anaThreshold;
uniform float u_anaShowThreshold;
uniform float u_anaThresholdSoftness;
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

// --- HSL anchors ---
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

float lkHueOf(vec3 c) {
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
  float d = abs(a - b);
  d = mod(d, 360.0);
  return d > 180.0 ? 360.0 - d : d;
}

vec3 lkTap(vec2 uv) {
  return texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

vec3 lkBox(vec2 uv, vec2 texel, float r, float diag) {
  vec3 acc = lkTap(uv) * 1.0;
  acc += lkTap(uv + vec2(r, 0.0) * texel);
  acc += lkTap(uv - vec2(r, 0.0) * texel);
  acc += lkTap(uv + vec2(0.0, r) * texel);
  acc += lkTap(uv - vec2(0.0, r) * texel);
  float n = 5.0;
  if (diag > 0.5) {
    acc += lkTap(uv + vec2(r * 0.7071, r * 0.7071) * texel);
    acc += lkTap(uv + vec2(-r * 0.7071, r * 0.7071) * texel);
    acc += lkTap(uv + vec2(r * 0.7071, -r * 0.7071) * texel);
    acc += lkTap(uv + vec2(-r * 0.7071, -r * 0.7071) * texel);
    n = 9.0;
  }
  return acc / n;
}

vec3 lkLine(vec2 uv, vec2 texel, float r, vec2 dir, int count) {
  vec3 acc = vec3(0.0);
  float n = 0.0;
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    if (abs(fi) > float(count) * 0.5) continue;
    acc += lkTap(uv + dir * (r * fi / max(float(count) * 0.5, 1.0)) * texel);
    n += 1.0;
  }
  return acc / max(n, 1.0);
}

void main() {
  vec2 texel = vec2(1.0) / max(resolution, vec2(1.0));
  vec2 uv = vUv;

  // 1. Lens distortion (geometric): resample the source.
  if (u_lensEnable > 0.5 && (u_lensDistortion != 0.0 || u_lensFlatten != 0.0)) {
    vec2 off = uv - vec2(0.5);
    float r2 = dot(off, off);
    float f = 1.0 + u_lensDistortion * r2 * 4.0;
    uv = vec2(0.5 + off.x * f, 0.5 + off.y * (1.0 + u_lensDistortion * r2 * 4.0 * u_lensFlatten));
  }
  vec3 c = lkTap(uv);

  // 2. Lift-Gamma-Gain.
  if (u_lggEnable > 0.5) {
    float gs = u_lggGammaSpace / 2.2;
    vec3 r = pow(max(c, vec3(0.0)), vec3(gs));
    r = r + (u_lggLiftTint - vec3(1.0));
    r = r * u_lggGainTint;
    r = pow(max(r, vec3(0.0)), vec3(1.0) / max(u_lggGammaTint, vec3(0.001)));
    r = pow(max(r, vec3(0.0)), vec3(2.2 / u_lggGammaSpace));
    c = mix(c, r, clamp(u_lggStrength, 0.0, 1.0));
    c = lkExposure(c, u_lggExposure);
  }

  // 3. Contrast + Color Contrast + Crush.
  if (u_conEnable > 0.5) {
    c = lkContrast(c, u_conContrast, u_conPivot);
    c = lkExposure(c, u_conExposure);
  }
  if (u_ccEnable > 0.5) {
    vec3 r = lkContrast(c, 0.37, u_ccPivot);
    c = r * u_ccContrastTint;
    c = lkExposure(c, u_ccExposure);
  }
  if (u_cruEnable > 0.5) {
    vec3 r = pow(max(c, vec3(0.0)), vec3(u_cruGamma));
    c = r * u_cruColorTint;
    c = lkExposure(c, u_cruExposure);
  }

  // 4. Ranged Saturation (zone-weighted saturation + zone tints).
  if (u_rsatEnable > 0.5) {
    float l0 = lkLuma(c);
    float lo = min(min(u_rsatThresholdShadow, u_rsatThresholdMidtone), u_rsatThresholdHighlight);
    float hi = max(max(u_rsatThresholdShadow, u_rsatThresholdMidtone), u_rsatThresholdHighlight);
    float md = u_rsatThresholdShadow + u_rsatThresholdMidtone + u_rsatThresholdHighlight - lo - hi;
    float sh = 1.0 - smoothstep(lo, md, l0);
    float hh = smoothstep(md, hi, l0);
    float mm = clamp(1.0 - sh - hh, 0.0, 1.0);
    float ss = sh * u_rsatSatShadow + mm * u_rsatSatMidtone + hh * u_rsatSatHighlight;
    vec3 r = lkSat(c, ss);
    r = r * mix(vec3(1.0), u_crHighlightTint, hh)
      * mix(vec3(1.0), u_crMidtoneTint, mm)
      * mix(vec3(1.0), u_crShadowTint, sh);
    c = r * u_rsatBalanceTint;
    if (u_rsatShowThreshold > 0.5) c = vec3(sh, mm, hh);
    c = lkExposure(c, u_rsatExposure);
  }

  // 5. Mojo II.
  if (u_mojoEnable > 0.5) {
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
    c = mix(c, r, clamp(u_mojoMojo, 0.0, 1.0) * clamp(u_mojoStrength, 0.0, 1.0));
  }

  // 6. 3-Strip dye matrix.
  if (u_stripEnable > 0.5) {
    vec3 r = vec3(
      c.r * 0.88 + c.g * 0.08 + c.b * 0.04,
      c.r * 0.06 + c.g * 0.82 + c.b * 0.12,
      c.r * 0.08 + c.g * 0.10 + c.b * 0.82);
    c = mix(c, r, clamp(u_stripStrength, 0.0, 1.0));
    c = lkExposure(c, u_stripExposure);
  }

  // 7. Color Reversal + Auto Shoulder.
  if (u_crevEnable > 0.5) {
    c = mix(c, vec3(1.0) - c, clamp(u_crevStrength, 0.0, 1.0));
    c = lkExposure(c, u_crevExposure);
  }
  if (u_ashEnable > 0.5) {
    vec3 r = c / (c + vec3(0.18)) * 1.18;
    c = mix(c, r, clamp(u_ashStrength, 0.0, 1.0));
  }

  // 8. HSL selective.
  if (u_hslEnable > 0.5) {
    float h = lkHueOf(c);
    float satS = 1.0;
    float lite = 0.0;
    float d0 = lkCircDist(h, 0.0);
    float d1 = lkCircDist(h, 30.0);
    float d2 = lkCircDist(h, 60.0);
    float d3 = lkCircDist(h, 120.0);
    float d4 = lkCircDist(h, 180.0);
    float d5 = lkCircDist(h, 240.0);
    float d6 = lkCircDist(h, 270.0);
    float d7 = lkCircDist(h, 300.0);
    satS += u_hslSat0 * exp(-pow(d0 / 28.0, 2.0));
    satS += u_hslSat1 * exp(-pow(d1 / 28.0, 2.0));
    satS += u_hslSat2 * exp(-pow(d2 / 28.0, 2.0));
    satS += u_hslSat3 * exp(-pow(d3 / 28.0, 2.0));
    satS += u_hslSat4 * exp(-pow(d4 / 28.0, 2.0));
    satS += u_hslSat5 * exp(-pow(d5 / 28.0, 2.0));
    satS += u_hslSat6 * exp(-pow(d6 / 28.0, 2.0));
    satS += u_hslSat7 * exp(-pow(d7 / 28.0, 2.0));
    lite += u_hslLight0 * exp(-pow(d0 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight1 * exp(-pow(d1 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight2 * exp(-pow(d2 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight3 * exp(-pow(d3 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight4 * exp(-pow(d4 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight5 * exp(-pow(d5 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight6 * exp(-pow(d6 / 28.0, 2.0)) * 0.5;
    lite += u_hslLight7 * exp(-pow(d7 / 28.0, 2.0)) * 0.5;
    c = lkSat(c, max(satS, 0.0)) + vec3(lite);
  }

  // 9. Warm/Cool + 4-Way.
  if (u_wcEnable > 0.5) {
    c = c + vec3(u_wcWarmCool * 0.28 + u_wcTint * 0.18,
      u_wcWarmCool * 0.12 - u_wcTint * 0.18,
      -u_wcWarmCool * 0.28 + u_wcTint * 0.18);
    c = lkExposure(c, u_wcExposure);
  }
  if (u_fw4Enable > 0.5) {
    float lw = lkLuma(c);
    float fsh = 1.0 - smoothstep(0.2, 0.5, lw);
    float fhi = smoothstep(0.5, 0.8, lw);
    float fmid = clamp(1.0 - fsh - fhi, 0.0, 1.0);
    float s4 = clamp(u_fw4Strength, 0.0, 1.0);
    vec3 m = (vec3(1.0) + (u_fw4ShadowsTint - vec3(1.0)) * fsh * s4)
      * (vec3(1.0) + (u_fw4MidtonesTint - vec3(1.0)) * fmid * s4)
      * (vec3(1.0) + (u_fw4HighlightsTint - vec3(1.0)) * fhi * s4)
      * (vec3(1.0) + (u_fw4GlobalTint - vec3(1.0)) * s4);
    vec3 r = c * m;
    r = lkContrast(r, u_fw4Contrast, 0.18);
    c = lkExposure(r, u_fw4Exposure);
  }

  // 10. Curves + S-curve channel LUTs.
  if (u_curvEnable > 0.5) {
    c = vec3(
      texture2D(uCurvesLUT, vec2(clamp(c.r, 0.0, 1.0), 0.5)).r,
      texture2D(uCurvesLUT, vec2(clamp(c.g, 0.0, 1.0), 0.5)).g,
      texture2D(uCurvesLUT, vec2(clamp(c.b, 0.0, 1.0), 0.5)).b);
  }

  // 11. LUT tool.
  if (u_lutEnable > 0.5) {
    vec3 r = c;
    if (u_lutGamma > 0.5 && u_lutGamma < 1.5) {
      r = pow(max(r, vec3(0.0)), vec3(2.2));
    }
    if (u_lutMode > 0.5 && u_lutMode < 1.5) {
      r = r * vec3(1.1, 1.0, 0.88) + vec3(0.035, 0.012, -0.02);
    } else if (u_lutMode > 1.5 && u_lutMode < 2.5) {
      r = r * vec3(0.9, 0.97, 1.1) + vec3(-0.02, 0.0, 0.03);
    } else if (u_lutMode > 2.5) {
      r = lkContrast(lkSat(r, 0.2), 0.35, 0.18);
    }
    if (u_lutGamma > 1.5) {
      r = pow(max(r, vec3(0.0)), vec3(1.0 / 2.2));
    }
    c = mix(c, r, clamp(u_lutStrength, 0.0, 1.0));
  }

  // 12. Lightflex.
  if (u_lflEnable > 0.5) {
    float lfl = lkLuma(c);
    c = c + u_lflColorTint * (u_lflBoost * 0.045) * (1.0 - lfl);
    c = lkExposure(c, u_lflExposure);
  }

  // 13. Deflare.
  if (u_dflEnable > 0.5) {
    float dfl = lkLuma(c);
    float dff = smoothstep(0.55, 0.95, dfl) * clamp(u_dflStrength, 0.0, 1.0);
    vec3 r = mix(c, vec3(dfl), dff * 0.7);
    c = r + vec3(dff * 0.05);
    c = lkExposure(c, u_dflExposure);
  }

  // 14. Vignette.
  if (u_vigEnable > 0.5) {
    vec2 vc = vec2(0.5 + u_vigCenterX * 0.5, 0.5 + u_vigCenterY * 0.5);
    vec2 vd = vec2((uv.x - vc.x) * u_vigAspect, uv.y - vc.y);
    float dd = length(vd);
    float inner = u_vigRadius * (1.0 - u_vigSpread * 0.85);
    float vm = smoothstep(inner, max(u_vigRadius, inner + 0.0001), dd);
    float vf = pow(vm, u_vigFalloff * 2.0 + 0.3) * clamp(u_vigStrength, 0.0, 1.0);
    c = c * mix(vec3(1.0), u_vigColorTint, vf);
    c = lkExposure(c, u_vigExposure);
  }

  // 15. Haze/Flare.
  if (u_hazeEnable > 0.5) {
    float hr = 1.0 + u_hazeSoftness * 14.0;
    vec3 glow = lkBox(uv, texel, hr, 0.0);
    vec3 hazed = glow * u_hazeTintTint + vec3(0.02);
    vec3 r = mix(c, hazed, clamp(u_hazeSpillage, 0.0, 1.0));
    if (u_hazeReflection > 0.5 && u_hazeReflectionExposure != 0.0) {
      vec3 hs = lkLine(uv, texel, u_hazeReach * resolution.x * 0.04, vec2(1.0, 0.0), 7);
      r = r + hs * u_hazeTintTint * u_hazeReflectionExposure * 0.15;
    }
    float hbox = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
    float hout = smoothstep(u_hazeMatteBoxSize, u_hazeMatteBoxSize + 0.08, hbox);
    if (u_hazeSpillage > 0.0) {
      r = r * (1.0 - hout * u_hazeMatteBoxShade * 0.85);
    }
    c = lkExposure(r, u_hazeExposure);
  }

  // 16. Pop.
  if (u_popEnable > 0.5 && u_popPop != 0.0) {
    float pr = 1.0 + u_popSize * 3.0;
    vec3 pb = lkBox(uv, texel, pr, 0.0);
    vec3 pd = c - pb;
    float pdet = length(pd);
    float pkeep = 1.0 - u_popPreserveDetail * smoothstep(0.0, 0.25, pdet);
    c = c + pd * u_popPop * pkeep;
  }

  // 17. Diffusion.
  if (u_difEnable > 0.5) {
    if (u_difGlow != 0.0) {
      float dr = (1.0 + u_difSize * 10.0) * (0.5 + u_difGrade * 0.15);
      vec3 dg = lkBox(uv, texel, dr, 1.0);
      float dl = lkLuma(c);
      float dmask = smoothstep(u_difHighlightsOnly * 0.7, min(1.0, u_difHighlightsOnly * 0.7 + 0.25), dl + u_difHighlightBias * 0.15);
      c = c + dg * u_difColorTint * u_difGlow * dmask * (0.35 + u_difGrade * 0.08);
    }
    c = lkExposure(c, u_difExposure);
  }

  // 18. Star Filter.
  if (u_starEnable > 0.5) {
    if (u_starBoost != 0.0) {
      float sar = u_starAngle * 3.14159265 / 180.0;
      float sr = 2.0 + u_starSize * 40.0;
      vec3 s1 = lkLine(uv, texel, sr, vec2(cos(sar), sin(sar)), 5);
      vec3 s2 = lkLine(uv, texel, sr, vec2(-sin(sar), cos(sar)), 5);
      float sl = max(lkLuma(s1), lkLuma(s2));
      float sm = clamp((sl - u_starThreshold) / max(1.0 - u_starThreshold, 0.001), 0.0, 1.0);
      vec3 r = c + u_starColorTint * sm * u_starBoost * 0.3;
      c = u_starShowThreshold > 0.5 ? vec3(sm) : r;
    } else if (u_starShowThreshold > 0.5) {
      c = vec3(0.0);
    }
  }

  // 19. Anamorphic Flare.
  if (u_anaEnable > 0.5) {
    if (u_anaBoost != 0.0) {
      float ar = max(1.0, u_anaSize * 20.0);
      vec3 ag = lkLine(uv, texel, ar, vec2(1.0, 0.0), 9);
      float al = lkLuma(ag);
      float am = clamp((al - u_anaThreshold) / max(1.0 - u_anaThreshold, 0.001), 0.0, 1.0);
      vec3 r = c + u_anaColorTint * am * u_anaBoost * 0.35;
      if (u_anaReflection > 0.5) {
        vec3 flip = lkTap(vec2(1.0 - uv.x, uv.y));
        r = r + flip * u_anaColorTint * max(u_anaReflectionBoost, 0.0) * 0.15;
      }
      c = u_anaShowThreshold > 0.5 ? vec3(am) : r;
    } else if (u_anaShowThreshold > 0.5) {
      c = vec3(0.0);
    }
  }

  // 20. Edge Softness.
  if (u_edgeEnable > 0.5 && u_edgeBlurSize != 0.0) {
    vec2 ec = vec2(0.5 + u_edgeCenterX * 0.5, 0.5 + u_edgeCenterY * 0.5);
    vec2 ed = vec2((uv.x - ec.x) * u_edgeAspect, uv.y - ec.y);
    float er = length(ed);
    float eout = smoothstep(u_edgeRadius, u_edgeRadius + u_edgeSpread + 0.0001, er);
    float ebr = u_edgeBlurSize * 300.0 * (0.5 + u_edgeQuality / 8.0);
    vec3 eb = lkBox(uv, texel, ebr, 0.0);
    c = mix(c, eb, eout * clamp(u_edgeBlurSize * 40.0, 0.0, 1.0));
  }

  // 21. Chromatic Aberration.
  if (u_caEnable > 0.5 && (u_caRedCyan != 0.0 || u_caGreenMagenta != 0.0 || u_caBlueYellow != 0.0)) {
    vec2 co = uv - vec2(0.5);
    c = vec3(
      lkTap(uv + co * u_caRedCyan * 0.02).r,
      lkTap(uv + co * u_caGreenMagenta * 0.02).g,
      lkTap(uv - co * u_caBlueYellow * 0.02).b);
  }

  // 22. Shutter Streak.
  if (u_shutEnable > 0.5) {
    float smix = clamp(u_shutBoost * 0.5, 0.0, 1.0);
    if (smix > 0.0) {
      float shr = max(1.0, u_shutSize * resolution.x * 0.02);
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = -4; i <= 4; i++) {
        float fi = float(i);
        float w = mix(1.0, 1.0 - abs(fi) / 4.0, clamp(u_shutFalloff, 0.0, 1.0));
        acc += lkTap(uv + vec2(shr * fi / 4.0 * texel.x, 0.0)) * w;
        wsum += w;
      }
      c = mix(c, acc / max(wsum, 0.001), smix);
    }
  }

  // 23. Telecine Net.
  if (u_teleEnable > 0.5) {
    if (u_teleStrength != 0.0) {
      float tf = max(u_teleSize, 0.004);
      float tu = uv.x / tf;
      float tv = uv.y / tf;
      float tdu = min(tu - floor(tu), 1.0 - (tu - floor(tu)));
      float tdv = min(tv - floor(tv), 1.0 - (tv - floor(tv)));
      float tnet = max(1.0 - smoothstep(0.0, 0.03, tdu), 1.0 - smoothstep(0.0, 0.03, tdv));
      c = c * (1.0 - tnet * u_teleStrength * 0.6);
    }
    c = lkExposure(c, u_teleExposure);
  }

  gl_FragColor = vec4(c, 1.0);
}
