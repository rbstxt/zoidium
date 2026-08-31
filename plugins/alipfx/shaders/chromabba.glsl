precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// IMPORTANT: Ensure your UI properties perfectly match these names!
uniform float Samples;
uniform float Strength;
uniform float Separation;
uniform float Edge_Attraction_Power;
uniform float Direction;
uniform float Edge_Mode;

const int MAX_SAMPLES = 64;
const float EPS = 1e-5;

// ------------------------------------------------------------
// Edge handling
// ------------------------------------------------------------
float mirrorCoord(float x)
{
    float m = mod(x, 2.0);
    if (m < 0.0) m += 2.0;
    return 1.0 - abs(m - 1.0);
}

vec2 applyEdgeMode(vec2 uv, out float valid)
{
    valid = 1.0;

    if (Edge_Mode < 0.5)
    {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        {
            valid = 0.0;
        }
        return clamp(uv, 0.0, 1.0); 
    }
    else if (Edge_Mode < 1.5)
    {
        return vec2(mirrorCoord(uv.x), mirrorCoord(uv.y));
    }
    else if (Edge_Mode < 2.5)
    {
        return clamp(uv, 0.0, 1.0);
    }
    else
    {
        return fract(uv);
    }
}

vec4 sampleSource(vec2 uv)
{
    float valid;
    vec2 eUv = applyEdgeMode(uv, valid);

    vec4 c = texture2D(tDiffuse, eUv * uvScale);

    if (Edge_Mode < 0.5)
    {
        c *= valid;
    }

    return c;
}

// ------------------------------------------------------------
// Edge-attraction curve
// ------------------------------------------------------------
float edgeCurveFromRadius(float radius01)
{
    // A pure power function.
    // At 1.0, it is a linear slope (giving that fisheye/tunnel feel).
    // At higher values, it keeps the center untouched and curves up violently at the edges.
    return pow(radius01, max(Edge_Attraction_Power, 0.001));
}

// ------------------------------------------------------------
// Vector computation
// ------------------------------------------------------------
// Replaces the old 'getChromaticOffsets' to handle both blur distance AND color separation
void getVectors(
    vec2 uv, 
    out vec2 blurVec, 
    out vec2 redVec, 
    out vec2 blueVec
) {
    vec2 center = vec2(0.5, 0.5);
    vec2 deltaPx = (uv - center) * resolution;
    float distPx = length(deltaPx);
    vec2 dirPx = (distPx > EPS) ? (deltaPx / distPx) : vec2(1.0, 0.0);

    float maxDistPx = length(0.5 * resolution);
    float radius01 = (maxDistPx > EPS) ? clamp(distPx / maxDistPx, 0.0, 1.0) : 0.0;

    float edgeCurve = edgeCurveFromRadius(radius01);

    // STRENGTH: Controls the total span/length of the radial displacement
    float basePx = Strength * edgeCurve;

    // SEPARATION: Controls how far the color channels split apart.
    // We scale it by Strength so they work together exactly as you requested.
    float sepPx = (Separation / 100.0) * Strength * edgeCurve;

    vec2 baseUv = (dirPx * basePx) / resolution;
    vec2 sepUv = (dirPx * sepPx) / resolution;

    float mode = floor(Direction + 0.5);

    // Apply directional vectors
    if (mode < 0.5) // Inward
    {
        blurVec = baseUv; 
        redVec = sepUv * 0.5;
        blueVec = -sepUv * 0.5;
    }
    else if (mode < 1.5) // Outward
    {
        blurVec = -baseUv; 
        redVec = -sepUv * 0.5;
        blueVec = sepUv * 0.5;
    }
    else // Both
    {
        blurVec = baseUv; 
        redVec = sepUv * 0.5;
        blueVec = -sepUv * 0.5;
    }
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
void main()
{
    vec2 uv = vUv;
    vec4 base = sampleSource(uv);

    float sCount = clamp(floor(Samples + 0.5), 1.0, float(MAX_SAMPLES));

    // If there is no effect to apply, return base pixel
    if (Strength <= 0.0 && Separation <= 0.0)
    {
        gl_FragColor = base;
        return;
    }

    vec2 blurVec;
    vec2 redVec;
    vec2 blueVec;
    getVectors(uv, blurVec, redVec, blueVec);

    float sumR = 0.0;
    float sumG = 0.0;
    float sumB = 0.0;
    float sumA = 0.0;
    float sumW = 0.0;

    float mode = floor(Direction + 0.5);

    // THE FIX: Direct color channel sampling. 
    // The loop iterates exactly "Samples" times along the displacement vector.
    for (int i = 0; i < MAX_SAMPLES; i++)
    {
        if (float(i) >= sCount) break;

        float t = 0.0;
        if (sCount > 1.0) {
            t = float(i) / (sCount - 1.0); // Progress from 0.0 to 1.0
        }

        float shift = 0.0;
        float w = 1.0;

        if (mode < 0.5) {
            shift = t; // Inward
        } else if (mode < 1.5) {
            shift = t; // Outward (vector was already inverted in getVectors)
        } else {
            shift = (t * 2.0) - 1.0; // Both (from -1.0 to 1.0)
            w = 1.0 - abs(shift); // Center weighted fading
            w = max(w, 0.001);
        }

        // 1. Find the position along the overall Strength streak
        vec2 samplePos = uv + blurVec * shift;

        // 2. Apply the specific color channel Separation relative to that point
        vec2 rPos = samplePos + redVec;
        vec2 gPos = samplePos; 
        vec2 bPos = samplePos + blueVec;

        // 3. Sample the channels
        vec4 cR = sampleSource(rPos);
        vec4 cG = sampleSource(gPos);
        vec4 cB = sampleSource(bPos);

        sumR += cR.r * w;
        sumG += cG.g * w;
        sumB += cB.b * w;
        sumA += max(max(cR.a, cG.a), cB.a) * w;
        sumW += w;
    }

    vec4 outCol = vec4(sumR, sumG, sumB, sumA) / sumW;

    if (Edge_Mode >= 0.5)
    {
        outCol.a = max(outCol.a, base.a);
    }

    gl_FragColor = outCol;
}
