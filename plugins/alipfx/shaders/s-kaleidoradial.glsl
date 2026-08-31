precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

/*
Panzoid custom properties:

uniform vec2 Center_XY;            // pixel coordinates
uniform float Z_Dist;              // 1.0 = neutral
uniform float Slices;              // recommended >= 1.0
uniform float Rotate;              // degrees
uniform float Rotate_Kaleido;      // degrees
uniform float Rotate_Inside;       // degrees
uniform float Rotate_Inside_Speed; // degrees per second
uniform vec2 Shift_Inside;         // pixel offset
uniform float Kaleido_Amount;      // 0 = original, 1 = full, >1 = exaggerated
uniform float Wrap;                // 0 = No, 1 = Tile, 2 = Reflect
uniform float time;                // seconds
*/

uniform vec2 Center_XY;
uniform float Z_Dist;
uniform float Slices;
uniform float Rotate;
uniform float Rotate_Kaleido;
uniform float Rotate_Inside;
uniform float Rotate_Inside_Speed;
uniform vec2 Shift_Inside;
uniform float Kaleido_Amount;
uniform float Wrap;
uniform float time;

const float PI  = 3.1415926535897932384626433832795;
const float TAU = 6.2831853071795864769252867665590;

vec2 rotate2D(vec2 p, float a)
{
    float s = sin(a);
    float c = cos(a);
    return vec2(
        c * p.x - s * p.y,
        s * p.x + c * p.y
    );
}

float degToRad(float d)
{
    return d * PI / 180.0;
}

// Safer reflect repeat over infinite plane
float reflectCoord(float x)
{
    float m = mod(x, 2.0);
    if (m < 0.0) m += 2.0;
    return (m <= 1.0) ? m : (2.0 - m);
}

// Safer tile repeat over infinite plane
float tileCoord(float x)
{
    float m = mod(x, 1.0);
    if (m < 0.0) m += 1.0;
    return m;
}

bool isOutside01(vec2 uv)
{
    return (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0);
}

// Better wrap feel:
// - avoids exact edge hits by clamping inward by half a pixel
// - reflect mode mirrors more cleanly
vec4 sampleSourceBetterWrap(vec2 uv, float wrapMode)
{
    vec2 texel = 0.5 / resolution;

    if (wrapMode < 0.5)
    {
        if (isOutside01(uv))
        {
            return vec4(0.0, 0.0, 0.0, 1.0);
        }

        vec2 clampedUV = clamp(uv, texel, 1.0 - texel);
        return texture2D(tDiffuse, clampedUV * uvScale);
    }
    else if (wrapMode < 1.5)
    {
        vec2 tiledUV = vec2(tileCoord(uv.x), tileCoord(uv.y));
        tiledUV = clamp(tiledUV, texel, 1.0 - texel);
        return texture2D(tDiffuse, tiledUV * uvScale);
    }
    else
    {
        vec2 reflectedUV = vec2(reflectCoord(uv.x), reflectCoord(uv.y));
        reflectedUV = clamp(reflectedUV, texel, 1.0 - texel);
        return texture2D(tDiffuse, reflectedUV * uvScale);
    }
}

// Centered kaleido fold:
// folds around the CENTER of each wedge instead of the wedge edge.
// This tends to produce a cleaner regular polygon center, especially at 6 slices.
float kaleidoFoldCentered(float angle, float slices, float rotateKaleidoRad)
{
    float s = max(slices, 1.0);
    float wedge = TAU / s;
    float halfWedge = wedge * 0.5;

    // rotate mirror layout
    float a = angle - rotateKaleidoRad;

    // center each wedge on 0
    a = mod(a + halfWedge, wedge) - halfWedge;

    // mirror around wedge center axis
    a = abs(a);

    // rotate back
    a += rotateKaleidoRad;

    return a;
}

void main()
{
    // Current output pixel position
    vec2 fragPx = vUv * resolution;

    float safeZ = max(Z_Dist, 0.0001);
    float slices = max(Slices, 1.0);

    float rotResult   = degToRad(Rotate);
    float rotKaleido  = degToRad(Rotate_Kaleido);
    float rotInside   = degToRad(Rotate_Inside + Rotate_Inside_Speed * time);

    // ------------------------------------------------------------
    // 1) Result-space transform
    // ------------------------------------------------------------
    vec2 p = fragPx - Center_XY;

    // Rotate whole result around center
    p = rotate2D(p, -rotResult);

    // Z Dist fix:
    // widen the neutral baseline so Z_Dist = 1.0 is less zoomed in
    p *= (safeZ * 2.0);

    // ------------------------------------------------------------
    // 2) Kaleido mirror folding
    // ------------------------------------------------------------
    float r = length(p);
    float a = atan(p.y, p.x);

    // centered folding improves the center polygon / hexagon look
    float foldedAngle = kaleidoFoldCentered(a, slices, rotKaleido);
    vec2 kaleidoPx = vec2(cos(foldedAngle), sin(foldedAngle)) * r;

    // ------------------------------------------------------------
    // 3) Inside transforms
    // ------------------------------------------------------------
    vec2 srcPx = kaleidoPx;

    // Rotate the source image under the mirrors
    srcPx = rotate2D(srcPx, -rotInside);

    // Keep original Shift Inside behavior unchanged
    srcPx -= Shift_Inside;

    // Back to image pixel space
    srcPx += Center_XY;

    // ------------------------------------------------------------
    // 4) Kaleido Amount
    // ------------------------------------------------------------
    vec2 mixedPx = mix(fragPx, srcPx, Kaleido_Amount);

    vec2 uvFinal = mixedPx / resolution;
    vec4 resultColor = sampleSourceBetterWrap(uvFinal, Wrap);

    gl_FragColor = resultColor;
}
