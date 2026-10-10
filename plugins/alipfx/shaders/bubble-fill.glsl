precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform vec2 uvScale;

// 19 Custom Parameters
uniform float Density;
uniform float Minimum_Radius;
uniform float Maximum_Radius;
uniform float Randomness;
uniform float Size_Bias;
uniform float Reveal;
uniform float Growth;
uniform float Matte_Threshold;
uniform float Seed;
uniform float Draw_Mode;
uniform float Shape;
uniform float Noise_Distortion;
uniform float Centerline_Bias;
uniform float Gap_Fill;
uniform float Edge_Suppression;
uniform vec3 Fill_Color;
uniform vec3 Stroke_Color;
uniform float Stroke_Width;
uniform float Matte_Mode;

// Pseudo-random hash functions
vec2 hash2(vec2 p, float seed) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + seed;
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p, float seed) {
    return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

// Organic distortion based on sine waves to emulate hand-drawn feel
vec2 organicDistortion(vec2 p, float amount, float seed) {
    float n1 = sin(p.x * 0.05 + seed) * cos(p.y * 0.05 - seed);
    float n2 = cos(p.x * 0.04 - seed) * sin(p.y * 0.06 + seed);
    return vec2(n1, n2) * amount;
}

void main() {
    vec2 px = vUv * resolution;

    // 9. Shape & 10. Noise Distortion
    if (Shape > 0.5 && Noise_Distortion > 0.0) {
        px += organicDistortion(px, Noise_Distortion, Seed);
    }

    // 1. Density Mapping
    // Determines grid size to tightly pack bubbles relative to max radius
    float densityFactor = clamp(3000.0 / max(Density, 1.0), 0.1, 5.0);
    float cellSize = max(Maximum_Radius * 1.2 * densityFactor, Minimum_Radius * 1.1);
    cellSize = max(cellSize, 2.0); 

    vec2 gridPos = px / cellSize;
    vec2 id = floor(gridPos);

    vec4 resultColor = vec4(0.0);
    float bestZ = -1.0;
    bool hit = false;

    // Search neighboring cells to evaluate overlapping bubbles
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 cellId = id + g;

            float localSeed = Seed + 1.0;

            // 4. Randomness (Position variation)
            vec2 randPos = hash2(cellId, localSeed);
            vec2 offset = (randPos - 0.5) * (Randomness * 0.01) * 2.0;
            vec2 centerPx = (cellId + 0.5 + offset) * cellSize;
            vec2 centerUv = centerPx / resolution;
            
            if (centerUv.x < 0.0 || centerUv.x > 1.0 || centerUv.y < 0.0 || centerUv.y > 1.0) continue;

            // Evaluate original layer matte at the bubble's center
            vec2 mappedUv = centerUv * uvScale;
            vec4 centerTex = texture2D(tDiffuse, mappedUv);
            
            // 17. Matte Mode
            float matte = Matte_Mode > 0.5 ? dot(centerTex.rgb, vec3(0.299, 0.587, 0.114)) : centerTex.a;

            // 8. Matte Threshold
            if (matte < (Matte_Threshold * 0.01)) continue;

            // 11. Centerline Bias
            // Pulls offsets closer to center based on matte strength
            offset *= mix(1.0, smoothstep(0.0, 1.0, matte), Centerline_Bias * 0.01);
            centerPx = (cellId + 0.5 + offset) * cellSize;

            // 5. Reveal (Keyframeable birth mechanism)
            float revealHash = hash1(cellId, localSeed + 12.34);
            if (revealHash > (Reveal * 0.01)) continue;

            // 2. & 3. Radius computation
            float radHash = hash1(cellId, localSeed + 56.78);
            
            // Size Bias logic (Curve the random distribution)
            float biasPower = mix(3.0, 0.33, Size_Bias * 0.01);
            radHash = pow(radHash, biasPower);
            
            float rad = mix(Minimum_Radius, Maximum_Radius, radHash);

            // 6. Growth
            rad *= (Growth * 0.01);

            // 13. Edge Suppression
            if (Edge_Suppression > 0.0) {
                float edgeFactor = smoothstep(0.0, 1.0, matte);
                rad *= mix(1.0, edgeFactor, Edge_Suppression * 0.01);
            }

            // 12. Gap Fill
            rad *= 1.0 + (Gap_Fill * 0.01 * 0.5);

            float dist = distance(px, centerPx);

            if (dist < rad) {
                // Determine Z-Index to allow stable overlaps
                float zIndex = hash1(cellId, localSeed + 34.56);
                
                if (zIndex > bestZ) {
                    hit = true;
                    // 8. Draw Mode
                    if (Draw_Mode < 0.5) { 
                        // Stroke Mode
                        if (rad - dist <= Stroke_Width) {
                            resultColor = vec4(Stroke_Color, 1.0);
                        } else {
                            // Transparent interior, but occludes bubbles beneath it
                            resultColor = vec4(0.0); 
                        }
                    } else { 
                        // Fill Mode
                        resultColor = vec4(Fill_Color, 1.0);
                    }
                    bestZ = zIndex;
                }
            }
        }
    }

    // Output formatting: masks out everything except the generated bubbles
    if (hit) {
        if (resultColor.a > 0.0) {
            gl_FragColor = resultColor;
        } else {
            gl_FragColor = vec4(0.0);
        }
    } else {
        gl_FragColor = vec4(0.0);
    }
}
