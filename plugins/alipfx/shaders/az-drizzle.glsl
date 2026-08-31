precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// Panzoid dynamic number properties
uniform float time;
uniform float Drip_Rate;
uniform float Longevity;
uniform float Rippling;
uniform float Displacement;
uniform float Ripple_Height;
uniform float Spreading;

// ------------------------------------------------------------
// Hash helpers
// ------------------------------------------------------------
float hash21(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p)
{
    float n = sin(dot(p, vec2(127.1, 311.7)));
    return fract(vec2(262144.0, 32768.0) * n);
}

vec2 toBufferUV(vec2 uv)
{
    return uv * uvScale;
}

// A narrow ring profile centered on x=0.
// This is used to create thin drizzle bands rather than fat glowing arcs.
float ringProfile(float x, float w)
{
    float a = abs(x);
    return exp(-(a * a) / max(w * w, 1e-6));
}

// Growth curve driven by normalized lifetime.
// Higher Longevity = slower progression in real seconds.
// Lower Longevity = faster progression in real seconds.
float growthCurve(float t)
{
    t = clamp(t, 0.0, 1.0);
    return 1.0 - pow(1.0 - t, 3.4);
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
void main()
{
    vec2 uv = vUv;

    // Aspect correction so rings stay circular
    float aspectRatio = resolution.x / max(resolution.y, 1.0);
    vec2 aspect = vec2(aspectRatio, 1.0);

    // --------------------------------------------------------
    // AE-like tuning constants
    // --------------------------------------------------------
    const float SPAWN_PROB = 0.075;
    const int CELL_RADIUS = 2;
    const int MAX_HISTORY = 10;

    // Slightly larger cells -> less clutter / more AE-like spacing
    float cellPx = 185.0;

    vec2 grid = max(vec2(1.0), resolution / cellPx);
    vec2 cell = floor(uv * grid);

    float rate = max(Drip_Rate, 0.0001);
    float life = max(Longevity, 0.0001);

    // Spreading controls final ripple reach, not lifetime speed.
    float spreadN = max(Spreading / 100.0, 0.001);
    float maxRadius = 0.018 + 0.055 * pow(spreadN, 0.65);

    // Rippling influences how many internal wave bands appear,
    // but in an AE-like restrained way.
    float bandCount = 1.0 + 0.015 * max(Rippling, 0.0);

    // Ripple Height should mostly affect steepness/sharpness,
    // not brute force brightness.
    float sharpness = clamp(Ripple_Height / 100.0, 0.0, 2.0);

    // Narrower ring widths for thinner AE-style crescents.
    float ringWidth = mix(0.020, 0.0065, clamp(sharpness * 0.7, 0.0, 1.0));

    // Much lower wave energy than earlier versions.
    float heightAmp = 0.006 + Ripple_Height * 0.00042;

    float h = 0.0;
    vec2 grad = vec2(0.0);

    float historyNeeded = min(float(MAX_HISTORY - 1), ceil(life * rate) + 1.0);

    // --------------------------------------------------------
    // Accumulate procedural drizzle events
    // --------------------------------------------------------
    for (int oy = -CELL_RADIUS; oy <= CELL_RADIUS; oy++)
    {
        for (int ox = -CELL_RADIUS; ox <= CELL_RADIUS; ox++)
        {
            vec2 ccell = cell + vec2(float(ox), float(oy));
            float currentSlot = floor(time * rate);

            for (int hi = 0; hi < MAX_HISTORY; hi++)
            {
                if (float(hi) > historyNeeded) break;

                float slot = currentSlot - float(hi);

                // Event existence
                float chance = hash21(ccell + vec2(slot * 0.73 + 19.13, slot * 1.91 + 7.17));
                if (chance > SPAWN_PROB) continue;

                // Jittered spawn time inside time slot
                float tJitter = hash21(ccell + vec2(slot * 1.37 + 3.1, slot * 2.11 + 8.7));
                float spawnTime = (slot + tJitter) / rate;
                float age = time - spawnTime;

                if (age < 0.0 || age > life) continue;

                // Jittered position inside cell
                vec2 rnd = hash22(ccell + vec2(slot * 0.91 + 11.3, slot * 1.27 + 17.9));
                vec2 center = (ccell + rnd) / grid;

                vec2 dp = (uv - center) * aspect;
                float d = length(dp) + 1e-6;

                // Normalized life progress:
                // high Longevity = slower over real seconds
                // low Longevity = faster over real seconds
                float t = clamp(age / life, 0.0, 1.0);

                // Radius progresses through life, not raw seconds.
                // So Longevity controls drizzle speed,
                // while Spreading controls final size only.
                float radius = maxRadius * growthCurve(t);
                float x = d - radius;

                // Gradual temporal envelope
                float attack = smoothstep(0.0, 0.05, t);
                float decay  = 1.0 - smoothstep(0.45, 0.92, t);
                float lifeFade = attack * decay;

                // Inner repeating bands, restrained to avoid overdoing it.
                float waveFreq = (6.2831853 * bandCount) / max(ringWidth * 14.0, 1e-4);

                // Thin ring centered on the moving front
                float front = ringProfile(x, ringWidth);

                // A subtle oscillation on top of the front
                float phase = x * waveFreq;
                float osc = 0.65 + 0.35 * sin(phase);

                // The actual ripple height field
                float ripple = front * osc * lifeFade;

                // Derivative approximation for normal/displacement
                float dx = ringWidth * 0.35;
                float frontP = ringProfile(x + dx, ringWidth);
                float frontM = ringProfile(x - dx, ringWidth);

                float oscP = 0.65 + 0.35 * sin((x + dx) * waveFreq);
                float oscM = 0.65 + 0.35 * sin((x - dx) * waveFreq);

                float rippleP = frontP * oscP * lifeFade;
                float rippleM = frontM * oscM * lifeFade;

                float dhdx = (rippleP - rippleM) / (2.0 * dx);

                float amp = heightAmp;

                h += ripple * amp;
                grad += (dp / d) * dhdx * amp;
            }
        }
    }

    // --------------------------------------------------------
    // Displacement: subtle AE-like distortion
    // --------------------------------------------------------
    vec2 uvOffset = vec2(grad.x / aspect.x, grad.y);

    // Much gentler than earlier versions.
    uvOffset *= (Displacement / max(resolution.y, 1.0)) * 0.95;

    vec2 sampleUV = clamp(uv + uvOffset, vec2(0.0), vec2(1.0));
    vec4 base = texture2D(tDiffuse, toBufferUV(sampleUV));

    // --------------------------------------------------------
    // AE-like crescent highlight/shading
    // --------------------------------------------------------
    vec3 N = normalize(vec3(-grad.x * (0.22 + 0.0018 * Ripple_Height),
                            -grad.y * (0.22 + 0.0018 * Ripple_Height),
                             1.0));

    // Fixed light direction similar to a soft upper-left highlight
    vec3 L = normalize(vec3(-0.42, 0.52, 0.74));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 R = reflect(-L, N);

    float diffuse = max(dot(N, L), 0.0);
    float spec = pow(max(dot(R, V), 0.0), 34.0);

    // Ring mask: stronger only where ring geometry exists
    float ringMask = clamp(h * 16.0, 0.0, 1.0);

    // Crescent bias:
    // Emphasize one side of the ring rather than full uniform glow.
    vec2 light2D = normalize(vec2(L.x, L.y));
    vec2 g = vec2(-grad.x, -grad.y);
    float gLen = max(length(g), 1e-6);
    float crescent = clamp(dot(g / gLen, light2D) * 0.5 + 0.5, 0.0, 1.0);

    float shade =
          (diffuse - 0.52) * 0.045 * ringMask
        + spec * 0.060 * ringMask * crescent;

    // Very subtle dark trough to help ring definition without looking embossed
    float trough = clamp(-h * 10.0, 0.0, 1.0) * 0.020;

    vec3 color = base.rgb + vec3(shade - trough);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), base.a);
}
