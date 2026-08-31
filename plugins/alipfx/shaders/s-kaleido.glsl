precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform float Pattern;
uniform vec2 Center_XY;
uniform float Z_Dist;
uniform float Rotate;
uniform float Inside_Shift_X;
uniform float Inside_Shift_Y;
uniform float Inside_Z_Dist;
uniform float Inside_Rotate;
uniform float Kaleido_Amount;
uniform float Wrap_X;
uniform float Wrap_Y;

varying vec2 vUv;
varying vec2 vUvScaled;

const float PI = 3.14159265358979323846;
const float SQRT3 = 1.7320508075688772;
const float EPS = 1e-5;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
vec2 rot2d(vec2 p, float deg)
{
    float a = radians(deg);
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float repeatTile(float x)
{
    x = fract(x);
    if (x < 0.0) x += 1.0;
    return x;
}

float repeatReflect(float x)
{
    float m = mod(x, 2.0);
    if (m < 0.0) m += 2.0;
    return 1.0 - abs(m - 1.0);
}

float mirrorCentered(float x)
{
    return repeatReflect(x + 0.5) - 0.5;
}

// ------------------------------------------------------------
// Coordinate conversion
// ------------------------------------------------------------
vec2 topLeftPxToUv01(vec2 px)
{
    return vec2(px.x / resolution.x, 1.0 - (px.y / resolution.y));
}

vec4 sampleWrapped01(vec2 uv01)
{
    float u = uv01.x;
    float v = uv01.y;
    bool valid = true;

    // Wrap X
    if (Wrap_X < 0.5)
    {
        if (u < 0.0 || u > 1.0) valid = false;
    }
    else if (Wrap_X < 1.5)
    {
        u = repeatTile(u);
    }
    else
    {
        u = repeatReflect(u);
    }

    // Wrap Y
    if (Wrap_Y < 0.5)
    {
        if (v < 0.0 || v > 1.0) valid = false;
    }
    else if (Wrap_Y < 1.5)
    {
        v = repeatTile(v);
    }
    else
    {
        v = repeatReflect(v);
    }

    if (!valid)
    {
        return vec4(0.0);
    }

    return texture2D(tDiffuse, vec2(u, v) * uvScale);
}

vec4 sampleWrappedTopLeftPx(vec2 px)
{
    return sampleWrapped01(topLeftPxToUv01(px));
}

// ------------------------------------------------------------
// MODE-BY-MODE CALIBRATION
//
// IMPORTANT:
// mirrorPeriod() controls how Z Dist changes repetition density.
// sourceSpan() controls source size inside the mirrors.
// This means Z Dist no longer zooms the source layer directly.
// ------------------------------------------------------------

// Larger mirrorPeriod = fewer repetitions at same Z Dist
float mirrorPeriod(float pattern)
{
    float m = min(resolution.x, resolution.y);

    // Calibrated closer to AE visual density
    if (pattern < 0.5) return m * 0.98; // Triangles
    if (pattern < 1.5) return m * 0.72; // Squares
    if (pattern < 2.5) return m * 0.90; // Diamonds
    return m * 0.68;                    // Oct
}

// Larger sourceSpan = source appears smaller inside tiles
float sourceSpan(float pattern)
{
    float m = min(resolution.x, resolution.y);

    // Decoupled from Z Dist; these are tuned by mode
    if (pattern < 0.5) return m * 1.55; // Triangles
    if (pattern < 1.5) return m * 1.18; // Squares
    if (pattern < 2.5) return m * 1.34; // Diamonds
    return m * 1.52;                    // Oct
}

// Hidden default placement / phase per mode
// This fixes the “origin placement” mismatch.
vec2 placementOffset(float pattern)
{
    if (pattern < 0.5) return vec2( 0.00, -0.08); // Triangles
    if (pattern < 1.5) return vec2( 0.00,  0.00); // Squares
    if (pattern < 2.5) return vec2( 0.00, -0.10); // Diamonds
    return vec2( 0.06,  0.02);                    // Oct
}

// ------------------------------------------------------------
// Fold functions
// ------------------------------------------------------------

// Triangles: equilateral triangle lattice
vec2 foldTriangles(vec2 q)
{
    vec2 uv = vec2(
        q.x - q.y / SQRT3,
        (2.0 * q.y) / SQRT3
    );

    vec2 f = vec2(
        repeatReflect(uv.x),
        repeatReflect(uv.y)
    );

    if (f.x + f.y > 1.0)
    {
        f = vec2(1.0 - f.y, 1.0 - f.x);
    }

    // canonical triangle centroid
    f -= vec2(1.0 / 3.0);

    return vec2(
        f.x + 0.5 * f.y,
        0.5 * SQRT3 * f.y
    );
}

// Squares
vec2 foldSquares(vec2 q)
{
    return vec2(
        mirrorCentered(q.x),
        mirrorCentered(q.y)
    );
}

// Diamonds
vec2 foldDiamonds(vec2 q)
{
    vec2 r = rot2d(q, -45.0);
    r = foldSquares(r);
    return rot2d(r, 45.0);
}

// Oct: square-lattice based right-triangle fold
vec2 foldOct(vec2 q)
{
    vec2 s = foldSquares(q);

    s = abs(s);

    if (s.y > s.x)
    {
        s = s.yx;
    }

    s -= vec2(0.25, 0.125);

    return s;
}

vec2 foldPattern(vec2 q, float pattern)
{
    if (pattern < 0.5) return foldTriangles(q);
    if (pattern < 1.5) return foldSquares(q);
    if (pattern < 2.5) return foldDiamonds(q);
    return foldOct(q);
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
void main()
{
    vec4 original = texture2D(tDiffuse, vUvScaled);

    // exact passthrough at amount = 0
    if (abs(Kaleido_Amount) < EPS)
    {
        gl_FragColor = original;
        return;
    }

    // Current fragment in top-left pixel coordinates
    vec2 fragTopLeftPx = vec2(
        vUv.x * resolution.x,
        (1.0 - vUv.y) * resolution.y
    );

    // Centered space: x right, y up
    vec2 p = vec2(
        fragTopLeftPx.x - Center_XY.x,
        Center_XY.y - fragTopLeftPx.y
    );

    float zMain = max(abs(Z_Dist), EPS);
    float zInside = max(abs(Inside_Z_Dist), EPS);

    float mirrorSize = mirrorPeriod(Pattern);
    float srcSize = sourceSpan(Pattern);

    // Rotate mirror system only
    vec2 mirrorSpace = rot2d(p, -Rotate);

    // --------------------------------------------------------
    // Z Dist affects mirror repetition ONLY
    // --------------------------------------------------------
    vec2 q = mirrorSpace * (zMain / mirrorSize);

    // Fold to mirror domain
    vec2 qFold = foldPattern(q, Pattern);

    // Hidden phase correction
    vec2 local = qFold + placementOffset(Pattern);

    // --------------------------------------------------------
    // Source mapping is DECOUPLED from Z Dist
    // --------------------------------------------------------
    vec2 srcRelK = local * srcSize;

    // Inside Z Dist affects source only
    srcRelK *= zInside;

    // Rotate source under mirrors only
    srcRelK = rot2d(srcRelK, -Inside_Rotate);

    // Shift source under mirrors only
    srcRelK -= vec2(Inside_Shift_X, -Inside_Shift_Y);

    // --------------------------------------------------------
    // Kaleido Amount
    // 0 = original
    // 1 = full effect
    // >1 = overdrive
    // --------------------------------------------------------
    float amt = max(Kaleido_Amount, 0.0);
    vec2 srcRel = p + (srcRelK - p) * amt;

    // Convert back to top-left pixel coordinates
    vec2 srcTopLeftPx = vec2(
        Center_XY.x + srcRel.x,
        Center_XY.y - srcRel.y
    );

    gl_FragColor = sampleWrappedTopLeftPx(srcTopLeftPx);
}
