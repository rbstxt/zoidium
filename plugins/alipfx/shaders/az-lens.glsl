precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;

// ---- Custom properties (Panzoid UI) ----
uniform vec2 Center;        // AE PIXELS ONLY (0,0)=TOP-LEFT like AE
uniform float Size;         // 0..500
uniform float Convergence;  // ~ -200..100

#define CUTOUT_OUTSIDE 1
#define USE_INPUT_ALPHA_AS_MASK 0

float saturate(float x) { return clamp(x, 0.0, 1.0); }

// GLSL ES safe tanh approximation (soft clamp)
float tanh_approx(float x)
{
    x = clamp(x, -6.0, 6.0);
    float e2x = exp(2.0 * x);
    return (e2x - 1.0) / (e2x + 1.0);
}

// AE pixels -> Panzoid UV (bottom-left)
vec2 getCenterUV()
{
    vec2 c01 = vec2(Center.x / resolution.x, Center.y / resolution.y);
    return vec2(c01.x, 1.0 - c01.y);
}

// Out-of-bounds returns transparent/black (good for cutouts)
vec4 sampleWithTransparentBorders(vec2 uv01)
{
    if (uv01.x < 0.0 || uv01.x > 1.0 || uv01.y < 0.0 || uv01.y > 1.0)
        return vec4(0.0);
    return texture2D(tDiffuse, uv01 * uvScale);
}

// Clamp UV only (used inside the lens so refraction doesn't "die" early)
vec4 sampleClamped(vec2 uv01)
{
    uv01 = clamp(uv01, vec2(0.0), vec2(1.0));
    return texture2D(tDiffuse, uv01 * uvScale);
}

vec2 ccLensWarp(vec2 uv01, float Rpx, float k, float edge, float sizeAtten)
{
    vec2 centerUV = getCenterUV();

    vec2 p = uv01 * resolution;
    vec2 c = centerUV * resolution;
    vec2 d = p - c;

    float r = length(d);
    if (r < 1e-6) return uv01;

    // NEGATIVE convergence (pinch)
    if (k < 0.0)
    {
        float rn = r / max(Rpx, 1e-4);
        float negStrength = tanh_approx(abs(k) * 1.20);
        rn = clamp(rn, 0.0, 2.5);
        float radial = rn * rn;

        float scale = 1.0 + (negStrength * radial * 0.85) * sizeAtten;
        vec2 warpedPx = c + d * scale;
        return warpedPx / resolution;
    }

    // POSITIVE convergence: stable radial refraction (no flip)
    vec2 nd = d / max(Rpx, 1e-4);
    float rr = dot(nd, nd);
    float z = sqrt(max(0.0, 1.0 - rr));

    float strength = tanh_approx(abs(k) * 0.75);
    float ior = mix(1.0, 1.75, strength);

    vec3 I = vec3(0.0, 0.0, -1.0);
    vec3 N = normalize(vec3(nd.x, nd.y, z));

    float eta = 1.0 / ior;
    vec3 T = refract(I, N, eta);

    float s = (1.10 * strength) * edge * sizeAtten;

    float u = clamp(r / max(Rpx, 1e-4), 0.0, 1.0);
    float rim = smoothstep(0.75, 1.0, u);

    float denom = abs(T.z) + mix(0.06, 0.28, rim);
    vec2 proj = T.xy / denom;

    // Radial-only component (prevents twist/flip)
    vec2 radialDir = d / r;
    float radialScalar = dot(proj, radialDir);

    // Soft clamp scalar (keeps response but prevents spikes)
    float maxDisp = mix(2.2, 1.2, rim);
    radialScalar = tanh_approx(radialScalar / maxDisp) * maxDisp;

    // Convert to pixel displacement and clamp inside lens radius (prevents "dies at size=4")
    float dispPx = radialScalar * (Rpx * s);
    dispPx = clamp(dispPx, -0.95 * Rpx, 0.95 * Rpx);

    vec2 offsetPx = radialDir * dispPx;

    // If bulge direction feels inverted vs AE, switch + to -
    vec2 warpedPx = p + offsetPx;

    return warpedPx / resolution;
}

void main()
{
    vec2 uv = vUv;

    // Size=0 => OPAQUE BLACK (your expectation)
    if (Size <= 0.0001)
    {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec2 centerUV = getCenterUV();
    float minDim = min(resolution.x, resolution.y);

    // ==========================================================
    // ✅ NEW SIZE MAPPING:
    // Size=10 -> ~150px radius on 1080p
    // Size=50 -> minDim/2 (touch comp top/bottom when centered)
    // ==========================================================
    const float SIZE_EXP = 0.79588895;  // solved from the two anchors (10->150px, 50->minDim/2)
    float sizeNorm = max(Size, 0.0001) / 50.0;
    float R = (minDim * 0.5) * pow(sizeNorm, SIZE_EXP);
    R = max(R, 1e-4);

    // Distortion scaling (kept)
    float sizeAtten = inversesqrt(max(Size / 50.0, 1e-4));
    float k = (Convergence / 100.0) * sizeAtten;

    // Distance from center
    vec2 p = uv * resolution;
    vec2 c = centerUV * resolution;
    float distPx = length(p - c);
    float t = distPx / R;

    // Thin crisp rim (AE-like)
    float featherPx = 1.25;
    float feather = clamp(featherPx / max(R, 1.0), 0.0008, 0.02);

    float lensMask = 1.0 - smoothstep(1.0 - feather, 1.0, t);
    float edge = lensMask;

    vec4 base = texture2D(tDiffuse, uv * uvScale);

    // If convergence ~0 => no effect
    if (abs(k) < 1e-6)
    {
        gl_FragColor = base;
        return;
    }

    // Outside lens
    if (t >= 1.0)
    {
        #if CUTOUT_OUTSIDE
            gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        #else
            gl_FragColor = base;
        #endif
        return;
    }

    // Warp + sample (INSIDE lens we clamp UV so it doesn't die early)
    vec2 warpedUV = ccLensWarp(uv, R, k, edge, sizeAtten);
    vec4 warpedTex = sampleClamped(warpedUV);

    float a = lensMask;
    #if USE_INPUT_ALPHA_AS_MASK
        a *= warpedTex.a;
    #endif

    // Premultiply so edges behave cleanly
    gl_FragColor = vec4(warpedTex.rgb * a, a);
}
