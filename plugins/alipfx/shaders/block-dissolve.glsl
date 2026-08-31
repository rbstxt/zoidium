precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

// Panzoid Custom Properties
uniform float Transition_Completion;
uniform float Block_Width;
uniform float Block_Height;
uniform float Feather;
uniform float Soft_Edges;

varying vec2 vUvScaled;
varying vec2 vUv;

// High-precision hash function (Fixes the horizontal dash/stretching artifacts)
float rand(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    // Read the input layer
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    // Ensure resolution isn't 0 to avoid division by zero scaling artifacts
    vec2 res = max(resolution, vec2(1.0));
    vec2 fragCoord = vUv * res;

    // Prevent division by zero and enforce minimum 1px block sizes
    float bWidth = max(Block_Width, 1.0);
    float bHeight = max(Block_Height, 1.0);
    vec2 blockSize = vec2(bWidth, bHeight);

    // Calculate grid and block data
    vec2 gridPos = fragCoord / blockSize;
    vec2 blockId = floor(gridPos);
    vec2 blockFract = fract(gridPos);

    // Base random value for the current block
    float noiseVal = rand(blockId);

    // Normalize parameter ranges
    float completion = clamp(Transition_Completion / 100.0, 0.0, 1.0);
    float featherNorm = clamp(Feather / 100.0, 0.0, 1.0);
    
    // --------------------------------------------------------
    // 1. FEATHER & SOFT EDGES (Spatial Blurring)
    // --------------------------------------------------------
    if (Soft_Edges > 0.5 || featherNorm > 0.0) {
        // Bilinear interpolation of noise to create a gradient-based "cloudy" blend
        float n00 = noiseVal;
        float n10 = rand(blockId + vec2(1.0, 0.0));
        float n01 = rand(blockId + vec2(0.0, 1.0));
        float n11 = rand(blockId + vec2(1.0, 1.0));

        vec2 u = blockFract;
        if (Soft_Edges > 0.5) {
            // Subpixel smoothing for edges (smoothstep curve)
            u = u * u * (3.0 - 2.0 * u);
        }

        float interpolatedNoise = mix(
            mix(n00, n10, u.x),
            mix(n01, n11, u.x),
            u.y
        );

        // Blend between hard pixel blocks and soft interpolated noise based on Feather
        float mixFactor = clamp(featherNorm * 2.0, 0.0, 1.0); 
        
        // If Feather is 0 but Soft Edges is ON, apply a tiny micro-blend to act as Anti-Aliasing
        if (featherNorm == 0.0 && Soft_Edges > 0.5) {
            mixFactor = 0.05; 
        }

        noiseVal = mix(noiseVal, interpolatedNoise, mixFactor);
    }

    // --------------------------------------------------------
    // 2. ALPHA CUTOFF & TRANSITION LOGIC
    // --------------------------------------------------------
    float alpha = 1.0;
    
    // Determine the transition "spread" based on Feather and Soft Edges
    float spread = featherNorm;
    if (Soft_Edges > 0.5 && spread < 0.01) {
        spread = 0.01; // Minimum spread to provide anti-aliased edges
    }

    if (spread > 0.0) {
        // Soft Transition: Uses smoothstep to fade blocks in/out gradually
        // Map the completion threshold so 0% is completely visible and 100% is completely gone
        float c = completion * (1.0 + 2.0 * spread) - spread;
        alpha = smoothstep(c - spread, c + spread, noiseVal);
    } else {
        // Hard Transition: Pure crisp, jagged blocks (Soft Edges = 0, Feather = 0)
        alpha = step(completion, noiseVal);
        
        // Strict boundary fixes
        if (completion <= 0.0) {
            alpha = 1.0;
        } else if (completion >= 1.0) {
            alpha = 0.0;
        }
    }

    // Output final color with modified alpha applied
    gl_FragColor = vec4(texel.rgb, texel.a * alpha);
}
