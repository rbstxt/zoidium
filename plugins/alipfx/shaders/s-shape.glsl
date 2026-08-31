precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// ===== Custom Panzoid properties =====
uniform vec2 Center_XY;
uniform float Size;
uniform float Rel_Width;
uniform float Rel_Height;
uniform float Points;
uniform float Pointiness;
uniform float Roundness;
uniform float Swirl;
uniform float Rotate;
uniform float Rotate_Pre_Scale;
uniform float Blur;
uniform float Brightness1;
uniform vec3 Color1;
uniform vec3 Color0;
uniform float Offset0;
uniform float Bg_Brightness;
uniform float Combine;

// =====================================

const float PI = 3.1415926535897932384626433832795;
const float TAU = 6.2831853071795864769252867665590;

mat2 rot2(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

vec3 overlayBlend(vec3 base, vec3 blend) {
    vec3 low  = 2.0 * base * blend;
    vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
    return mix(low, high, step(vec3(0.5), base));
}

// Regular polygon radial boundary (exact for pointiness = 1)
float cross2(vec2 a, vec2 b) {
    return a.x * b.y - a.y * b.x;
}

// Exact regular polygon with circumradius = 1
float regularPolygonRadius(float ang, float n) {
    float sector = TAU / n;
    float a = mod(ang + 0.5 * sector, sector) - 0.5 * sector;
    return cos(PI / n) / max(cos(a), 1e-6);
}

// Exact sharp alternating star polygon
float starPolygonRadius(float ang, float n, float innerR) {
    float m = n * 2.0;
    float stepA = TAU / m;

    float a = mod(ang, TAU);
    if (a < 0.0) a += TAU;

    float k = floor(a / stepA);
    float a0 = k * stepA;
    float a1 = (k + 1.0) * stepA;

    float r0 = (mod(k, 2.0) < 0.5) ? 1.0 : innerR;
    float r1 = (mod(k + 1.0, 2.0) < 0.5) ? 1.0 : innerR;

    vec2 v0 = vec2(cos(a0), sin(a0)) * r0;
    vec2 v1 = vec2(cos(a1), sin(a1)) * r1;

    vec2 d = vec2(cos(a), sin(a));
    vec2 e = v1 - v0;

    float denom = cross2(d, e);
    if (abs(denom) < 1e-6) denom = (denom < 0.0) ? -1e-6 : 1e-6;

    float t = cross2(v0, e) / denom;
    return abs(t);
}

// 0 at outer tip, 1 at inner valley
float tipToValleyPhase(float ang, float n) {
    float sector = TAU / n;
    float a = mod(ang + 0.5 * sector, sector) - 0.5 * sector;
    return abs(a) / (0.5 * sector);
}

// Rounded star profile:
// - keeps tip SHARP
// - rounds the inner valley
// - curves the side inward
float roundedStarRadius(float ang, float n, float innerR, float roundness) {
    float x = tipToValleyPhase(ang, n); // 0 tip, 1 valley

    // curve that preserves a sharp tip but softens the valley
    float k = mix(1.0, 3.2, clamp(roundness, 0.0, 1.0));
    float curved = 1.0 - pow(max(0.0, 1.0 - x), k);

    // extra shaping so it looks closer to Sapphire:
    // keep shoulders a bit straighter near the tip, more curvature near valley
    float shaped = mix(x, curved, roundness);

    return mix(1.0, innerR, shaped);
}

// Main S_Shape radial boundary
float shapeBoundaryRadius(float ang, float n, float pointiness, float roundness) {
    n = max(n, 3.0);
    roundness = clamp(roundness, 0.0, 1.0);

    // -----------------------------------
    // Negative pointiness = flower / lobes
    // -----------------------------------
    if (pointiness < 0.0) {
        float amt = -pointiness;
        float c = cos(n * ang);

        // More organic / floral lobe shaping
        float flowerSharp = sign(c) * pow(abs(c), mix(0.45, 1.0, roundness));
        float r = 1.0 + 0.22 * amt * flowerSharp;
        return max(r, 0.001);
    }

    // -----------------------------------
    // 0..1 = circle -> polygon
    // -----------------------------------
    if (pointiness <= 1.0) {
        float rp = regularPolygonRadius(ang, n);
        float p = clamp(pointiness, 0.0, 1.0);

        // Base morph: circle -> polygon
        float r = mix(1.0, rp, p);

        // Roundness only affects this regime when pointiness < 1
        // At pointiness = 1, roundness has no effect
        float softenAmt = (1.0 - p) * roundness;
        r = mix(r, 1.0, softenAmt);

        return r;
    }

    // -----------------------------------
    // >1 = star
    // -----------------------------------
    float starAmt = pointiness - 1.0;
    float innerPoly = cos(PI / n);

    // Controls valley depth; tweak 1.15 if needed
    float innerR = innerPoly / (1.0 + 1.15 * starAmt);
    innerR = clamp(innerR, 0.001, 1.0);

    // Sharp star
    float sharpStar = starPolygonRadius(ang, n, innerR);

    // Rounded Sapphire-like star:
    // sharp outer tip + curved sides + smoother inner valley
    float roundedStar = roundedStarRadius(ang, n, innerR, roundness);

    // Blend from exact star -> curved star by Roundness
    return mix(sharpStar, roundedStar, roundness);
}

// Convert center property into Panzoid screen-space.
// Supports BOTH:
// - Panzoid-style relative center: (0,0) = frame center, +-0.5 ≈ edges
// - AE-style pixel coordinates: if values are larger than ~2, treated as pixels
vec2 getCenterNorm() {
    vec2 c;
    if (max(abs(Center_XY.x), abs(Center_XY.y)) > 2.0) {
        // AE-like pixels from top-left
        c = (Center_XY / resolution - 0.5) * 2.0;
    } else {
        // Panzoid-relative: (0,0)=center, +-0.5 ≈ edges
        c = Center_XY * 2.0;
    }
    return c;
}

void main() {
    vec4 bgTex = texture2D(tDiffuse, vUvScaled);

    // Background brightness
    vec3 bg = bgTex.rgb * max(Bg_Brightness, 0.0);

    // Screen-centered coordinates using height as the reference dimension.
    // y range: [-1,1], x range: [-aspect, aspect]
    float aspect = resolution.x / resolution.y;
    vec2 p = (vUv - vec2(0.5)) * 2.0;

    vec2 center = getCenterNorm();
    p -= center;

    p.x *= aspect;

    // Size is treated like AE-ish pixel radius relative to shorter frame dimension
    float minRes = min(resolution.x, resolution.y);
    float sizeNorm = max(Size, 0.0001) * (2.0 / minRes);

    // Inverse transform pipeline:
    // final = translate(center) * rotate(post) * scale(rel) * rotate(pre) * canonical
    // so for point test:
    // canonical = rotate(-pre) * scale^-1 * rotate(-post) * (p)
    vec2 q = p;
    q = rot2(radians(-Rotate)) * q;
    q.x /= max(Rel_Width,  1e-5);
    q.y /= max(Rel_Height, 1e-5);
    q = rot2(radians(-Rotate_Pre_Scale)) * q;
    q /= sizeNorm;

    // Polar
    float r = length(q);
    float ang = atan(q.y, q.x);

    // Swirl: outer parts rotate more than center
    // Using radial amount in shape-local space
    ang -= Swirl * r;

    float n = clamp(Points, 3.0, 500.0);
    float boundary = shapeBoundaryRadius(ang, n, Pointiness, Roundness);

    // Positive inside
    float edge = boundary - r;

    // Blur in local shape units
    float blurLocal = max(Blur, 0.0) / max(Size, 1.0);
    float aaLocal = 1.25 / max(Size, 1.0);
    float feather = max(blurLocal, aaLocal);

    float shapeAlpha = smoothstep(-feather, feather, edge);

    vec3 fg = Color1 * Brightness1;
    vec3 genBg = Color0 + vec3(Offset0);

    // Generated image from S_Shape itself
    // Outside shape = Color0 + Offset0
    // Inside shape  = Color1 * Brightness1
    vec3 generated = mix(genBg, fg, shapeAlpha);

    int mode = int(floor(Combine + 0.5));

    vec3 outRgb;
    float outA;

    // 0 = Shape Only
    if (mode == 0) {
        outRgb = fg;
        outA = shapeAlpha;
    }
    // 1 = Mult
    else if (mode == 1) {
        outRgb = bg * generated;
        outA = 1.0;
    }
    // 2 = Add
    else if (mode == 2) {
        outRgb = bg + generated;
        outA = 1.0;
    }
    // 3 = Screen
    else if (mode == 3) {
        outRgb = 1.0 - (1.0 - bg) * (1.0 - generated);
        outA = 1.0;
    }
    // 4 = Difference
    else if (mode == 4) {
        outRgb = abs(bg - generated);
        outA = 1.0;
    }
    // 5 = Overlay
    else if (mode == 5) {
        outRgb = overlayBlend(bg, generated);
        outA = 1.0;
    }
    // 6 = Over
    else {
        // In Sapphire-style "render image over background",
        // generated image is treated as the rendered layer.
        // If you want transparent outside area, use Combine = 0.
        outRgb = generated;
        outA = 1.0;
    }

    gl_FragColor = vec4(outRgb, outA);
}
