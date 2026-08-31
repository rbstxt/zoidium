precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom Properties mapped from Panzoid UI
uniform vec3 Color_1; uniform vec3 Color_2; uniform vec3 Color_3; uniform vec3 Color_4;
uniform vec3 Color_5; uniform vec3 Color_6; uniform vec3 Color_7; uniform vec3 Color_8;
uniform float Gradient_Colors;
uniform float Preset;
uniform float Interpolation;
uniform float Invert;
uniform float Repeats;

#define PI 3.14159265359

// --- Color Space Conversion Functions ---

// HSV
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// LAB & XYZ (D65 Illuminant)
vec3 rgb2xyz(vec3 rgb) {
    rgb = mix(rgb / 12.92, pow((rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, rgb));
    return vec3(
        rgb.r * 0.4124 + rgb.g * 0.3576 + rgb.b * 0.1805,
        rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722,
        rgb.r * 0.0193 + rgb.g * 0.1192 + rgb.b * 0.9505
    );
}
vec3 xyz2lab(vec3 xyz) {
    vec3 n = xyz / vec3(0.95047, 1.0, 1.08883);
    vec3 v = mix(vec3(7.787) * n + vec3(16.0 / 116.0), pow(n, vec3(1.0 / 3.0)), step(vec3(0.008856), n));
    return vec3(116.0 * v.y - 16.0, 500.0 * (v.x - v.y), 200.0 * (v.y - v.z));
}
vec3 lab2xyz(vec3 lab) {
    float y = (lab.x + 16.0) / 116.0;
    float x = lab.y / 500.0 + y;
    float z = y - lab.z / 200.0;
    vec3 v = vec3(x, y, z);
    vec3 v3 = v * v * v;
    vec3 n = mix((v - vec3(16.0 / 116.0)) / 7.787, v3, step(vec3(0.206893), v));
    return n * vec3(0.95047, 1.0, 1.08883);
}
vec3 xyz2rgb(vec3 xyz) {
    vec3 rgb = vec3(
        xyz.x * 3.2406 + xyz.y * -1.5372 + xyz.z * -0.4986,
        xyz.x * -0.9689 + xyz.y * 1.8758 + xyz.z * 0.0415,
        xyz.x * 0.0557 + xyz.y * -0.2040 + xyz.z * 1.0570
    );
    return mix(12.92 * rgb, 1.055 * pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, rgb));
}
vec3 rgb2lab(vec3 c) { return xyz2lab(rgb2xyz(c)); }
vec3 lab2rgb(vec3 c) { return xyz2rgb(lab2xyz(c)); }

// HCL (derived from LAB)
vec3 lab2hcl(vec3 lab) {
    return vec3(atan(lab.z, lab.y), length(lab.yz), lab.x);
}
vec3 hcl2lab(vec3 hcl) {
    return vec3(hcl.z, hcl.y * cos(hcl.x), hcl.y * sin(hcl.x));
}

// --- Presets Data ---

int getPresetColorCount(int p) {
    if(p == 0) return int(clamp(Gradient_Colors, 2.0, 8.0));
    if(p == 1) return 6; if(p == 2) return 2; if(p == 3) return 7;
    if(p == 4) return 5; if(p == 5) return 4; if(p == 6) return 4;
    if(p == 7) return 3; if(p == 8) return 5; if(p == 9) return 4;
    if(p == 10) return 7;
    return 2;
}

vec3 getPresetColor(int p, int i) {
    if (p == 0) { // Custom
        if(i == 0) return Color_1; if(i == 1) return Color_2; if(i == 2) return Color_3; if(i == 3) return Color_4;
        if(i == 4) return Color_5; if(i == 5) return Color_6; if(i == 6) return Color_7; return Color_8;
    }
    if (p == 1) { // Vivid
        if(i == 0) return vec3(1.0, 0.0, 0.0); if(i == 1) return vec3(1.0, 1.0, 0.0); if(i == 2) return vec3(0.0, 1.0, 0.0);
        if(i == 3) return vec3(0.0, 1.0, 1.0); if(i == 4) return vec3(0.0, 0.0, 1.0); return vec3(1.0, 0.0, 1.0);
    }
    if (p == 2) { // White to Black
        if(i == 0) return vec3(1.0); return vec3(0.0);
    }
    if (p == 3) { // Rainbow
        if(i == 0) return vec3(1.0, 0.0, 0.0); if(i == 1) return vec3(1.0, 0.5, 0.0); if(i == 2) return vec3(1.0, 1.0, 0.0);
        if(i == 3) return vec3(0.0, 1.0, 0.0); if(i == 4) return vec3(0.0, 0.0, 1.0); if(i == 5) return vec3(0.29, 0.0, 0.51); return vec3(0.56, 0.0, 1.0);
    }
    if (p == 4) { // Fire
        if(i == 0) return vec3(0.0); if(i == 1) return vec3(1.0, 0.0, 0.0); if(i == 2) return vec3(1.0, 0.5, 0.0);
        if(i == 3) return vec3(1.0, 1.0, 0.0); return vec3(1.0);
    }
    if (p == 5) { // Blue Fire
        if(i == 0) return vec3(0.0); if(i == 1) return vec3(0.0, 0.0, 0.5); if(i == 2) return vec3(0.0, 0.5, 1.0); return vec3(1.0);
    }
    if (p == 6) { // Smoke
        if(i == 0) return vec3(0.1); if(i == 1) return vec3(0.3); if(i == 2) return vec3(0.6); return vec3(0.8);
    }
    if (p == 7) { // Wood Rings
        if(i == 0) return vec3(0.3, 0.15, 0.05); if(i == 1) return vec3(0.6, 0.4, 0.2); return vec3(0.8, 0.6, 0.3);
    }
    if (p == 8) { // Electric
        if(i == 0) return vec3(0.0); if(i == 1) return vec3(0.5, 0.0, 1.0); if(i == 2) return vec3(0.0, 0.5, 1.0);
        if(i == 3) return vec3(0.0, 1.0, 1.0); return vec3(1.0);
    }
    if (p == 9) { // Aqualight
        if(i == 0) return vec3(0.0, 0.1, 0.3); if(i == 1) return vec3(0.0, 0.5, 0.6); if(i == 2) return vec3(0.5, 0.9, 0.9); return vec3(1.0);
    }
    if (p == 10) { // Heat Map
        if(i == 0) return vec3(0.0); if(i == 1) return vec3(0.0, 0.0, 1.0); if(i == 2) return vec3(0.0, 1.0, 1.0);
        if(i == 3) return vec3(0.0, 1.0, 0.0); if(i == 4) return vec3(1.0, 1.0, 0.0); if(i == 5) return vec3(1.0, 0.0, 0.0); return vec3(1.0);
    }
    return vec3(0.0);
}

// --- Interpolation Logic ---

vec3 interpolateColors(vec3 c1, vec3 c2, float t, int mode) {
    if (mode == 4) { // Step
        return t < 0.5 ? c1 : c2;
    }
    if (mode == 3) { // RGB
        return mix(c1, c2, t);
    }
    if (mode == 2) { // HSV
        vec3 hsv1 = rgb2hsv(c1);
        vec3 hsv2 = rgb2hsv(c2);
        float dh = hsv2.x - hsv1.x;
        if (dh > 0.5) hsv2.x -= 1.0;
        else if (dh < -0.5) hsv2.x += 1.0;
        vec3 hsv = mix(hsv1, hsv2, t);
        hsv.x = fract(hsv.x);
        return hsv2rgb(hsv);
    }
    if (mode == 1) { // LAB
        return lab2rgb(mix(rgb2lab(c1), rgb2lab(c2), t));
    }
    // Mode 0: HCL (Default)
    vec3 hcl1 = lab2hcl(rgb2lab(c1));
    vec3 hcl2 = lab2hcl(rgb2lab(c2));
    float dh = hcl2.x - hcl1.x;
    if (dh > PI) hcl2.x -= 2.0 * PI;
    else if (dh < -PI) hcl2.x += 2.0 * PI;
    vec3 hcl = mix(hcl1, hcl2, t);
    return lab2rgb(hcl2lab(hcl));
}

// --- Main Program ---

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    // 1. Calculate Base Luma
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    
    // 2. Apply Invert
    float t = Invert > 0.5 ? 1.0 - luma : luma;
    
    // 3. Apply Repeats
    float reps = max(1.0, Repeats);
    t = fract(t * reps);
    
    // 4. Setup Gradient Logic
    int p = int(Preset + 0.5);
    int interp = int(Interpolation + 0.5);
    int colorCount = getPresetColorCount(p);
    
    // 5. Calculate Color Stops
    float scaledT = t * float(colorCount - 1);
    int idx = int(floor(scaledT));
    float fractT = fract(scaledT);
    
    // Prevent out-of-bounds mapping at t=1.0
    if (idx >= colorCount - 1) {
        idx = colorCount - 2;
        fractT = 1.0;
    }
    
    vec3 colorA = getPresetColor(p, idx);
    vec3 colorB = getPresetColor(p, idx + 1);
    
    // 6. Output Mapped Color
    vec3 finalColor = interpolateColors(colorA, colorB, fractT, interp);
    
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), texel.a);
}
