precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vUvScaled;

// ============================================================
// GLASSWORK for Panzoid CM3 - v4.2
// ALL Patterns Fixed (Strips, ZigZag, Rhombuses, Waves)
// Compliant with Panzoid shader rules
// ============================================================

uniform float Pattern_Type;      // 0=Strips, 1=ZigZag, 2=Rhombuses, 3=Waves
uniform float Show_Pattern;      // 0=Disabled, 1=Enabled
uniform float X_Displacement;    // Horizontal distortion
uniform float Y_Displacement;    // Vertical distortion
uniform float Pattern_Smoothness;// Edge softness
uniform float Pattern_Size;      // Pattern scale
uniform float Pattern_Angle;     // Rotation (degrees)
uniform vec2  Pattern_Position;  // 2D offset
uniform float Blur_Samples;      // Blur quality
uniform float Bluriness;         // Blur amount
uniform float Frostiness;        // Frost intensity
uniform float Frost_Scale;       // Frost grain size

// ============================================================
// NOISE FUNCTIONS
// ============================================================

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}

// Multi-octave noise for frost
float frostNoise(vec2 p) {
    float n = vnoise(p);
    n += vnoise(p * 2.03) * 0.5;
    n += vnoise(p * 4.01) * 0.25;
    n += vnoise(p * 8.07) * 0.125;
    return n / 1.875;
}

// ============================================================
// UTILITIES
// ============================================================

mat2 rot2(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

// ============================================================
// PATTERNS
// ============================================================

// 0. Strips - Sawtooth wave for flat, tilted glass panes
float patStrips(vec2 uv, float sz) {
    return fract(uv.x * sz);
}

// 1. ZigZag - CHEVRON pattern matching AE Glasswork
float patZigZag(vec2 uv, float sz) {
    vec2 p = uv * sz;
    float col = floor(p.x);
    float dir = mod(col, 2.0) * 2.0 - 1.0;
    float localX = fract(p.x);
    float v = fract(p.y + (dir * localX));
    return abs(v - 0.5) * 2.0;
}

// 2. Rhombuses - Faceted diamond pyramids
float patRhombuses(vec2 uv, float sz) {
    vec2 p = uv * sz;
    
    // Rotate grid 45 degrees to turn squares into diamonds
    vec2 r = vec2(p.x - p.y, p.x + p.y) * 0.70710678;
    
    // Max generates pyramid blocks instead of soft gradients
    float d = max(abs(fract(r.x) - 0.5), abs(fract(r.y) - 0.5));
    
    // Scale to a clean 0.0 to 1.0 range
    return d * 2.0;
}

// 3. Waves - sine wave displacement pattern
float patWaves(vec2 uv, float sz) {
    vec2 p = uv * sz;
    float waveOffset = sin(p.x * 3.14159265359) * 0.5;
    float v = fract(p.y + waveOffset);
    return abs(v - 0.5) * 2.0;
}

float samplePattern(vec2 uv, int type, float sz, float sm) {
    float v;
    if (type == 0) v = patStrips(uv, sz);
    else if (type == 1) v = patZigZag(uv, sz);
    else if (type == 2) v = patRhombuses(uv, sz);
    else if (type == 3) v = patWaves(uv, sz);
    else v = patStrips(uv, sz);

    float e = sm / 100.0;
    if (e > 0.001) {
        v = smoothstep(0.0, e, v);
    }
    return v;
}

// ============================================================
// BLUR
// ============================================================

vec4 doBlur(sampler2D tex, vec2 uv, float amt, float samples) {
    if (amt <= 0.0 || samples <= 1.0) return texture2D(tex, uv);

    vec4 c = vec4(0.0);
    float w = 0.0;
    int n = int(clamp(samples, 2.0, 24.0));

    for (int i = 0; i < 24; i++) {
        if (i >= n) break;
        for (int j = 0; j < 24; j++) {
            if (j >= n) break;
            float fi = (float(i) / float(n - 1) - 0.5) * 2.0;
            float fj = (float(j) / float(n - 1) - 0.5) * 2.0;
            float gw = exp(-(fi * fi + fj * fj) * 1.5);
            c += texture2D(tex, uv + vec2(fi, fj) * amt) * gw;
            w += gw;
        }
    }
    return c / max(w, 0.0001);
}

// ============================================================
// MAIN
// ============================================================

void main() {
    // Use vUvScaled as per Panzoid rules for proper buffer mapping
    vec2 uv = vUvScaled;

    // ---- Pattern space ----
    vec2 pUV = uv;
    pUV -= Pattern_Position / resolution;
    pUV = rot2(radians(Pattern_Angle)) * (pUV - 0.5) + 0.5;

    int pType = int(floor(Pattern_Type + 0.5));
    float pSize = max(Pattern_Size, 0.01);
    float pSmooth = max(Pattern_Smoothness, 0.0);

    // ---- Sample pattern ----
    float pat = samplePattern(pUV, pType, pSize, pSmooth);

    // ---- Displacement ----
    // Pattern drives displacement; 0.5 is neutral
    float d = (pat - 0.5) * 2.0;

    float dx = (X_Displacement / 100.0) * d;
    float dy = (Y_Displacement / 100.0) * d;

    // ---- FROST ----
    vec2 frostJitter = vec2(0.0);

    if (Frostiness > 0.0 && Frost_Scale > 0.0) {
        // Calculate frequency based on scale setting
        float frostFreq = 100.0 / max(Frost_Scale, 0.01);
        vec2 fuv = uv * frostFreq;
        
        // Generate independent noise for X and Y for a multi-directional scatter
        float nx = frostNoise(fuv);
        float ny = frostNoise(fuv + vec2(12.9898, 78.233)); // Offset Y sample
        
        // Map noise from [0, 1] to [-1, 1] bounds
        vec2 scatter = vec2(nx, ny) * 2.0 - 1.0;
        
        // Apply Intensity (0.05 is the max scatter distance in UV space)
        frostJitter = scatter * (Frostiness / 100.0) * 0.05; 
    }

    // ---- Final UV ----
    vec2 dUV = uv + vec2(dx, dy) + frostJitter;
    dUV = clamp(dUV, vec2(0.0), vec2(1.0)); // Prevent sampling out of bounds

    // ---- Blur ----
    float bAmt = Bluriness / 100.0 * 0.04;
    vec4 col = doBlur(tDiffuse, dUV, bAmt, Blur_Samples);

    // ---- Show Pattern Debug ----
    if (Show_Pattern > 0.5) {
        col = mix(col, vec4(vec3(pat), 1.0), 0.3);
    }

    gl_FragColor = col;
}
