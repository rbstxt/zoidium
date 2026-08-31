precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Panzoid custom properties (spaces become underscores)
uniform float Shadow_Red_Balance;
uniform float Shadow_Green_Balance;
uniform float Shadow_Blue_Balance;

uniform float Midtone_Red_Balance;
uniform float Midtone_Green_Balance;
uniform float Midtone_Blue_Balance;

uniform float Highlight_Red_Balance;
uniform float Highlight_Green_Balance;
uniform float Highlight_Blue_Balance;

uniform float Preserve_Luminosity;

// ------------------------------------------------------------
// AE-style / Adobe-style practical approximation controls
// ------------------------------------------------------------

// Slider scale:
// AE sliders feel like "amount" values, not full 0..1 channel writes.
// If you want the effect stronger/weaker globally, only change this.
const float RANGE_SCALE = 0.50;

// Luma weights for perceptual brightness preservation.
// 0.30 / 0.59 / 0.11 is a classic Adobe/Photoshop-style choice.
const vec3 LUMA = vec3(0.30, 0.59, 0.11);

float lum(vec3 c) {
    return dot(c, LUMA);
}

// ------------------------------------------------------------
// Photoshop/Adobe-style luminance preservation helpers
// These preserve perceived brightness while keeping hue shift.
// ------------------------------------------------------------

vec3 clipColor(vec3 c) {
    float l = lum(c);
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);

    if (n < 0.0) {
        float denom = max(l - n, 1e-5);
        c = vec3(l) + ((c - vec3(l)) * l) / denom;
    }

    if (x > 1.0) {
        float denom = max(x - l, 1e-5);
        c = vec3(l) + ((c - vec3(l)) * (1.0 - l)) / denom;
    }

    return clamp(c, 0.0, 1.0);
}

vec3 setLum(vec3 c, float targetLum) {
    float d = targetLum - lum(c);
    c += vec3(d);
    return clipColor(c);
}

// ------------------------------------------------------------
// Tonal masks
// Overlapping masks approximate AE/Adobe-style three-way balance
// without hard splits.
// ------------------------------------------------------------
void getToneWeights(float y, out float shadows, out float midtones, out float highlights) {
    // These values are chosen to create soft overlapping ranges:
    // shadows dominate darks, highlights dominate brights,
    // midtones dominate the middle and overlap naturally.
    const float a = 0.25;
    const float b = 0.333;
    const float s = 0.70;

    shadows =
        clamp((y - b) / (-a) + 0.5, 0.0, 1.0) * s;

    midtones =
        clamp((y - b) / a + 0.5, 0.0, 1.0) *
        clamp((y + b - 1.0) / (-a) + 0.5, 0.0, 1.0) * s;

    highlights =
        clamp((y + b - 1.0) / a + 0.5, 0.0, 1.0) * s;

    // Normalize so the sum remains stable and predictable
    float sumW = shadows + midtones + highlights;
    if (sumW > 1e-5) {
        shadows /= sumW;
        midtones /= sumW;
        highlights /= sumW;
    }
}

// Convert AE-like slider range (-100..100) to RGB delta
vec3 sliderToDelta(vec3 slider) {
    return slider * (RANGE_SCALE / 100.0);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 src = texel.rgb;

    // Luma used to decide whether a pixel is shadow / midtone / highlight
    float y = lum(src);

    float wShadows;
    float wMidtones;
    float wHighlights;
    getToneWeights(y, wShadows, wMidtones, wHighlights);

    // Per-range slider vectors
    vec3 sh = sliderToDelta(vec3(
        Shadow_Red_Balance,
        Shadow_Green_Balance,
        Shadow_Blue_Balance
    ));

    vec3 mi = sliderToDelta(vec3(
        Midtone_Red_Balance,
        Midtone_Green_Balance,
        Midtone_Blue_Balance
    ));

    vec3 hi = sliderToDelta(vec3(
        Highlight_Red_Balance,
        Highlight_Green_Balance,
        Highlight_Blue_Balance
    ));

    // Weighted RGB adjustment
    vec3 delta = sh * wShadows + mi * wMidtones + hi * wHighlights;

    // Apply color balance directly in RGB
    vec3 balanced = src + delta;

    // Clamp before/after preserve-luma path for stability
    balanced = clamp(balanced, 0.0, 1.0);

    // Preserve Luminosity:
    // 0 = disabled
    // 1 = enabled
    if (Preserve_Luminosity > 0.5) {
        balanced = setLum(balanced, lum(src));
    }

    gl_FragColor = vec4(clamp(balanced, 0.0, 1.0), texel.a);
}
