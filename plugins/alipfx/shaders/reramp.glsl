precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;
uniform vec2 uvScale;

// ============================================
// 24 PARAMETERS - ReRamp for Panzoid CM3
// ============================================

// 1. Color Blending: 0=OkLab, 1=OkLCH, 2=Kubelka-Munk, 3=Solid, 4=Linear
uniform float Color_Blending;

// 2. Smoothness
uniform float Smoothness;

// 3-10. Color_1 through Color_8 (8 gradient color stops)
uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;
uniform vec3 Color_7;
uniform vec3 Color_8;

// 11. Gradient_Colors - how many colors are active (1-8)
uniform float Gradient_Colors;

// 12. Stop Color - additional color stop for tinting
uniform vec3 Stop_Color;

// 13. Stop Alpha - alpha for stop color blending
uniform float Stop_Alpha;

// 14. Invert: 0=Off, 1=On
uniform float Invert;

// 15. Phase Offset
uniform float Phase_Offset;

// 16. Scale
uniform float Scale;

// 17. Tiling: 0=Repeat, 1=Mirror, 2=Clamp
uniform float Tiling;

// 18. Bias
uniform float Bias;

// 19. Dither
uniform float Dither;

// 20. Quantize: 0=Off, 1=On
uniform float Quantize;

// 21. Steps - number of quantization steps
uniform float Steps;

// 22. Mapping: 0=Lightness, 1=Hue, 2=Saturation, 3=Alpha
uniform float Mapping;

// 23. Source Start
uniform vec3 Source_Start;

// 24. Source End
uniform vec3 Source_End;

// ============================================
// COLOR SPACE CONVERSIONS
// ============================================

vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 linearToOklab(vec3 c) {
    float l = 0.8189330101 * c.r + 0.3618667424 * c.g + 0.1288597137 * c.b;
    float m = 0.0329845436 * c.r + 0.9293118715 * c.g + 0.0361456387 * c.b;
    float s = 0.0482003018 * c.r + 0.2643662691 * c.g + 0.6338517070 * c.b;
    l = pow(max(l, 0.0), 1.0/3.0);
    m = pow(max(m, 0.0), 1.0/3.0);
    s = pow(max(s, 0.0), 1.0/3.0);
    return vec3(
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    );
}

vec3 oklabToLinear(vec3 c) {
    float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    l = l * l * l;
    m = m * m * m;
    s = s * s * s;
    return vec3(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

vec3 linearToOklch(vec3 c) {
    vec3 lab = linearToOklab(c);
    float C = sqrt(lab.y * lab.y + lab.z * lab.z);
    float h = atan(lab.z, lab.y);
    return vec3(lab.x, C, h);
}

vec3 oklchToLinear(vec3 c) {
    float a = c.y * cos(c.z);
    float b = c.y * sin(c.z);
    return oklabToLinear(vec3(c.x, a, b));
}

vec3 kubelkaMunkMix(vec3 c1, vec3 c2, float t) {
    vec3 k1 = (1.0 - c1) / max(c1, vec3(0.001));
    vec3 k2 = (1.0 - c2) / max(c2, vec3(0.001));
    vec3 k = mix(k1, k2, t);
    return 1.0 / (1.0 + k);
}

// ============================================
// COLOR BLENDING
// ============================================

vec3 blendColors(vec3 c1, vec3 c2, float t, int mode) {
    if (mode == 0) {
        vec3 lab1 = linearToOklab(srgbToLinear(c1));
        vec3 lab2 = linearToOklab(srgbToLinear(c2));
        vec3 lab = mix(lab1, lab2, t);
        return linearToSrgb(oklabToLinear(lab));
    }
    else if (mode == 1) {
        vec3 lch1 = linearToOklch(srgbToLinear(c1));
        vec3 lch2 = linearToOklch(srgbToLinear(c2));
        float dh = lch2.z - lch1.z;
        if (dh > 3.14159) dh -= 6.28318;
        if (dh < -3.14159) dh += 6.28318;
        vec3 lch;
        lch.x = mix(lch1.x, lch2.x, t);
        lch.y = mix(lch1.y, lch2.y, t);
        lch.z = lch1.z + dh * t;
        return linearToSrgb(oklchToLinear(lch));
    }
    else if (mode == 2) {
        return kubelkaMunkMix(c1, c2, t);
    }
    else if (mode == 3) {
        return t < 0.5 ? c1 : c2;
    }
    else {
        return mix(c1, c2, t);
    }
}

// ============================================
// SOURCE VALUE EXTRACTION
// ============================================

float getLightness(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

float getHue(vec3 c) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float d = mx - mn;
    if (d < 0.0001) return 0.0;
    float h;
    if (mx == c.r) {
        h = (c.g - c.b) / d;
        if (h < 0.0) h += 6.0;
    } else if (mx == c.g) {
        h = (c.b - c.r) / d + 2.0;
    } else {
        h = (c.r - c.g) / d + 4.0;
    }
    return h / 6.0;
}

float getSaturation(vec3 c) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float d = mx - mn;
    return mx > 0.0001 ? d / mx : 0.0;
}

float getSourceValue(vec4 texel, int mapping) {
    if (mapping == 0) return getLightness(texel.rgb);
    if (mapping == 1) return getHue(texel.rgb);
    if (mapping == 2) return getSaturation(texel.rgb);
    return texel.a;
}

// ============================================
// TILING
// ============================================

float applyTiling(float x, int mode) {
    if (mode == 0) {
        return fract(x);
    }
    else if (mode == 1) {
        float f = fract(x);
        float i = floor(x);
        return mod(i, 2.0) < 1.0 ? f : 1.0 - f;
    }
    else {
        return clamp(x, 0.0, 1.0);
    }
}

// ============================================
// BIAS
// ============================================

float applyBias(float x, float b) {
    b = clamp(b, 0.0001, 0.9999);
    return pow(x, log(0.5) / log(b));
}

// ============================================
// RANDOM
// ============================================

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// ============================================
// RAMP EVALUATION
// ============================================

vec3 getColor(int idx) {
    if (idx == 0) return Color_1;
    if (idx == 1) return Color_2;
    if (idx == 2) return Color_3;
    if (idx == 3) return Color_4;
    if (idx == 4) return Color_5;
    if (idx == 5) return Color_6;
    if (idx == 6) return Color_7;
    return Color_8;
}

vec3 evaluateRamp(float t, int blendMode, float smoothness, int numColors) {
    if (numColors <= 1) {
        return Color_1;
    }
    
    float segments = float(numColors - 1);
    float scaledT = t * segments;
    float fidx = floor(scaledT);
    float localT = fract(scaledT);
    
    // Apply smoothness
    if (smoothness > 0.0 && blendMode != 3) {
        float smoothT = localT * localT * (3.0 - 2.0 * localT);
        localT = mix(localT, smoothT, smoothness);
    }
    
    int idx = int(fidx);
    int nextIdx = idx + 1;
    if (nextIdx >= numColors) nextIdx = numColors - 1;
    
    vec3 c1 = getColor(idx);
    vec3 c2 = getColor(nextIdx);
    
    return blendColors(c1, c2, localT, blendMode);
}

// ============================================
// MAIN
// ============================================

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    int mapMode = int(Mapping);
    if (mapMode < 0) mapMode = 0;
    if (mapMode > 3) mapMode = 3;
    
    float sourceVal = getSourceValue(texel, mapMode);
    
    float srcStart = getLightness(Source_Start);
    float srcEnd = getLightness(Source_End);
    float range = srcEnd - srcStart;
    if (range < 0.0001) range = 0.0001;
    
    float t = (sourceVal - srcStart) / range;
    
    if (Invert > 0.5) {
        t = 1.0 - t;
    }
    
    t += Phase_Offset;
    
    if (abs(Scale) > 0.001) {
        t *= Scale;
    }
    
    int tileMode = int(Tiling);
    if (tileMode < 0) tileMode = 0;
    if (tileMode > 2) tileMode = 2;
    t = applyTiling(t, tileMode);
    
    float biasVal = Bias;
    if (biasVal < 0.001) biasVal = 0.001;
    if (biasVal > 0.999) biasVal = 0.999;
    t = applyBias(clamp(t, 0.0, 1.0), biasVal);
    
    if (Dither > 0.0) {
        float noise = hash(vUvScaled * resolution + fract(gl_FragCoord.xy * 0.1)) - 0.5;
        t += noise * Dither;
    }
    
    t = clamp(t, 0.0, 1.0);
    
    if (Quantize > 0.5 && Steps >= 2.0) {
        float n = Steps;
        if (n < 2.0) n = 2.0;
        t = floor(t * n) / (n - 1.0);
        t = clamp(t, 0.0, 1.0);
    }
    
    int blendMode = int(Color_Blending);
    if (blendMode < 0) blendMode = 0;
    if (blendMode > 4) blendMode = 4;
    
    int numColors = int(Gradient_Colors);
    if (numColors < 1) numColors = 1;
    if (numColors > 8) numColors = 8;
    
    vec3 rampColor = evaluateRamp(t, blendMode, Smoothness, numColors);
    
    // --- FIXED STOP ALPHA & KEYMAPPER IMPLEMENTATION ---
    float stopA = clamp(Stop_Alpha, 0.0, 1.0);
    
    // Calculate the color distance match to target the specific color stop range smoothly
    float dist = distance(rampColor, Stop_Color);
    float match = smoothstep(0.15, 0.0, dist); 
    
    // Key out the targeted color stop by fading alpha and restoring original layer content based on stopA
    vec3 finalColor = mix(rampColor, texel.rgb, match * (1.0 - stopA));
    float finalAlpha = mix(texel.a, texel.a * stopA, match);
    
    gl_FragColor = vec4(finalColor, finalAlpha);
}
