precision highp float;
precision highp int;

// Built-in Panzoid Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform vec2 uvScale;

// Custom Effect Uniforms
uniform float Stroke_Angle;
uniform float Brush_Size;
uniform float Stroke_Length;
uniform float Stroke_Density;
uniform float Stroke_Randomness;
uniform float Paint_Surface;
uniform float Blend_With_Original;

// Pseudo-random noise functions for scattering
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

void main() {
    // 1. Sample the original unmodified layer
    vec4 originalColor = texture2D(tDiffuse, vUvScaled);

    // Bypass effect if brush is too small to render
    if (Brush_Size <= 0.5 || Stroke_Length <= 0.01) {
        gl_FragColor = mix(originalColor, originalColor, clamp(Blend_With_Original / 100.0, 0.0, 1.0));
        return;
    }

    // 2. Set Background based on Paint_Surface (0=Original, 1=Transparent, 2=White, 3=Black)
    int surfaceMode = int(Paint_Surface + 0.5);
    vec4 bgColor = originalColor; 
    if (surfaceMode == 1) bgColor = vec4(0.0); 
    else if (surfaceMode == 2) bgColor = vec4(1.0); 
    else if (surfaceMode == 3) bgColor = vec4(0.0, 0.0, 0.0, 1.0);

    // 3. Prepare Stroke Angle Matrix (Convert to radians)
    float angle = radians(Stroke_Angle);
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, -s, s, c);
    mat2 invRot = mat2(c, s, -s, c);

    // 4. Calculate Pixel Space and Grid 
    vec2 pos = vUv * resolution;
    vec2 rotatedPos = rot * pos;

    // Density controls grid spacing (higher density = tighter grid/more dabs)
    float densityFactor = max(0.1, Stroke_Density);
    float spacing = max(1.0, Brush_Size / densityFactor);

    float halfWidth = max(1.0, Brush_Size * 0.5);
    float halfLength = max(1.0, halfWidth * Stroke_Length);

    vec4 paintedColor = vec4(0.0);
    float highestZ = -1.0;

    // Calculate maximum required search bounds dynamically to skip useless loop iterations
    // This allows the stroke to reach length 40 without burning out the GPU
    float maxSearchY = ceil((halfLength / spacing) + 1.0);
    float maxSearchX = ceil((halfWidth / spacing) + 1.0);

    // 5. Asymmetric Grid Search (Expanded Y-axis to accommodate stroke lengths up to ~40+)
    for (float y = -20.0; y <= 20.0; y++) {
        // GPU optimization: Early exit if the grid cell is too far up/down the stroke length
        if (abs(y) > maxSearchY) continue;

        for (float x = -3.0; x <= 3.0; x++) {
            // GPU optimization: Early exit if the grid cell is too far beside the stroke width
            if (abs(x) > maxSearchX) continue;
            
            // Identify current grid cell
            vec2 gridPos = floor(rotatedPos / spacing) + vec2(x, y);
            vec2 cellCenter = (gridPos + 0.5) * spacing;

            // Apply Stroke Randomness
            vec2 randomOffset = (hash2(gridPos) - 0.5) * spacing * Stroke_Randomness * 1.5;
            vec2 strokeCenter = cellCenter + randomOffset;

            // Distance from fragment to stroke dab center
            vec2 delta = rotatedPos - strokeCenter;

            // Oval distance check (creates the directional "dab" shape)
            float distSq = (delta.x * delta.x) / (halfWidth * halfWidth) +
                           (delta.y * delta.y) / (halfLength * halfLength);

            if (distSq <= 1.0) {
                // Soften stroke edges for a natural paint texture
                float alpha = smoothstep(1.0, 0.7, distSq);

                // Sample the color from the center of the stroke to mimic AE's color pulling
                vec2 samplePos = invRot * strokeCenter;
                vec2 sampleUv = samplePos / resolution;

                // Clamp UVs to avoid edge bleeding
                if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
                    
                    // Z-Ordering using hash so random dabs render "on top"
                    float zOrder = hash(gridPos + 12.34);
                    if (zOrder > highestZ) {
                        highestZ = zOrder;
                        
                        // Scale UVs accurately for Panzoid's buffer system
                        vec2 sampleUvScaled = sampleUv * uvScale;
                        vec3 sampledTex = texture2D(tDiffuse, sampleUvScaled).rgb;
                        paintedColor = vec4(sampledTex, alpha);
                    }
                }
            }
        }
    }

    // 6. Apply Paint Surface Logic
    vec4 finalEffectColor = bgColor;
    if (paintedColor.a > 0.0) {
        // Blend stroke over background
        finalEffectColor = vec4(mix(bgColor.rgb, paintedColor.rgb, paintedColor.a), max(bgColor.a, paintedColor.a));
    }

    // 7. Blend With Original (0% = Full Paint, 100% = Original Image)
    float blendFactor = clamp(Blend_With_Original / 100.0, 0.0, 1.0);
    gl_FragColor = mix(finalEffectColor, originalColor, blendFactor);
}
