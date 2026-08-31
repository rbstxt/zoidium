precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

// Panzoid shader properties
uniform float Stretch;    // AE-like units (0..100+)
uniform vec2  Center;     // normalized (0..1) OR pixels (auto-detect)
uniform float Direction;  // degrees, AE mapping: 0=up, 90=right

// Clamp sampling to edge pixels (prevents black wedges)
vec4 sampleClamp(vec2 uv01)
{
    vec2 u = clamp(uv01, vec2(0.0), vec2(1.0));
    return texture2D(tDiffuse, u * uvScale);
}

void main()
{
    // Convert Panzoid scaled UV -> normal UV (0..1)
    vec2 uv = vUvScaled / uvScale;

    // Center: allow BOTH normalized and pixel input
    vec2 cPix = (max(Center.x, Center.y) > 2.0) ? Center : (Center * resolution);

    // Work in pixel space
    vec2 pPix = uv * resolution;
    vec2 r = pPix - cPix;

    // AE direction mapping: 0°=up, 90°=right
    float a = radians(Direction);
    vec2 dir  = normalize(vec2(sin(a), cos(a)));
    vec2 perp = vec2(-dir.y, dir.x);

    float s = dot(r, dir);
    float t = dot(r, perp);

    // -------------------------------
    // ✅ Progressive + smear stretch
    // -------------------------------

    // Find the maximum extent along 'dir' from the center to the comp corners
    float s0 = dot((vec2(0.0,          0.0)          - cPix), dir);
    float s1 = dot((vec2(resolution.x, 0.0)          - cPix), dir);
    float s2 = dot((vec2(0.0,          resolution.y) - cPix), dir);
    float s3 = dot((vec2(resolution.x, resolution.y) - cPix), dir);

    float sMax = max(max(s0, s1), max(s2, s3)); // furthest in + direction
    float sMin = min(min(s0, s1), min(s2, s3)); // furthest in - direction

    float posExtent = max(sMax, 1e-5);
    float negExtent = max(-sMin, 1e-5);

    // Which side to affect (AE: Stretch sign flips direction)
    float side = (Stretch >= 0.0) ? 1.0 : -1.0;

    // Normalize distance on the affected side to 0..1
    // u = 0 at center line, u = 1 near the far edge (in that direction)
    float u;
    if (side > 0.0) u = clamp(s / posExtent, 0.0, 1.0);
    else            u = clamp((-s) / negExtent, 0.0, 1.0);

    // Curve controls how "progressive" it is:
    // - lower = more linear
    // - higher = keeps near-center cleaner and smears far-out more (AE-ish)
    float curve = 1.6;
    float uCurve = pow(u, curve);

    // AE-like strength: Stretch=100 should be very strong
    // This creates the "smear band" by collapsing far distances toward the center line.
    float amt = abs(Stretch);
    float factor = 1.0 + amt * uCurve;

    float sWarp = s;

    // Apply on only one side (like AE)
    if (Stretch > 0.0) {
        if (s > 0.0) sWarp = s / factor;
    } else if (Stretch < 0.0) {
        if (s < 0.0) sWarp = s / factor;
    }

    // ✅ Fix the "X seam": blend original→warped within a tiny band around the center line
    // This adds interpolation so crossing shapes don’t look chopped.
    float softPx = 1.5; // 1–2 pixels is usually enough
    float blend = smoothstep(0.0, softPx, s * side); // ramps only on affected side

    float sFinal = mix(s, sWarp, blend);

    // Back to pixel position -> UV
    vec2 p2Pix = cPix + dir * sFinal + perp * t;
    vec2 uv2   = p2Pix / resolution;

    gl_FragColor = sampleClamp(uv2);
}
