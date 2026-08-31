precision highp float;
precision highp int;

// =====================================================================
//  Panzoid CM3 – Lumetri-style GLSL Shader
//  NOTE: Parameter/uniform names preserved EXACTLY as provided.
// =====================================================================

// ---------------------------------------------------------------------
// Panzoid built-ins
// ---------------------------------------------------------------------
uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform vec2      uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------
const float PI = 3.14159265358979323846;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722)); // Rec.709
}

vec3 clamp01(vec3 c) { return clamp(c, 0.0, 1.0); }

// --- sRGB-ish gamma helpers (Panzoid footage is typically gamma-encoded) ---
vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toGamma(vec3 c)  { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

// RGB <-> HSV
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    float h = abs(q.z + (q.w - q.y) / (6.0 * d + e));
    float s = d / (q.x + e);
    float v = q.x;
    return vec3(h, s, v);
}

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    vec3 rgb = c.z * mix(vec3(1.0), clamp01(p - 1.0), c.y);
    return rgb;
}

// Hue distance 0..0.5 (0..180°)
float hueDist(float h1, float h2) {
    float d = abs(h1 - h2);
    return min(d, 1.0 - d);
}

// Convert Lumetri-style % slider (0..200, 100 = neutral) to −1..1
float pctToSigned(float v) {
    return (v - 100.0) / 100.0;
}

// ---------------------------------------------------------------------
// SECTION 1 – BASIC CORRECTION
// ---------------------------------------------------------------------
uniform vec3  WB_Selector;
uniform float Temperature;
uniform float Tint;
uniform float Exposure;
uniform float Contrast;
uniform float Highlights;
uniform float Shadows;
uniform float Whites;
uniform float Blacks;
uniform float Saturation_Basic;

vec3 applyWBSelector(vec3 c, vec3 sampleColor) {
    float g = (sampleColor.r + sampleColor.g + sampleColor.b) / 3.0;
    vec3 denom = max(sampleColor, vec3(1e-4));
    vec3 gain  = vec3(g) / denom;
    return c * gain;
}

vec3 applyTempTint(vec3 c, float temp, float tint) {
    float t  = clamp(temp / 100.0, -1.0, 1.0) * 0.5;
    float ti = clamp(tint / 100.0, -1.0, 1.0) * 0.5;

    vec3 wb = vec3(1.0 + t, 1.0, 1.0 - t);
    wb.g += ti;
    wb.r -= ti * 0.5;
    wb.b -= ti * 0.5;

    return c * wb;
}

vec3 applyExposure(vec3 c, float exposure) {
    float m = pow(2.0, exposure);
    return c * m;
}

vec3 applyContrast01(vec3 c, float contrastPct) {
    float k = clamp(contrastPct / 100.0, -1.0, 1.0);
    float pivot = 0.5;
    return clamp01((c - pivot) * (1.0 + k) + pivot);
}

vec3 applyBasicTonal(vec3 c, float hlPct, float shPct, float whPct, float blPct) {
    float Y = luma(c);

    float shadowMask    = 1.0 - smoothstep(0.25, 0.55, Y);
    float highlightMask = smoothstep(0.45, 0.85, Y);
    float whiteMask     = smoothstep(0.75, 1.0, Y);
    float blackMask     = 1.0 - smoothstep(0.0, 0.25, Y);

    float sh = clamp(shPct / 100.0, -1.0, 1.0) * 0.5;
    float hl = clamp(hlPct / 100.0, -1.0, 1.0) * 0.5;
    float wh = clamp(whPct / 100.0, -1.0, 1.0) * 0.7;
    float bl = clamp(blPct / 100.0, -1.0, 1.0) * 0.7;

    float Ysh = Y + sh * shadowMask;
    float Yhl = Ysh + hl * highlightMask;
    float Ywh = Yhl + wh * whiteMask;
    float Ybl = Ywh + bl * blackMask;

    float ratio = (Y > 0.0) ? (Ybl / Y) : 1.0;
    return clamp01(c * ratio);
}

vec3 applySaturationSigned(vec3 c, float satSigned) {
    float Y = luma(c);
    return clamp01(mix(vec3(Y), c, 1.0 + satSigned));
}

// ---------------------------------------------------------------------
// SECTION 2 – CREATIVE
// ---------------------------------------------------------------------
uniform float Faded_Film;
uniform float Sharpen;
uniform float Vibrance;
uniform float Saturation_Creative;
uniform vec3  Highlight_Tint;
uniform vec3  Shadow_Tint;
uniform float Tint_Balance;

vec3 applyFadedFilm(vec3 c, float amountPct) {
    float amount = clamp(amountPct / 100.0, 0.0, 1.0);
    float lift = amount * 0.25;
    c = max(c, vec3(lift));
    c = mix(c, vec3(0.5), amount * 0.3);
    return clamp01(c);
}

// ---------------------------------------------------------------------
// CREATIVE SHARPEN (FIXED) + MICROCONTRAST ABOVE 70
// - Uses true pixel step 1/resolution (doesn't "do nothing")
// - Resolution-independent radius (1080p baseline)
// - Classic unsharp mask (feels like real sharpen)
// - Microcontrast/clarity only above 70
// - Edge masked + halo limited
// ---------------------------------------------------------------------
vec3 applySharpen(vec2 uv, vec3 c, float amountPct) {

    // Slider remap:
    //  - 0..35  : very subtle
    //  - 35..70 : softer ramp
    //  - 70..100: stronger ramp
    float t = clamp((amountPct - 35.0) / 35.0, 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);

    float tSoft = pow(t, 1.65);
    float amount = 0.08 + 0.65 * tSoft;     // softer 35–70

    float u = clamp((amountPct - 70.0) / 30.0, 0.0, 1.0);
    u = smoothstep(0.0, 1.0, u);
    amount += 1.10 * pow(u, 0.80);          // stronger above 70

    if (amountPct < 5.0) return c;

    // IMPORTANT: true pixel step in UV space
    vec2 texel = 1.0 / resolution;

    // Resolution-independent radius (baseline 1080p)
    float radiusPx = clamp(resolution.y / 1080.0, 0.75, 2.75);

    // Slight growth with strength
    float aNorm = clamp(amount / 1.8, 0.0, 1.0);
    radiusPx *= mix(0.95, 1.25, aNorm);

    vec2 stepUV = texel * radiusPx;

    // Sample neighbors from the source texture
    vec3 n  = texture2D(tDiffuse, uv + vec2(0.0,      stepUV.y)).rgb;
    vec3 s  = texture2D(tDiffuse, uv - vec2(0.0,      stepUV.y)).rgb;
    vec3 e  = texture2D(tDiffuse, uv + vec2(stepUV.x,  0.0)).rgb;
    vec3 w  = texture2D(tDiffuse, uv - vec2(stepUV.x,  0.0)).rgb;

    vec3 ne = texture2D(tDiffuse, uv + vec2(stepUV.x,  stepUV.y)).rgb;
    vec3 nw = texture2D(tDiffuse, uv + vec2(-stepUV.x, stepUV.y)).rgb;
    vec3 se = texture2D(tDiffuse, uv + vec2(stepUV.x, -stepUV.y)).rgb;
    vec3 sw = texture2D(tDiffuse, uv + vec2(-stepUV.x,-stepUV.y)).rgb;

    // Center uses CURRENT color (so we don't destroy earlier grading)
    vec3 C  = toLinear(clamp01(c));
    vec3 N  = toLinear(clamp01(n));
    vec3 S  = toLinear(clamp01(s));
    vec3 E  = toLinear(clamp01(e));
    vec3 W  = toLinear(clamp01(w));
    vec3 NE = toLinear(clamp01(ne));
    vec3 NW = toLinear(clamp01(nw));
    vec3 SE = toLinear(clamp01(se));
    vec3 SW = toLinear(clamp01(sw));

    // 3x3 Gaussian blur
    vec3 blur =
        (NW + NE + SW + SE) * 1.0 +
        (N  + S  + E  + W ) * 2.0 +
        C * 4.0;
    blur *= (1.0 / 16.0);

    // High-pass detail
    vec3 highPass = C - blur;

    // Edge mask (avoid sharpening flat/noisy areas)
    float hp = abs(luma(highPass));
    float t0 = 0.006 / max(radiusPx, 1e-3);
    float t1 = 0.040 / max(radiusPx, 1e-3);
    float edgeMask = smoothstep(t0, t1, hp);

    // Halo limiting
    float limit = mix(0.03, 0.08, clamp(amount, 0.0, 1.0));
    highPass = clamp(highPass, vec3(-limit), vec3(limit));

    // Classic unsharp mask (this is the "real sharpen" feeling)
    float gain = (4.0 * amount) / max(radiusPx, 1e-3);
    vec3 outLin = C + highPass * gain * edgeMask;

    // ------------------------------------------------------------
    // MICROCONTRAST / CLARITY — ONLY ABOVE 70
    // ------------------------------------------------------------
    if (amountPct > 70.0) {

        float mcRadius = radiusPx * 2.4;
        vec2 stepUV2 = texel * mcRadius;

        vec3 n2  = texture2D(tDiffuse, uv + vec2(0.0,       stepUV2.y)).rgb;
        vec3 s2  = texture2D(tDiffuse, uv - vec2(0.0,       stepUV2.y)).rgb;
        vec3 e2  = texture2D(tDiffuse, uv + vec2(stepUV2.x,  0.0)).rgb;
        vec3 w2  = texture2D(tDiffuse, uv - vec2(stepUV2.x,  0.0)).rgb;

        vec3 ne2 = texture2D(tDiffuse, uv + vec2(stepUV2.x,  stepUV2.y)).rgb;
        vec3 nw2 = texture2D(tDiffuse, uv + vec2(-stepUV2.x, stepUV2.y)).rgb;
        vec3 se2 = texture2D(tDiffuse, uv + vec2(stepUV2.x, -stepUV2.y)).rgb;
        vec3 sw2 = texture2D(tDiffuse, uv + vec2(-stepUV2.x,-stepUV2.y)).rgb;

        vec3 N2  = toLinear(clamp01(n2));
        vec3 S2  = toLinear(clamp01(s2));
        vec3 E2  = toLinear(clamp01(e2));
        vec3 W2  = toLinear(clamp01(w2));
        vec3 NE2 = toLinear(clamp01(ne2));
        vec3 NW2 = toLinear(clamp01(nw2));
        vec3 SE2 = toLinear(clamp01(se2));
        vec3 SW2 = toLinear(clamp01(sw2));

        vec3 blur2 =
            (NW2 + NE2 + SW2 + SE2) * 1.0 +
            (N2  + S2  + E2  + W2 ) * 2.0 +
            C * 4.0;
        blur2 *= (1.0 / 16.0);

        float mcDetail = luma(C - blur2);

        float mcAbs  = abs(mcDetail);
        float mcMask = smoothstep(0.003 / max(mcRadius, 1e-3),
                                  0.020 / max(mcRadius, 1e-3),
                                  mcAbs);

        float mcStrength = 0.55 * pow(u, 0.85);  // 0..~0.55
        mcStrength /= max(mcRadius, 1e-3);

        float Yout = luma(outLin);
        float Ymc  = clamp(Yout + mcDetail * mcStrength * mcMask, 0.0, 1.0);
        float ratio = (Yout > 1e-6) ? (Ymc / Yout) : 1.0;

        outLin *= ratio;
    }

    return clamp01(toGamma(outLin));
}

vec3 applyVibrance(vec3 c, float amountSigned) {
    if (amountSigned == 0.0) return c;
    vec3 hsv = rgb2hsv(c);
    float s = hsv.y;
    float boost = amountSigned * (1.0 - s);
    hsv.y = clamp(s + boost, 0.0, 1.0);
    return clamp01(hsv2rgb(hsv));
}

vec3 applySplitTone(vec3 c, vec3 shadowTint, vec3 highlightTint, float balancePct) {
    float Y = luma(c);
    float balance = clamp(balancePct / 100.0, -1.0, 1.0);
    float pivot = 0.5 + balance * 0.25;

    float shadowMask    = 1.0 - smoothstep(pivot - 0.2, pivot + 0.05, Y);
    float highlightMask = smoothstep(pivot - 0.05, pivot + 0.2, Y);

    vec3 col = c;
    col = mix(col, col * shadowTint, shadowMask);
    col = mix(col, col * highlightTint, highlightMask);
    return clamp01(col);
}

// ---------------------------------------------------------------------
// SECTION 3 – CURVES
// ---------------------------------------------------------------------
uniform float RGBW_Modes;      // 0=W,1=R,2=G,3=B (Panzoid float slider)
uniform float Curve_Shadow;    // -100..100
uniform float Curve_Highlight; // -100..100

uniform vec3  Hue_Selector;
uniform vec3  Saturation_Selector;
uniform vec3  Luma_Selector;

uniform float Curve_Hue;
uniform float Curve_Sat;       // (kept name)
uniform float Curve_Luma;

// RGBW curves: linear light + stronger response
float curveShadowHighlightGamma(float x, float shSigned, float hlSigned) {
    float t = clamp(x, 0.0, 1.0);

    const float SH_END   = 0.40;
    const float HI_START = 0.60;

    float shadowMask    = 1.0 - smoothstep(0.00, SH_END, t);
    float highlightMask = smoothstep(HI_START, 1.00, t);

    shadowMask    = pow(shadowMask, 1.45);
    highlightMask = pow(highlightMask, 1.45);

    float wS = shadowMask * (1.0 - highlightMask);
    float wH = highlightMask * (1.0 - shadowMask);
    float wM = 1.0 - wS - wH;

    shSigned = clamp(shSigned, -2.0, 2.0);
    hlSigned = clamp(hlSigned, -2.0, 2.0);

    float gammaS = pow(2.0,  shSigned);
    float gammaH = pow(2.0, -hlSigned);

    float yShadow = pow(t, gammaS);
    float yHigh   = 1.0 - pow(1.0 - t, gammaH);

    float y = t * wM + yShadow * wS + yHigh * wH;
    return clamp(y, 0.0, 1.0);
}

vec3 applyRGBWCurves(vec3 c, int mode, float shPct, float hlPct) {
    float sh = clamp(shPct / 100.0, -2.0, 2.0);
    float hl = clamp(hlPct / 100.0, -2.0, 2.0);

    vec3 lin = toLinear(c);

    if (mode == 0) {
        float Y  = luma(lin);
        float Y2 = curveShadowHighlightGamma(Y, sh, hl);
        float ratio = (Y > 1e-6) ? (Y2 / Y) : 1.0;
        lin *= ratio;
    } else if (mode == 1) {
        lin.r = curveShadowHighlightGamma(lin.r, sh, hl);
    } else if (mode == 2) {
        lin.g = curveShadowHighlightGamma(lin.g, sh, hl);
    } else if (mode == 3) {
        lin.b = curveShadowHighlightGamma(lin.b, sh, hl);
    }

    return clamp01(toGamma(lin));
}

// Curve_Sat fix: boosts picked hue reliably
vec3 applyHueSatLumaCurves(vec3 c,
                           vec3 hueSelColor,
                           vec3 satSelColor,
                           vec3 lumaSelColor,
                           float hueShiftParam,
                           float satDeltaSigned,
                           float lumaDeltaPct) {

    vec3 hsv = rgb2hsv(c);

    float targetHue = rgb2hsv(hueSelColor).x;

    float hueWidth = 0.12;
    float dHue = hueDist(hsv.x, targetHue);
    float hueMask = smoothstep(hueWidth, 0.0, dHue);

    float Y = luma(c);
    float lumGate = smoothstep(0.02, 0.10, Y) * (1.0 - smoothstep(0.90, 0.99, Y));
    float maskSat = clamp(hueMask * lumGate, 0.0, 1.0);

    float targetSat = rgb2hsv(satSelColor).y;
    float targetLum = luma(lumaSelColor);

    float satWidth = 0.55;
    float lumWidth = 0.55;

    float dSat = abs(hsv.y - targetSat);
    float dLum = abs(luma(c) - targetLum);

    float satMask = smoothstep(satWidth, 0.0, dSat);
    float lumMask = smoothstep(lumWidth, 0.0, dLum);

    float maskHSL = clamp(hueMask * mix(1.0, satMask, 0.5) * mix(1.0, lumMask, 0.5), 0.0, 1.0);

    float hueShiftHueUnits;
    if (abs(hueShiftParam) > 1.5) {
        hueShiftHueUnits = clamp(hueShiftParam, -180.0, 180.0) / 360.0;
    } else {
        hueShiftHueUnits = clamp(hueShiftParam, -1.0, 1.0) * 0.5;
    }
    hsv.x = fract(hsv.x + hueShiftHueUnits * maskHSL);

    float satMul = pow(2.0, clamp(satDeltaSigned, -2.0, 2.0) * maskSat);
    hsv.y = clamp(hsv.y * satMul, 0.0, 1.0);

    vec3 rgbHS = hsv2rgb(hsv);

    float Y2 = luma(rgbHS);
    float dL = clamp(lumaDeltaPct / 100.0, -1.0, 1.0) * 0.5;
    float Y3 = clamp(Y2 + dL * maskHSL, 0.0, 1.0);
    float ratio = (Y2 > 1e-6) ? (Y3 / Y2) : 1.0;

    return clamp01(rgbHS * ratio);
}

// ---------------------------------------------------------------------
// SECTION 4 – COLOR WHEELS (PRIMARY)
// ---------------------------------------------------------------------
uniform vec3 CW_Highlights;
uniform vec3 CW_Midtones;
uniform vec3 CW_Shadows;

vec3 applyColorWheels(vec3 c, vec3 shCol, vec3 midCol, vec3 hiCol) {
    float Y = luma(c);

    float shadowMask    = 1.0 - smoothstep(0.3, 0.55, Y);
    float midMask       = smoothstep(0.2, 0.6, Y) * (1.0 - smoothstep(0.4, 0.8, Y));
    float highlightMask = smoothstep(0.5, 0.9, Y);

    vec3 col = c;
    col = mix(col, col * shCol, shadowMask);
    col = mix(col, col * midCol, midMask);
    col = mix(col, col * hiCol, highlightMask);
    return clamp01(col);
}

// ---------------------------------------------------------------------
// SECTION 5 – HSL SECONDARY (kept as you provided)
// ---------------------------------------------------------------------
uniform vec3  Secondary_Set_Color;
uniform vec3  Secondary_Add_Color;
uniform vec3  Secondary_Remove_Color;

uniform float Secondary_Denoise;
uniform float Secondary_Blur;

uniform vec3  Secondary_Color_Wheels;
uniform float Secondary_Temperature;
uniform float Secondary_Tint;
uniform float Secondary_Contrast;
uniform float Secondary_Sharpen;
uniform float Secondary_Saturation;

uniform float Secondary_Hue_Range;
uniform float Secondary_Hue_Feather;
uniform float Secondary_Sat_Range;
uniform float Secondary_Sat_Feather;
uniform float Secondary_Lum_Range;
uniform float Secondary_Lum_Feather;

uniform float Secondary_Show_Mask;
uniform float Secondary_Mask_View;
uniform float Secondary_Invert_Mask;

vec3 rgb2hsl(vec3 c) {
    float maxc = max(max(c.r, c.g), c.b);
    float minc = min(min(c.r, c.g), c.b);
    float l = (maxc + minc) * 0.5;

    float s = 0.0;
    float h = 0.0;

    float d = maxc - minc;
    if (d > 1e-6) {
        s = d / (1.0 - abs(2.0 * l - 1.0));

        if (maxc == c.r) {
            h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        } else if (maxc == c.g) {
            h = (c.b - c.r) / d + 2.0;
        } else {
            h = (c.r - c.g) / d + 4.0;
        }
        h /= 6.0;
    }
    return vec3(fract(h), clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0));
}

float rangeFeatherMask(float dist, float range, float feather) {
    float r0 = max(range, 1e-6);
    float r1 = max(range + feather, r0 + 1e-6);
    return 1.0 - smoothstep(r0, r1, dist);
}

float secondaryKeyMaskHSL(vec3 rgb, vec3 sampleRgb) {
    vec3 hslC = rgb2hsl(rgb);
    vec3 hslS = rgb2hsl(sampleRgb);

    float dh = hueDist(hslC.x, hslS.x);
    float ds = abs(hslC.y - hslS.y);
    float dl = abs(hslC.z - hslS.z);

    float hueRange   = mix(0.005, 0.25, clamp(Secondary_Hue_Range / 100.0, 0.0, 1.0));
    float hueFeather = mix(0.000, 0.25, clamp(Secondary_Hue_Feather / 100.0, 0.0, 1.0));

    float satRange   = mix(0.01,  1.00, clamp(Secondary_Sat_Range / 100.0, 0.0, 1.0));
    float satFeather = mix(0.00,  1.00, clamp(Secondary_Sat_Feather / 100.0, 0.0, 1.0));

    float lumRange   = mix(0.01,  1.00, clamp(Secondary_Lum_Range / 100.0, 0.0, 1.0));
    float lumFeather = mix(0.00,  1.00, clamp(Secondary_Lum_Feather / 100.0, 0.0, 1.0));

    float mh = rangeFeatherMask(dh, hueRange, hueFeather);
    float ms = rangeFeatherMask(ds, satRange, satFeather);
    float ml = rangeFeatherMask(dl, lumRange, lumFeather);

    float m = mh * ms * ml;

    float denoise = clamp(Secondary_Denoise / 100.0, 0.0, 1.0);
    m = pow(clamp(m, 0.0, 1.0), 1.0 + denoise * 2.0);

    return clamp(m, 0.0, 1.0);
}

float softenMask(float m) {
    float blur = clamp(Secondary_Blur / 100.0, 0.0, 1.0);
    float softness = mix(1.0, 0.55, blur);
    return pow(clamp(m, 0.0, 1.0), softness);
}

vec3 visualizeSecondaryMask(vec3 origColor, float m, int viewMode) {
    if (viewMode == 2) {
        return vec3(m);
    } else if (viewMode == 1) {
        return mix(vec3(0.0), origColor, m);
    } else {
        return mix(vec3(luma(origColor)), origColor, m);
    }
}

float buildSecondaryMatte(vec3 origColor) {
    if (length(Secondary_Set_Color) <= 0.001) return 0.0;

    float mSet = secondaryKeyMaskHSL(origColor, Secondary_Set_Color);

    float mAdd = 0.0;
    if (length(Secondary_Add_Color) > 0.001) {
        mAdd = secondaryKeyMaskHSL(origColor, Secondary_Add_Color);
    }

    float m = max(mSet, mAdd);

    float mRem = 0.0;
    if (length(Secondary_Remove_Color) > 0.001) {
        mRem = secondaryKeyMaskHSL(origColor, Secondary_Remove_Color);
    }

    m = clamp(m - mRem, 0.0, 1.0);

    int inv = int(clamp(floor(Secondary_Invert_Mask + 0.5), 0.0, 1.0));
    if (inv == 1) m = 1.0 - m;

    m = softenMask(m);
    return clamp(m, 0.0, 1.0);
}

vec3 applySecondary(vec2 uv, vec3 baseColor, vec3 origColor) {
    float m = buildSecondaryMatte(origColor);

    int showMask = int(clamp(floor(Secondary_Show_Mask + 0.5), 0.0, 1.0));
    int viewMode = int(clamp(floor(Secondary_Mask_View + 0.5), 0.0, 2.0));

    if (showMask == 1) {
        return visualizeSecondaryMask(origColor, m, viewMode);
    }

    if (m <= 0.001) return baseColor;

    vec3 c = baseColor;

    c = mix(c, c * Secondary_Color_Wheels, m);

    vec3 tempTinted = applyTempTint(c, Secondary_Temperature, Secondary_Tint);
    c = mix(c, tempTinted, m);

    vec3 contrastC = applyContrast01(c, Secondary_Contrast);
    c = mix(c, contrastC, m);

    if (Secondary_Sharpen > 0.0) {
        vec3 sharp = applySharpen(uv, c, Secondary_Sharpen);
        c = mix(c, sharp, m);
    }

    float secSatSigned = pctToSigned(Secondary_Saturation);
    vec3 satC = applySaturationSigned(c, secSatSigned);
    c = mix(c, satC, m);

    return c;
}

// ---------------------------------------------------------------------
// SECTION 6 – VIGNETTE
// ---------------------------------------------------------------------
uniform float Vignette_Amount;
uniform float Vignette_Midpoint;
uniform float Vignette_Roundness;
uniform float Vignette_Feather;

float vignetteMask(vec2 uv) {
    vec2 p = uv - 0.5;
    float aspect = resolution.x / resolution.y;
    p.x *= aspect;

    float r = length(p);

    float round = clamp(Vignette_Roundness / 100.0, -1.0, 1.0);
    float roundAdj = mix(1.2, 0.8, (round * 0.5 + 0.5));
    r *= roundAdj;

    float mid = mix(0.2, 0.8, clamp(Vignette_Midpoint / 100.0, 0.0, 1.0));
    float feather = mix(0.01, 0.5, clamp(Vignette_Feather / 100.0, 0.0, 1.0));

    float m = smoothstep(mid, mid + feather, r);
    return clamp(m, 0.0, 1.0);
}

vec3 applyVignette(vec2 uv, vec3 c) {
    if (Vignette_Amount == 0.0) return c;

    float m = vignetteMask(uv);
    float amt = clamp(Vignette_Amount / 100.0, -1.0, 1.0);

    vec3 vignetteColor;
    if (amt > 0.0) vignetteColor = c * (1.0 - amt);
    else           vignetteColor = mix(c, vec3(1.0), -amt);

    return mix(c, vignetteColor, m);
}

// ---------------------------------------------------------------------
// MAIN – pipeline order (similar to Lumetri)
// ---------------------------------------------------------------------
void main() {
    vec2 uv = vUvScaled;
    vec4 texel = texture2D(tDiffuse, uv);
    vec3 col = clamp01(texel.rgb);

    // 1. BASIC
    if (length(WB_Selector) > 0.001) col = applyWBSelector(col, WB_Selector);

    col = applyTempTint(col, Temperature, Tint);
    col = applyExposure(col, Exposure);
    col = applyContrast01(col, Contrast);
    col = applyBasicTonal(col, Highlights, Shadows, Whites, Blacks);

    float satBasicSigned = pctToSigned(Saturation_Basic);
    col = applySaturationSigned(col, satBasicSigned);

    // 2. CREATIVE
    col = applyFadedFilm(col, Faded_Film);
    col = applySharpen(uv, col, Sharpen);

    float vibrSigned = clamp(Vibrance / 100.0, -1.0, 1.0);
    col = applyVibrance(col, vibrSigned);

    float satCreativeSigned = pctToSigned(Saturation_Creative);
    col = applySaturationSigned(col, satCreativeSigned);

    col = applySplitTone(col, Shadow_Tint, Highlight_Tint, Tint_Balance);

    // 3. CURVES
    int mode = int(clamp(floor(RGBW_Modes + 0.5), 0.0, 3.0));
    col = applyRGBWCurves(col, mode, Curve_Shadow, Curve_Highlight);

    float curveSatSigned = clamp(Curve_Sat / 100.0, -1.0, 1.0);
    col = applyHueSatLumaCurves(col,
                               Hue_Selector,
                               Saturation_Selector,
                               Luma_Selector,
                               Curve_Hue,
                               curveSatSigned,
                               Curve_Luma);

    // 4. WHEELS
    col = applyColorWheels(col, CW_Shadows, CW_Midtones, CW_Highlights);

    // 5. HSL SECONDARY
    vec3 secOut = applySecondary(uv, col, texel.rgb);

    // IMPORTANT: if Show Mask is ON, output it directly (Lumetri behavior)
    int showMask = int(clamp(floor(Secondary_Show_Mask + 0.5), 0.0, 1.0));
    if (showMask == 1) {
        gl_FragColor = vec4(clamp01(secOut), texel.a);
        return;
    }
    col = secOut;

    // 6. VIGNETTE
    col = applyVignette(vUv, col);

    gl_FragColor = vec4(clamp01(col), texel.a);
}
