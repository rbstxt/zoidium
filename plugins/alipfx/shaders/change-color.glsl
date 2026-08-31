precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

/*
Panzoid custom properties required:

1. View                     -> Number (dynamic)
2. Hue Transform            -> Number (dynamic)
3. Saturation Transform     -> Number (dynamic)
4. Lightness Transform      -> Number (dynamic)
5. Color To Change          -> Color
6. Matching Tolerance       -> Number (dynamic)
7. Matching Softness        -> Number (dynamic)
8. Match Colors             -> Number (dynamic)
9. Invert Color Correction  -> Number (dynamic)

Panzoid converts spaces to underscores in GLSL:
View -> View
Hue Transform -> Hue_Transform
Saturation Transform -> Saturation_Transform
Lightness Transform -> Lightness_Transform
Color To Change -> Color_To_Change
Matching Tolerance -> Matching_Tolerance
Matching Softness -> Matching_Softness
Match Colors -> Match_Colors
Invert Color Correction -> Invert_Color_Correction
*/

uniform float View;
uniform float Hue_Transform;
uniform float Saturation_Transform;
uniform float Lightness_Transform;
uniform vec3  Color_To_Change;
uniform float Matching_Tolerance;
uniform float Matching_Softness;
uniform float Match_Colors;
uniform float Invert_Color_Correction;

const float PI  = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;
const float EPS = 1e-6;

// --------------------------------------------------
// Utility
// --------------------------------------------------

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

float hueDist(float a, float b) {
    float d = abs(a - b);
    return min(d, 1.0 - d); // 0..0.5
}

// --------------------------------------------------
// RGB <-> HSL
// --------------------------------------------------

vec3 rgb2hsl(vec3 c) {
    float maxc = max(c.r, max(c.g, c.b));
    float minc = min(c.r, min(c.g, c.b));
    float delta = maxc - minc;

    float h = 0.0;
    float s = 0.0;
    float l = 0.5 * (maxc + minc);

    if (delta > EPS) {
        s = delta / (1.0 - abs(2.0 * l - 1.0));

        if (maxc == c.r) {
            h = mod((c.g - c.b) / delta, 6.0);
        } else if (maxc == c.g) {
            h = ((c.b - c.r) / delta) + 2.0;
        } else {
            h = ((c.r - c.g) / delta) + 4.0;
        }

        h /= 6.0;
        if (h < 0.0) h += 1.0;
    }

    return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}

vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;

    if (s <= EPS) {
        return vec3(l);
    }

    float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
    float p = 2.0 * l - q;

    return vec3(
        hue2rgb(p, q, h + 1.0/3.0),
        hue2rgb(p, q, h),
        hue2rgb(p, q, h - 1.0/3.0)
    );
}

// --------------------------------------------------
// Matching spaces
// --------------------------------------------------

// Chroma vector in polar hue/saturation space.
// This ignores lightness and keeps hue+sat only.
vec2 chromaVec(vec3 rgb) {
    vec3 hsl = rgb2hsl(rgb);
    float a = hsl.x * TAU;
    return vec2(cos(a), sin(a)) * hsl.y;
}

// RGB match: precise RGB triplet comparison.
float rgbDistance01(vec3 a, vec3 b) {
    // normalized to approximately 0..1
    return length(a - b) / 1.73205080757;
}

// Hue-only match: compare hue, reduce false hits on near-gray pixels.
float hueDistance01(vec3 a, vec3 b) {
    vec3 ahsl = rgb2hsl(a);
    vec3 bhsl = rgb2hsl(b);

    // If source/target is nearly grayscale, hue is weakly defined.
    float d = hueDist(ahsl.x, bhsl.x) * 2.0; // 0..1
    float satGate = max(ahsl.y, bhsl.y);
    // For very low saturation, make match weaker / less aggressive.
    d = mix(1.0, d, smoothstep(0.02, 0.10, satGate));
    return d;
}

// Chroma match: compare hue+saturation, ignore lightness.
float chromaDistance01(vec3 a, vec3 b) {
    vec2 ca = chromaVec(a);
    vec2 cb = chromaVec(b);
    return length(ca - cb) * 0.5; // roughly normalize to 0..1
}

// --------------------------------------------------
// AE-like soft mask
// --------------------------------------------------

float selectionMask(vec3 src, vec3 target, float mode, float tolPct, float softPct) {
    float d;

    if (mode < 0.5) {
        // 0 = Using RGB
        d = rgbDistance01(src, target);
    } else if (mode < 1.5) {
        // 1 = Using Hue
        d = hueDistance01(src, target);
    } else {
        // 2 = Using Chroma
        d = chromaDistance01(src, target);
    }

    float tol  = clamp(tolPct  / 100.0, 0.0, 1.0);
    float soft = clamp(softPct / 100.0, 0.0, 1.0);

    // AE-like idea:
    // - tolerance defines the fully selected core
    // - softness feathers outward from the tolerance edge
    float edge0 = tol;
    float edge1 = min(1.0, tol + max(soft, 0.00001));

    float m;
    if (soft <= 0.00001) {
        m = (d <= tol) ? 1.0 : 0.0;
    } else {
        m = 1.0 - smoothstep(edge0, edge1, d);
    }

    return saturate(m);
}

// --------------------------------------------------
// Color transform
// --------------------------------------------------

// This version is tuned to feel like AE's Change Color UI/screenshots:
// - Hue Transform: degrees, additive
// - Saturation Transform: signed percentage, additive in HSL saturation
// - Lightness Transform: signed percentage, additive in HSL lightness
//
// Neutral values:
// - Hue Transform = 0
// - Saturation Transform = 0
// - Lightness Transform = 0
vec3 applyChangeColor(vec3 rgb) {
    vec3 hsl = rgb2hsl(rgb);

    hsl.x = fract(hsl.x + Hue_Transform / 360.0);
    hsl.y = clamp(hsl.y + Saturation_Transform / 100.0, 0.0, 1.0);
    hsl.z = clamp(hsl.z + Lightness_Transform / 100.0, 0.0, 1.0);

    return hsl2rgb(hsl);
}

// --------------------------------------------------
// Main
// --------------------------------------------------

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 src = texel.rgb;

    float mask = selectionMask(
        src,
        Color_To_Change,
        Match_Colors,
        Matching_Tolerance,
        Matching_Softness
    );

    if (Invert_Color_Correction >= 0.5) {
        mask = 1.0 - mask;
    }

    vec3 changed = applyChangeColor(src);
    vec3 result  = mix(src, changed, mask);

    // View:
    // 0 = Corrected Layer (final processed result)
    // 1 = Color Correction Mask (diagnostic matte)
    if (View < 0.5) {
        gl_FragColor = vec4(result, texel.a);
    } else {
        gl_FragColor = vec4(vec3(mask), texel.a);
    }
}
