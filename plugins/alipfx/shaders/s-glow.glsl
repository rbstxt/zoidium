precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// ===== S_Glow-style controls =====
uniform float Brightness;
uniform vec3  Color;
uniform float Threshold;
uniform vec3  Threshold_Add_Color;
uniform float Glow_Width;
uniform float Width_X;
uniform float Width_Y;
uniform float Width_Red;
uniform float Width_Green;
uniform float Width_Blue;
uniform float Subpixel;
uniform float Show;              // 0=Result, 1=Threshold
uniform float Combine;           // 0=Mult, 1=Add, 2=Screen, 3=Difference, 4=Overlay
uniform float Edge_Mode;         // 0=Transparent, 1=Reflect
uniform float Affect_Alpha;
uniform float Glow_From_Alpha;
uniform float Glow_Under_Source;
uniform float Source_Opacity;

// ===== Atmosphere =====
uniform float Atmosphere_Amp;
uniform float Atmosphere_Freq;
uniform float Atmosphere_Detail;
uniform float Atmosphere_Seed;
uniform float Atmosphere_Speed;
uniform float time;

// ------------------------------------------------------------

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

vec3 saturate3(vec3 x) {
    return clamp(x, 0.0, 1.0);
}

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

bool outOfBounds(vec2 uv) {
    return (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0);
}

float mirrorCoord(float x) {
    x = mod(x, 2.0);
    return (x <= 1.0) ? x : (2.0 - x);
}

vec2 reflect01(vec2 uv) {
    return vec2(mirrorCoord(uv.x), mirrorCoord(uv.y));
}

vec4 sampleSource(vec2 uv) {
    if (Edge_Mode < 0.5) {
        if (outOfBounds(uv)) return vec4(0.0);
        return texture2D(tDiffuse, uv * uvScale);
    } else {
        vec2 ruv = reflect01(uv);
        return texture2D(tDiffuse, ruv * uvScale);
    }
}

// ------------------------------------------------------------
// Threshold seed generation
// ------------------------------------------------------------
vec3 glowSeedFromSource(vec4 src) {
    float gf = saturate(Glow_From_Alpha);

    vec3 thr = clamp(vec3(Threshold) + Threshold_Add_Color, 0.0, 0.999);
    vec3 rgbSeed = max(src.rgb - thr, 0.0) / max(vec3(1.0) - thr, vec3(1e-5));

    float aSeed = max(src.a - Threshold, 0.0) / max(1.0 - Threshold, 1e-5);
    vec3 alphaSeed = vec3(aSeed);

    return mix(rgbSeed, alphaSeed, gf);
}

float thresholdViewValue(vec4 src) {
    return saturate(luma(glowSeedFromSource(src)));
}

// ------------------------------------------------------------
// Atmosphere noise
// ------------------------------------------------------------
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, float detail) {
    float v = 0.0;
    float a = 0.5;
    float gain = mix(0.35, 0.6, saturate(detail));
    float lacunarity = mix(1.8, 2.5, saturate(detail));

    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * lacunarity + vec2(17.13, 31.71);
        a *= gain;
    }

    return v;
}

float atmosphereFactor(vec2 uv) {
    if (Atmosphere_Amp <= 0.0) return 1.0;

    float t = time * Atmosphere_Speed * 0.15;
    vec2 seedOffset = vec2(Atmosphere_Seed * 37.17, Atmosphere_Seed * 91.73);

    vec2 p = uv * max(Atmosphere_Freq, 0.0001) * 3.0;
    p += seedOffset;
    p += vec2(t, -t * 0.77);

    float baseN = fbm(p, Atmosphere_Detail);
    float fineN = fbm(p * mix(1.6, 3.4, saturate(Atmosphere_Detail)) + 11.7, 1.0);
    float n = mix(baseN, fineN, saturate(Atmosphere_Detail));

    float f = 1.0 + Atmosphere_Amp * ((n - 0.5) * 2.0);
    return max(f, 0.0);
}

// ------------------------------------------------------------
// Blend / combine modes
// ------------------------------------------------------------
vec3 blendMult(vec3 base, vec3 glow) {
    return base * glow;
}

vec3 blendAdd(vec3 base, vec3 glow) {
    return base + glow;
}

vec3 blendScreen(vec3 base, vec3 glow) {
    return 1.0 - (1.0 - base) * (1.0 - glow);
}

vec3 blendDifference(vec3 base, vec3 glow) {
    return abs(base - glow);
}

vec3 blendOverlay(vec3 base, vec3 glow) {
    vec3 low  = 2.0 * base * glow;
    vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - glow);
    return mix(low, high, step(vec3(0.5), base));
}

vec3 applyCombine(vec3 base, vec3 glow) {
    if (Combine < 0.5) return blendMult(base, glow);
    if (Combine < 1.5) return blendAdd(base, glow);
    if (Combine < 2.5) return blendScreen(base, glow);
    if (Combine < 3.5) return blendDifference(base, glow);
    return blendOverlay(base, glow);
}

// ------------------------------------------------------------
// Multi-direction blur with per-channel width control
// ------------------------------------------------------------
vec3 computeGlow(vec2 uv) {
    vec2 px = 1.0 / max(resolution, vec2(1.0));
    float baseRadius = max(Glow_Width, 0.0);

    vec2 radR = px * baseRadius * vec2(max(Width_X * Width_Red,   0.0), max(Width_Y * Width_Red,   0.0));
    vec2 radG = px * baseRadius * vec2(max(Width_X * Width_Green, 0.0), max(Width_Y * Width_Green, 0.0));
    vec2 radB = px * baseRadius * vec2(max(Width_X * Width_Blue,  0.0), max(Width_Y * Width_Blue,  0.0));

    vec3 sum = vec3(0.0);
    vec3 wsum = vec3(0.0);

    vec3 seed0 = glowSeedFromSource(sampleSource(uv));
    sum += seed0;
    wsum += vec3(1.0);

    float radialOffset = mix(1.0, 0.5, saturate(Subpixel));

    const int DIRS = 12;
    const int STEPS = 4;

    for (int d = 0; d < DIRS; d++) {
        float ang = (6.28318530718 * float(d)) / float(DIRS);
        vec2 dir = vec2(cos(ang), sin(ang));

        for (int s = 0; s < STEPS; s++) {
            float t = (float(s) + radialOffset) / float(STEPS);
            float w = exp(-4.0 * t * t);

            vec3 seedR = glowSeedFromSource(sampleSource(uv + dir * radR * t));
            vec3 seedG = glowSeedFromSource(sampleSource(uv + dir * radG * t));
            vec3 seedB = glowSeedFromSource(sampleSource(uv + dir * radB * t));

            sum.r += seedR.r * w;
            sum.g += seedG.g * w;
            sum.b += seedB.b * w;

            wsum += vec3(w);
        }
    }

    vec3 blurred = sum / max(wsum, vec3(1e-5));
    vec3 glow = blurred * Color * Brightness;
    glow *= atmosphereFactor(uv);

    return glow;
}

// ------------------------------------------------------------

void main() {
    vec2 uv = vUv;
    vec4 src = sampleSource(uv);

    if (Show > 0.5) {
        float tv = thresholdViewValue(src);
        gl_FragColor = vec4(vec3(tv), 1.0);
        return;
    }

    vec3 glow = computeGlow(uv);

    float srcOpacity = saturate(Source_Opacity);
    float srcAlpha = src.a * srcOpacity;
    vec3 srcVisible = src.rgb * srcOpacity;

    vec3 resultOver = applyCombine(srcVisible, glow);
    vec3 resultUnder = mix(glow, srcVisible, srcAlpha);
    vec3 result = mix(resultOver, resultUnder, saturate(Glow_Under_Source));

    float glowAlpha = max(max(glow.r, glow.g), glow.b) * max(Affect_Alpha, 0.0);
    float outAlpha = max(srcAlpha, saturate(glowAlpha));

    gl_FragColor = vec4(result, outAlpha);
}
