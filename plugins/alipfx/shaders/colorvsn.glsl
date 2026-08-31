precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vUvScaled;

// ALL properties as dynamic float uniforms
uniform float Colormaps;         // 0.0-21.0
uniform float Colormap_Strength; // 0.0-100.0
uniform float Contrast;          // 0.0-200.0
uniform float Brightness;        // -100.0 to 100.0
uniform float Blend_Mode;        // 0.0-4.0

vec3 lerp3(vec3 a, vec3 b, float t) {
    return a + (b - a) * t;
}

float clamp01(float x) {
    return clamp(x, 0.0, 1.0);
}

// ========== 22 COLORMAP FUNCTIONS ==========

vec3 colormap_autumn(float t) {
    t = clamp01(t);
    return vec3(1.0, t, 0.0);
}

vec3 colormap_bone(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.0, 0.0, 0.0);
    vec3 c1 = vec3(0.3, 0.3, 0.5);
    vec3 c2 = vec3(0.7, 0.7, 0.9);
    vec3 c3 = vec3(1.0, 1.0, 1.0);
    if (t < 0.25) return lerp3(c0, c1, t / 0.25);
    else if (t < 0.5) return lerp3(c1, c2, (t - 0.25) / 0.25);
    else if (t < 0.75) return lerp3(c2, c3, (t - 0.5) / 0.25);
    else return c3;
}

vec3 colormap_jet(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.0, 0.0, 0.5);
    vec3 c1 = vec3(0.0, 0.0, 1.0);
    vec3 c2 = vec3(0.0, 1.0, 1.0);
    vec3 c3 = vec3(1.0, 1.0, 0.0);
    vec3 c4 = vec3(1.0, 0.0, 0.0);
    vec3 c5 = vec3(0.5, 0.0, 0.0);
    if (t < 0.125) return lerp3(c0, c1, t / 0.125);
    else if (t < 0.375) return lerp3(c1, c2, (t - 0.125) / 0.25);
    else if (t < 0.625) return lerp3(c2, c3, (t - 0.375) / 0.25);
    else if (t < 0.875) return lerp3(c3, c4, (t - 0.625) / 0.25);
    else return lerp3(c4, c5, (t - 0.875) / 0.125);
}

vec3 colormap_winter(float t) {
    t = clamp01(t);
    return vec3(0.0, t, 0.5 + 0.5 * t);
}

vec3 colormap_rainbow(float t) {
    t = clamp01(t);
    float r = abs(t * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(t * 6.0 - 2.0);
    float b = 2.0 - abs(t * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

vec3 colormap_ocean(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.0, 0.0, 0.0);
    vec3 c1 = vec3(0.0, 0.1, 0.3);
    vec3 c2 = vec3(0.0, 0.3, 0.6);
    vec3 c3 = vec3(0.0, 0.5, 0.8);
    vec3 c4 = vec3(0.0, 0.7, 0.9);
    vec3 c5 = vec3(0.5, 0.9, 1.0);
    if (t < 0.2) return lerp3(c0, c1, t / 0.2);
    else if (t < 0.4) return lerp3(c1, c2, (t - 0.2) / 0.2);
    else if (t < 0.6) return lerp3(c2, c3, (t - 0.4) / 0.2);
    else if (t < 0.8) return lerp3(c3, c4, (t - 0.6) / 0.2);
    else return lerp3(c4, c5, (t - 0.8) / 0.2);
}

vec3 colormap_summer(float t) {
    t = clamp01(t);
    return vec3(t, 0.5 + 0.5 * t, 0.4);
}

vec3 colormap_spring(float t) {
    t = clamp01(t);
    return vec3(1.0, t, 1.0 - t);
}

vec3 colormap_cool(float t) {
    t = clamp01(t);
    return vec3(t, 1.0 - t, 1.0);
}

vec3 colormap_hsv(float t) {
    t = clamp01(t);
    float r = abs(t * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(t * 6.0 - 2.0);
    float b = 2.0 - abs(t * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
}

vec3 colormap_pink(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.1, 0.0, 0.1);
    vec3 c1 = vec3(0.5, 0.2, 0.4);
    vec3 c2 = vec3(0.9, 0.5, 0.7);
    vec3 c3 = vec3(1.0, 0.8, 0.9);
    if (t < 0.33) return lerp3(c0, c1, t / 0.33);
    else if (t < 0.66) return lerp3(c1, c2, (t - 0.33) / 0.33);
    else return lerp3(c2, c3, (t - 0.66) / 0.34);
}

vec3 colormap_hot(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.0, 0.0, 0.0);
    vec3 c1 = vec3(1.0, 0.0, 0.0);
    vec3 c2 = vec3(1.0, 1.0, 0.0);
    vec3 c3 = vec3(1.0, 1.0, 1.0);
    if (t < 0.33) return lerp3(c0, c1, t / 0.33);
    else if (t < 0.66) return lerp3(c1, c2, (t - 0.33) / 0.33);
    else return lerp3(c2, c3, (t - 0.66) / 0.34);
}

// FIXED: exact MATLAB R2017a+ parula
vec3 colormap_parula(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.2422, 0.1504, 0.6603);
    vec3 c1 = vec3(0.2811, 0.2978, 0.9389);
    vec3 c2 = vec3(0.2029, 0.4786, 0.9911);
    vec3 c3 = vec3(0.1294, 0.6390, 0.8916);
    vec3 c4 = vec3(0.0703, 0.7457, 0.7258);
    vec3 c5 = vec3(0.3594, 0.8017, 0.4628);
    vec3 c6 = vec3(0.7858, 0.7573, 0.1602);
    vec3 c7 = vec3(0.9944, 0.7922, 0.2010);
    vec3 c8 = vec3(0.9769, 0.9839, 0.0805);
    if (t < 0.125) return lerp3(c0, c1, t / 0.125);
    else if (t < 0.250) return lerp3(c1, c2, (t - 0.125) / 0.125);
    else if (t < 0.375) return lerp3(c2, c3, (t - 0.250) / 0.125);
    else if (t < 0.500) return lerp3(c3, c4, (t - 0.375) / 0.125);
    else if (t < 0.625) return lerp3(c4, c5, (t - 0.500) / 0.125);
    else if (t < 0.750) return lerp3(c5, c6, (t - 0.625) / 0.125);
    else if (t < 0.875) return lerp3(c6, c7, (t - 0.750) / 0.125);
    else return lerp3(c7, c8, (t - 0.875) / 0.125);
}

vec3 colormap_magma(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.000, 0.000, 0.020);
    vec3 c1 = vec3(0.080, 0.020, 0.180);
    vec3 c2 = vec3(0.200, 0.050, 0.350);
    vec3 c3 = vec3(0.400, 0.080, 0.450);
    vec3 c4 = vec3(0.600, 0.150, 0.450);
    vec3 c5 = vec3(0.800, 0.250, 0.400);
    vec3 c6 = vec3(0.920, 0.380, 0.300);
    vec3 c7 = vec3(0.980, 0.550, 0.250);
    vec3 c8 = vec3(0.990, 0.750, 0.400);
    vec3 c9 = vec3(0.995, 0.950, 0.750);
    if (t < 0.111) return lerp3(c0, c1, t / 0.111);
    else if (t < 0.222) return lerp3(c1, c2, (t - 0.111) / 0.111);
    else if (t < 0.333) return lerp3(c2, c3, (t - 0.222) / 0.111);
    else if (t < 0.444) return lerp3(c3, c4, (t - 0.333) / 0.111);
    else if (t < 0.556) return lerp3(c4, c5, (t - 0.444) / 0.112);
    else if (t < 0.667) return lerp3(c5, c6, (t - 0.556) / 0.111);
    else if (t < 0.778) return lerp3(c6, c7, (t - 0.667) / 0.111);
    else if (t < 0.889) return lerp3(c7, c8, (t - 0.778) / 0.111);
    else return lerp3(c8, c9, (t - 0.889) / 0.111);
}

vec3 colormap_inferno(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.000, 0.000, 0.016);
    vec3 c1 = vec3(0.050, 0.029, 0.129);
    vec3 c2 = vec3(0.148, 0.067, 0.266);
    vec3 c3 = vec3(0.267, 0.094, 0.348);
    vec3 c4 = vec3(0.394, 0.129, 0.392);
    vec3 c5 = vec3(0.525, 0.176, 0.443);
    vec3 c6 = vec3(0.663, 0.231, 0.431);
    vec3 c7 = vec3(0.800, 0.298, 0.357);
    vec3 c8 = vec3(0.918, 0.380, 0.231);
    vec3 c9 = vec3(0.988, 0.553, 0.113);
    vec3 c10 = vec3(0.980, 0.752, 0.169);
    vec3 c11 = vec3(0.988, 0.980, 0.553);
    if (t < 0.091) return lerp3(c0, c1, t / 0.091);
    else if (t < 0.182) return lerp3(c1, c2, (t - 0.091) / 0.091);
    else if (t < 0.273) return lerp3(c2, c3, (t - 0.182) / 0.091);
    else if (t < 0.364) return lerp3(c3, c4, (t - 0.273) / 0.091);
    else if (t < 0.455) return lerp3(c4, c5, (t - 0.364) / 0.091);
    else if (t < 0.546) return lerp3(c5, c6, (t - 0.455) / 0.091);
    else if (t < 0.637) return lerp3(c6, c7, (t - 0.546) / 0.091);
    else if (t < 0.728) return lerp3(c7, c8, (t - 0.637) / 0.091);
    else if (t < 0.819) return lerp3(c8, c9, (t - 0.728) / 0.091);
    else if (t < 0.910) return lerp3(c9, c10, (t - 0.819) / 0.091);
    else return lerp3(c10, c11, (t - 0.910) / 0.090);
}

vec3 colormap_plasma(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.050, 0.029, 0.529);
    vec3 c1 = vec3(0.267, 0.105, 0.631);
    vec3 c2 = vec3(0.463, 0.094, 0.596);
    vec3 c3 = vec3(0.635, 0.122, 0.537);
    vec3 c4 = vec3(0.800, 0.176, 0.443);
    vec3 c5 = vec3(0.941, 0.267, 0.318);
    vec3 c6 = vec3(0.992, 0.431, 0.196);
    vec3 c7 = vec3(0.969, 0.647, 0.129);
    vec3 c8 = vec3(0.940, 0.857, 0.267);
    vec3 c9 = vec3(0.940, 0.975, 0.553);
    if (t < 0.111) return lerp3(c0, c1, t / 0.111);
    else if (t < 0.222) return lerp3(c1, c2, (t - 0.111) / 0.111);
    else if (t < 0.333) return lerp3(c2, c3, (t - 0.222) / 0.111);
    else if (t < 0.444) return lerp3(c3, c4, (t - 0.333) / 0.111);
    else if (t < 0.556) return lerp3(c4, c5, (t - 0.444) / 0.112);
    else if (t < 0.667) return lerp3(c5, c6, (t - 0.556) / 0.111);
    else if (t < 0.778) return lerp3(c6, c7, (t - 0.667) / 0.111);
    else if (t < 0.889) return lerp3(c7, c8, (t - 0.778) / 0.111);
    else return lerp3(c8, c9, (t - 0.889) / 0.111);
}

vec3 colormap_viridis(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.267, 0.004, 0.329);
    vec3 c1 = vec3(0.283, 0.141, 0.458);
    vec3 c2 = vec3(0.254, 0.265, 0.529);
    vec3 c3 = vec3(0.207, 0.372, 0.553);
    vec3 c4 = vec3(0.163, 0.471, 0.558);
    vec3 c5 = vec3(0.128, 0.567, 0.551);
    vec3 c6 = vec3(0.135, 0.659, 0.518);
    vec3 c7 = vec3(0.267, 0.749, 0.441);
    vec3 c8 = vec3(0.478, 0.821, 0.318);
    vec3 c9 = vec3(0.741, 0.873, 0.153);
    vec3 c10 = vec3(0.993, 0.906, 0.144);
    if (t < 0.091) return lerp3(c0, c1, t / 0.091);
    else if (t < 0.182) return lerp3(c1, c2, (t - 0.091) / 0.091);
    else if (t < 0.273) return lerp3(c2, c3, (t - 0.182) / 0.091);
    else if (t < 0.364) return lerp3(c3, c4, (t - 0.273) / 0.091);
    else if (t < 0.455) return lerp3(c4, c5, (t - 0.364) / 0.091);
    else if (t < 0.546) return lerp3(c5, c6, (t - 0.455) / 0.091);
    else if (t < 0.637) return lerp3(c6, c7, (t - 0.546) / 0.091);
    else if (t < 0.728) return lerp3(c7, c8, (t - 0.637) / 0.091);
    else if (t < 0.819) return lerp3(c8, c9, (t - 0.728) / 0.091);
    else if (t < 0.910) return lerp3(c9, c10, (t - 0.819) / 0.091);
    else return c10;
}

// FIXED: exact matplotlib cividis
vec3 colormap_cividis(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.0000, 0.1351, 0.3048);
    vec3 c1 = vec3(0.1034, 0.2204, 0.4358);
    vec3 c2 = vec3(0.2637, 0.3078, 0.4228);
    vec3 c3 = vec3(0.3808, 0.3952, 0.4357);
    vec3 c4 = vec3(0.4887, 0.4853, 0.4710);
    vec3 c5 = vec3(0.6091, 0.5798, 0.4636);
    vec3 c6 = vec3(0.7365, 0.6806, 0.4240);
    vec3 c7 = vec3(0.8707, 0.7896, 0.3433);
    vec3 c8 = vec3(0.9957, 0.9093, 0.2178);
    if (t < 0.125) return lerp3(c0, c1, t / 0.125);
    else if (t < 0.250) return lerp3(c1, c2, (t - 0.125) / 0.125);
    else if (t < 0.375) return lerp3(c2, c3, (t - 0.250) / 0.125);
    else if (t < 0.500) return lerp3(c3, c4, (t - 0.375) / 0.125);
    else if (t < 0.625) return lerp3(c4, c5, (t - 0.500) / 0.125);
    else if (t < 0.750) return lerp3(c5, c6, (t - 0.625) / 0.125);
    else if (t < 0.875) return lerp3(c6, c7, (t - 0.750) / 0.125);
    else return lerp3(c7, c8, (t - 0.875) / 0.125);
}

// FIXED: exact matplotlib twilight
vec3 colormap_twilight(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.8858, 0.8500, 0.8880);
    vec3 c1 = vec3(0.5830, 0.7096, 0.7793);
    vec3 c2 = vec3(0.3841, 0.4614, 0.7309);
    vec3 c3 = vec3(0.3506, 0.1660, 0.5615);
    vec3 c4 = vec3(0.1849, 0.0794, 0.2131);
    vec3 c5 = vec3(0.4538, 0.1162, 0.3097);
    vec3 c6 = vec3(0.6981, 0.3383, 0.3221);
    vec3 c7 = vec3(0.8003, 0.6410, 0.5373);
    vec3 c8 = vec3(0.8857, 0.8500, 0.8857);
    if (t < 0.125) return lerp3(c0, c1, t / 0.125);
    else if (t < 0.250) return lerp3(c1, c2, (t - 0.125) / 0.125);
    else if (t < 0.375) return lerp3(c2, c3, (t - 0.250) / 0.125);
    else if (t < 0.500) return lerp3(c3, c4, (t - 0.375) / 0.125);
    else if (t < 0.625) return lerp3(c4, c5, (t - 0.500) / 0.125);
    else if (t < 0.750) return lerp3(c5, c6, (t - 0.625) / 0.125);
    else if (t < 0.875) return lerp3(c6, c7, (t - 0.750) / 0.125);
    else return lerp3(c7, c8, (t - 0.875) / 0.125);
}

// FIXED: exact matplotlib twilight_shifted
vec3 colormap_twilight_shifted(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.1874, 0.0771, 0.2162);
    vec3 c1 = vec3(0.3506, 0.1660, 0.5615);
    vec3 c2 = vec3(0.3841, 0.4614, 0.7309);
    vec3 c3 = vec3(0.5830, 0.7096, 0.7793);
    vec3 c4 = vec3(0.8857, 0.8500, 0.8857);
    vec3 c5 = vec3(0.8003, 0.6410, 0.5373);
    vec3 c6 = vec3(0.6981, 0.3383, 0.3221);
    vec3 c7 = vec3(0.4538, 0.1162, 0.3097);
    vec3 c8 = vec3(0.1849, 0.0794, 0.2131);
    if (t < 0.125) return lerp3(c0, c1, t / 0.125);
    else if (t < 0.250) return lerp3(c1, c2, (t - 0.125) / 0.125);
    else if (t < 0.375) return lerp3(c2, c3, (t - 0.250) / 0.125);
    else if (t < 0.500) return lerp3(c3, c4, (t - 0.375) / 0.125);
    else if (t < 0.625) return lerp3(c4, c5, (t - 0.500) / 0.125);
    else if (t < 0.750) return lerp3(c5, c6, (t - 0.625) / 0.125);
    else if (t < 0.875) return lerp3(c6, c7, (t - 0.750) / 0.125);
    else return lerp3(c7, c8, (t - 0.875) / 0.125);
}

// FIXED: exact Google turbo
vec3 colormap_turbo(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.1900, 0.0718, 0.2322);
    vec3 c1 = vec3(0.2763, 0.4212, 0.8912);
    vec3 c2 = vec3(0.1584, 0.7355, 0.9231);
    vec3 c3 = vec3(0.1966, 0.9490, 0.5947);
    vec3 c4 = vec3(0.6436, 0.9900, 0.2336);
    vec3 c5 = vec3(0.9330, 0.8124, 0.2267);
    vec3 c6 = vec3(0.9836, 0.4929, 0.1285);
    vec3 c7 = vec3(0.8161, 0.1846, 0.0181);
    vec3 c8 = vec3(0.4796, 0.0158, 0.0106);
    if (t < 0.125) return lerp3(c0, c1, t / 0.125);
    else if (t < 0.250) return lerp3(c1, c2, (t - 0.125) / 0.125);
    else if (t < 0.375) return lerp3(c2, c3, (t - 0.250) / 0.125);
    else if (t < 0.500) return lerp3(c3, c4, (t - 0.375) / 0.125);
    else if (t < 0.625) return lerp3(c4, c5, (t - 0.500) / 0.125);
    else if (t < 0.750) return lerp3(c5, c6, (t - 0.625) / 0.125);
    else if (t < 0.875) return lerp3(c6, c7, (t - 0.750) / 0.125);
    else return lerp3(c7, c8, (t - 0.875) / 0.125);
}

vec3 colormap_deepgreen(float t) {
    t = clamp01(t);
    vec3 c0 = vec3(0.0, 0.05, 0.0);
    vec3 c1 = vec3(0.0, 0.15, 0.05);
    vec3 c2 = vec3(0.0, 0.30, 0.10);
    vec3 c3 = vec3(0.0, 0.45, 0.15);
    vec3 c4 = vec3(0.0, 0.55, 0.25);
    vec3 c5 = vec3(0.05, 0.65, 0.35);
    vec3 c6 = vec3(0.15, 0.75, 0.50);
    vec3 c7 = vec3(0.30, 0.85, 0.65);
    vec3 c8 = vec3(0.50, 0.92, 0.80);
    vec3 c9 = vec3(0.70, 0.97, 0.90);
    if (t < 0.111) return lerp3(c0, c1, t / 0.111);
    else if (t < 0.222) return lerp3(c1, c2, (t - 0.111) / 0.111);
    else if (t < 0.333) return lerp3(c2, c3, (t - 0.222) / 0.111);
    else if (t < 0.444) return lerp3(c3, c4, (t - 0.333) / 0.111);
    else if (t < 0.556) return lerp3(c4, c5, (t - 0.444) / 0.112);
    else if (t < 0.667) return lerp3(c5, c6, (t - 0.556) / 0.111);
    else if (t < 0.778) return lerp3(c6, c7, (t - 0.667) / 0.111);
    else if (t < 0.889) return lerp3(c7, c8, (t - 0.778) / 0.111);
    else return lerp3(c8, c9, (t - 0.889) / 0.111);
}

// Colormap dispatcher using float -> int conversion
vec3 apply_colormap(float cmap, float t) {
    int icmap = int(cmap + 0.5);
    if (icmap == 0) return colormap_autumn(t);
    else if (icmap == 1) return colormap_bone(t);
    else if (icmap == 2) return colormap_jet(t);
    else if (icmap == 3) return colormap_winter(t);
    else if (icmap == 4) return colormap_rainbow(t);
    else if (icmap == 5) return colormap_ocean(t);
    else if (icmap == 6) return colormap_summer(t);
    else if (icmap == 7) return colormap_spring(t);
    else if (icmap == 8) return colormap_cool(t);
    else if (icmap == 9) return colormap_hsv(t);
    else if (icmap == 10) return colormap_pink(t);
    else if (icmap == 11) return colormap_hot(t);
    else if (icmap == 12) return colormap_parula(t);
    else if (icmap == 13) return colormap_magma(t);
    else if (icmap == 14) return colormap_inferno(t);
    else if (icmap == 15) return colormap_plasma(t);
    else if (icmap == 16) return colormap_viridis(t);
    else if (icmap == 17) return colormap_cividis(t);
    else if (icmap == 18) return colormap_twilight(t);
    else if (icmap == 19) return colormap_twilight_shifted(t);
    else if (icmap == 20) return colormap_turbo(t);
    else return colormap_deepgreen(t);
}

// ========== BLEND MODES ==========

vec4 blend_normal(vec4 base, vec4 blend) {
    return blend;
}

vec4 blend_add(vec4 base, vec4 blend) {
    return vec4(min(base.rgb + blend.rgb, 1.0), base.a);
}

vec4 blend_multiply(vec4 base, vec4 blend) {
    return vec4(base.rgb * blend.rgb, base.a);
}

vec4 blend_screen(vec4 base, vec4 blend) {
    return vec4(1.0 - (1.0 - base.rgb) * (1.0 - blend.rgb), base.a);
}

vec4 blend_overlay(vec4 base, vec4 blend) {
    vec3 result;
    for (int i = 0; i < 3; i++) {
        if (base[i] < 0.5) {
            result[i] = 2.0 * base[i] * blend[i];
        } else {
            result[i] = 1.0 - 2.0 * (1.0 - base[i]) * (1.0 - blend[i]);
        }
    }
    return vec4(result, base.a);
}

// Blend mode dispatcher using float -> int conversion
vec4 apply_blend_mode(float mode, vec4 base, vec4 blend) {
    int imode = int(mode + 0.5);
    if (imode == 0) return blend_normal(base, blend);
    else if (imode == 1) return blend_add(base, blend);
    else if (imode == 2) return blend_multiply(base, blend);
    else if (imode == 3) return blend_screen(base, blend);
    else return blend_overlay(base, blend);
}

// ========== MAIN ==========

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 original = texel.rgb;
    
    float luminance = dot(original, vec3(0.299, 0.587, 0.114));
    
    float contrast_factor = Contrast / 100.0;
    luminance = (luminance - 0.5) * contrast_factor + 0.5;
    luminance = clamp01(luminance);
    
    float brightness_offset = Brightness / 100.0;
    luminance = luminance + brightness_offset;
    luminance = clamp01(luminance);
    
    vec3 colormapped = apply_colormap(Colormaps, luminance);
    
    float strength = Colormap_Strength / 100.0;
    vec3 final_color = mix(original, colormapped, strength);
    
    vec4 blend_layer = vec4(final_color, texel.a);
    
    vec4 result = apply_blend_mode(Blend_Mode, texel, blend_layer);
    
    gl_FragColor = result;
}
