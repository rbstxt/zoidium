precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

// Panzoid shader properties
uniform float Completion;         // 0..100
uniform vec2  Center;             // normalized (0..1) OR pixels (auto-detect)
uniform float Reverse_Transition; // 0 or 1

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

    // Completion normalized
    float p = clamp(Completion / 100.0, 0.0, 1.0);

    // ✅ 0% => absolutely no effect (no wipe, no distortion)
    if (p <= 1e-6)
    {
        gl_FragColor = sampleClamp(uv);
        return;
    }

    float rev = step(0.5, Reverse_Transition);

    // Center: normalized (0..1) OR pixels
    vec2 cPix = (max(Center.x, Center.y) > 2.0) ? Center : (Center * resolution);

    // Pixel space
    vec2 pPix = uv * resolution;

    // Aspect-correct radial space (so circles stay circles)
    vec2 dNorm = (pPix - cPix) / resolution.y;
    float r = length(dNorm);

    // Max radius to farthest corner (same normalized-by-height units)
    vec2 c0 = (vec2(0.0, 0.0) - cPix) / resolution.y;
    vec2 c1 = (vec2(resolution.x, 0.0) - cPix) / resolution.y;
    vec2 c2 = (vec2(0.0, resolution.y) - cPix) / resolution.y;
    vec2 c3 = (vec2(resolution.x, resolution.y) - cPix) / resolution.y;

    float maxR = max(max(length(c0), length(c1)), max(length(c2), length(c3)));
    maxR = max(maxR, 1e-6);

    // Boundary radius:
    // rev=0: hole grows outward from center (default)
    // rev=1: hole collapses inward from edges (reverse)
    float b = mix(p * maxR, (1.0 - p) * maxR, rev);

    // ✅ 100% => fully transparent (end of transition)
    if (p >= 0.999)
    {
        vec4 base = sampleClamp(uv);
        gl_FragColor = vec4(base.rgb, 0.0);
        return;
    }

    // Unit direction (avoid NaN at center)
    vec2 udir = (r > 1e-8) ? (dNorm / r) : vec2(1.0, 0.0);

    // ------------------------------------------------------------
    // 1) HARD WIPE (no dissolve)
    // ------------------------------------------------------------
    float aa = 1.0 / resolution.y;

    // rev=0 visible outside (r >= b)
    // rev=1 visible inside  (r <= b)
    float alphaVis = mix(
        smoothstep(b - aa, b + aa, r),
        1.0 - smoothstep(b - aa, b + aa, r),
        rev
    );

    // ------------------------------------------------------------
    // 2) BULGE RING around the boundary (reverse fixed)
    // ------------------------------------------------------------
    float ring  = 0.250;   // ring thickness
    float bulge = 2.60;    // bulge strength

    // Bulge = 0 at p=0, quickly ramps on after 0
    float bulgeOn = smoothstep(0.0, 0.02, p);

    // Distance from boundary on the VISIBLE side only
    // rev=0: visible outside => dist = max(r - b, 0)
    // rev=1: visible inside  => dist = max(b - r, 0)
    float dist = mix(max(r - b, 0.0), max(b - r, 0.0), rev);

    // Ring falloff: 1 at boundary, 0 after ring distance
    float w = 1.0 - smoothstep(0.0, ring, dist);

    // Apply bulge only near boundary
    float rSrc = r;
    if (w > 0.0)
    {
        float pull = bulge * ring * w * bulgeOn;

        // ✅ IMPORTANT FIX:
        // rev=0: pull samples inward (toward boundary) from outside
        // rev=1: pull samples outward (toward boundary) from inside
        // BUT we LIMIT how far past the boundary we sample in reverse mode,
        // to avoid the "flat band" clamp artifacts you got in Panzoid.
if (rev < 0.5) {
    // Normal: outside region gets pulled inward (good)
    rSrc = r - pull;
} else {
    // Reverse: DO NOT pull outward (causes outer-edge bulge / edge sampling)
    // Pull inward instead so bulge hugs the boundary from the inside.
    // Also limit how far inward we pull so the distortion stays as a ring near the boundary.
    rSrc = max(r - pull, b - ring * 0.95);
}

    }

    // Keep sampling radius sane
    rSrc = clamp(rSrc, 0.0, maxR);

    // Sample warped UV
    vec2 dSrcNorm = udir * rSrc;
    vec2 pSrcPix  = cPix + dSrcNorm * resolution.y;
    vec2 uv2      = pSrcPix / resolution;

    vec4 col = sampleClamp(uv2);

    // Keep RGB straight so ring stays visible; alpha controls wipe
    gl_FragColor = vec4(col.rgb, col.a * alphaVis);
}
