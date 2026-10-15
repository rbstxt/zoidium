precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

// --- Corruption ---
uniform float Enable;
uniform float Block_Size;
uniform float Corrupt_Amount;
uniform float Displacement_X;
uniform float Displacement_Y;
uniform float Block_Jitter;
uniform float Block_Shape;
uniform float Block_Aspect;
uniform float Pixelate_Blocks;
uniform float Edge_Decay;
uniform float Global_Pixelate;
uniform float Global_Pix_Size;
uniform float Fill_Pattern;
uniform float Fill_Density;

// --- Luma Gating ---
uniform float Threshold;
uniform float Feather;
uniform float Invert;

// --- RGB Split ---
uniform float RGB_Enable;
uniform float Red_Offset_X;
uniform float Red_Offset_Y;
uniform float Green_Offset_X;
uniform float Green_Offset_Y;
uniform float Blue_Offset_X;
uniform float Blue_Offset_Y;

// --- Noise ---
uniform float Noise_Enable;
uniform float Luminance_Noise;
uniform float Chromatic_Noise;

// --- Temporal Freeze ---
uniform float Temporal_Enable;
uniform float Freeze_Strength;
uniform float Motion_Threshold;
uniform float Temporal_Mode;

// --- Seed & Master ---
uniform float Seed_Mode;
uniform float Seed;
uniform float Opacity;
uniform float Output_Mode;

float random(vec2 st, float seed) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233)) + seed) * 43758.5453123);
}

void main() {
    vec2 uv = vUvScaled;
    vec2 texelSize = 1.0 / resolution;
    
    // Seed calculation
    float currentSeed = Seed;
    if (Seed_Mode > 0.5) {
        currentSeed = time * 10.0 + Seed;
    }
    
    // Temporal Freeze logic
    if (Temporal_Enable > 0.5) {
        float freezeFactor = Freeze_Strength / 100.0;
        float timeStep = max(1.0 - freezeFactor, 0.01);
        currentSeed = floor(time * timeStep * 10.0) + Seed;
    }

    // Global Pixelation (Applied to the base texture sampling)
    vec2 globalUV = uv;
    if (Global_Pixelate > 0.5) {
        float gSize = max(Global_Pix_Size, 1.0);
        globalUV = floor(uv * resolution / gSize) * gSize / resolution;
    }
    
    vec4 baseColor = texture2D(tDiffuse, globalUV);
    float luma = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
    
    // Luma Gating
    float gate = 1.0;
    float thresh = Threshold / 100.0;
    float feather = Feather / 100.0;
    
    if (Invert > 0.5) {
        gate = smoothstep(thresh + feather, thresh - feather, luma);
    } else {
        gate = smoothstep(thresh - feather, thresh + feather, luma);
    }
    
    // Block Corruption
    vec4 corruptColor = baseColor;
    float blockMask = 0.0;
    
    if (Enable > 0.5) {
        float bSize = max(Block_Size, 1.0);
        float aspect = max(Block_Aspect, 0.01); 
        
        float bx = bSize;
        float by = bSize;
        
        int shape = int(Block_Shape);
        
        // Determine dimensions based on Shape and Aspect
        if (shape == 0) { 
            // Square: Aspect scales width
            bx = bSize * aspect;
            by = bSize; 
        } else if (shape == 1) { 
            // H-Strips: Full width, height scaled by aspect
            bx = resolution.x;
            by = bSize * aspect; 
        } else if (shape == 2) { 
            // V-Columns: Full height, width scaled by aspect
            bx = bSize * aspect;
            by = resolution.y;
        } else if (shape == 3) { 
            // Mixed: Randomly choose H or V based on a base grid
            vec2 baseID = floor(uv * resolution / bSize);
            float rMix = random(baseID, currentSeed);
            if (rMix > 0.5) {
                bx = resolution.x;
                by = bSize * aspect;
            } else {
                bx = bSize * aspect;
                by = resolution.y;
            }
        }
        
        // Calculate blockID with the final dimensions
        vec2 blockID = floor(uv * resolution / vec2(bx, by));
        
        // Random for corruption decision
        float r = random(blockID, currentSeed);
        float corruptThreshold = Corrupt_Amount / 100.0;
        
        if (r < corruptThreshold) {
            blockMask = 1.0;
            
            // Displacement
            float dx = (random(blockID + 100.0, currentSeed) - 0.5) * Displacement_X * 2.0;
            float dy = (random(blockID + 200.0, currentSeed) - 0.5) * Displacement_Y * 2.0;
            
            // Jitter
            dx += (random(blockID + 300.0, currentSeed) - 0.5) * Block_Jitter * 2.0;
            dy += (random(blockID + 400.0, currentSeed) - 0.5) * Block_Jitter * 2.0;
            
            vec2 corruptUV = uv + vec2(dx, dy) * texelSize;
            
            vec4 sampledColor;
            
            // RGB Split (Applied INSIDE the box)
            if (RGB_Enable > 0.5) {
                // Base UV for sampling (apply Pixelate Blocks if needed)
                vec2 baseUV = corruptUV;
                if (Pixelate_Blocks > 0.0) {
                    float pSize = max(Pixelate_Blocks, 1.0);
                    baseUV = floor(corruptUV * resolution / pSize) * pSize / resolution;
                }
                
                // Calculate RGB offsets
                vec2 rUV = baseUV + vec2(Red_Offset_X, Red_Offset_Y) * texelSize;
                vec2 gUV = baseUV + vec2(Green_Offset_X, Green_Offset_Y) * texelSize;
                vec2 bUV = baseUV + vec2(Blue_Offset_X, Blue_Offset_Y) * texelSize;
                
                // Apply Global Pixelate to RGB UVs (if enabled)
                if (Global_Pixelate > 0.5) {
                    float gSize = max(Global_Pix_Size, 1.0);
                    rUV = floor(rUV * resolution / gSize) * gSize / resolution;
                    gUV = floor(gUV * resolution / gSize) * gSize / resolution;
                    bUV = floor(bUV * resolution / gSize) * gSize / resolution;
                }
                
                float r_val = texture2D(tDiffuse, rUV).r;
                float g_val = texture2D(tDiffuse, gUV).g;
                float b_val = texture2D(tDiffuse, bUV).b;
                sampledColor = vec4(r_val, g_val, b_val, 1.0);
            } else {
                // Standard Sampling (with Pixelate Blocks)
                vec2 sampleUV = corruptUV;
                if (Pixelate_Blocks > 0.0) {
                    float pSize = max(Pixelate_Blocks, 1.0);
                    sampleUV = floor(corruptUV * resolution / pSize) * pSize / resolution;
                }
                sampledColor = texture2D(tDiffuse, sampleUV);
            }
            
            // Fill Pattern
            vec2 localUV = fract(uv * resolution / vec2(bx, by));
            vec2 centerUV = localUV - 0.5;
            float d = Fill_Density / 100.0;
            float patternMask = 0.0;
            
            int pShape = int(Fill_Pattern);
            
            if (pShape == 0) { // Solid
                patternMask = 1.0;
            } else if (pShape == 1) { // Cross
                float t = 0.1 + d * 0.4;
                if (abs(centerUV.x) < t * 0.5 || abs(centerUV.y) < t * 0.5) patternMask = 1.0;
            } else if (pShape == 2) { // Diamond
                float dist = abs(centerUV.x) + abs(centerUV.y);
                if (dist < d * 0.7) patternMask = 1.0;
            } else if (pShape == 3) { // Checkerboard
                float grid = max(2.0, floor(10.0 * (1.0 - d * 0.8)));
                float cx = floor(localUV.x * grid);
                float cy = floor(localUV.y * grid);
                patternMask = mod(cx + cy, 2.0);
            } else if (pShape == 4) { // Dot
                float dist = length(centerUV);
                if (dist < d * 0.4) patternMask = 1.0;
            } else if (pShape == 5) { // Outline
                float t = 0.05 + (1.0 - d) * 0.2;
                if (localUV.x < t || localUV.x > 1.0 - t || localUV.y < t || localUV.y > 1.0 - t) {
                    patternMask = 1.0;
                }
            } else if (pShape == 6) { // Scatter
                float scatterR = random(floor(localUV * 50.0), currentSeed);
                if (scatterR < d) patternMask = 1.0;
            }
            
            // Edge Decay
            float edge = 1.0;
            if (Edge_Decay > 0.0) {
                float decay = Edge_Decay / 100.0;
                float distX = min(localUV.x, 1.0 - localUV.x);
                float distY = min(localUV.y, 1.0 - localUV.y);
                float minDist = min(distX, distY);
                edge = smoothstep(0.0, decay, minDist);
            }
            
            corruptColor = sampledColor * patternMask * edge;
        }
    }
    
    // Final Color (corruptColor contains baseColor where not corrupted)
    vec4 finalColor = corruptColor;
    
    // Output Mode Logic
    vec4 outputColor;
    float alpha = Opacity / 100.0;
    
    if (Output_Mode > 0.5 && Output_Mode < 1.5) { // Show Mask
        outputColor = vec4(vec3(blockMask * gate), 1.0);
    } else if (Output_Mode > 1.5) { // Corrupt Only
        outputColor = finalColor * blockMask * gate;
    } else { // Normal
        // Mix baseColor with finalColor based on gate and alpha
        // Since finalColor already contains baseColor in non-corrupted areas,
        // this effectively applies the gate to the corruption.
        outputColor = mix(baseColor, finalColor, gate * alpha);
    }
    
    // Noise (Applied GLOBALLY to the final output)
    if (Noise_Enable > 0.5) {
        float noiseR = random(uv * 100.0, currentSeed + time);
        float noiseVal = (noiseR - 0.5) * 2.0;
        
        float lumNoise = noiseVal * (Luminance_Noise / 100.0);
        outputColor.rgb += lumNoise;
        
        if (Chromatic_Noise > 0.0) {
            float cNoise = Chromatic_Noise / 100.0;
            outputColor.r += (random(uv * 100.0 + 10.0, currentSeed) - 0.5) * cNoise;
            outputColor.g += (random(uv * 100.0 + 20.0, currentSeed) - 0.5) * cNoise;
            outputColor.b += (random(uv * 100.0 + 30.0, currentSeed) - 0.5) * cNoise;
        }
    }
    
    gl_FragColor = outputColor;
}
