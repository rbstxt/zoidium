precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale; // Required by Panzoid for correct UV mapping

uniform float Scatter;        // -10000 to 10000
uniform float Right_Twist;    // degrees
uniform float Left_Twist;     // degrees
uniform float Transfer_Mode;  // 0..3

varying vec2 vUv; // Base UV coordinates (0.0 to 1.0)
varying vec2 vUvScaled; 

/* ===== Hash for Scatter ===== */
float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

void main() {
    // ALWAYS use vUv for math involving the center
    vec2 uv = vUv;
    vec2 pos = uv - 0.5; // Center coordinates around (0,0)

    /* ---------- 1. Calculate Continuous 3D Helix Twist ---------- */
    float twistDeg = 0.0;
    if (pos.x >= 0.0) {
        twistDeg = Right_Twist * (pos.x * 2.0);
    } else {
        // Natural negative angle for the left side to create a continuous helix
        twistDeg = Left_Twist * (pos.x * 2.0); 
    }
    
    float angle = radians(twistDeg);
    float s = sin(angle);
    float c = cos(angle);

    /* ---------- 2. Inverse 3D Perspective Mapping ---------- */
    float D = 1.5; // Camera depth (Controls the perspective distortion)
    float denom = D * c - pos.y * s;
    
    vec2 originalUV = uv;
    float outOfBounds = 0.0;

    // Prevent division by zero (horizon line artifacts)
    if (abs(denom) > 0.0001) {
        
        // Find the original Y coordinate before 3D projection
        float v = (pos.y * D) / denom;
        
        // Reconstruct Z depth to find the perspective projection factor (P)
        float z = v * s;
        
        // Hide pixels that rotate behind the camera lens
        if (D + z <= 0.0) {
            outOfBounds = 1.0;
        } else {
            float P = D / (D + z);
            
            // Find the original X coordinate before projection
            float u = pos.x / P;
            
            originalUV = vec2(u, v) + 0.5;
            
            // Discard pixels that are pulled in from outside the texture's original boundaries
            if (originalUV.x < 0.0 || originalUV.x > 1.0 || originalUV.y < 0.0 || originalUV.y > 1.0) {
                outOfBounds = 1.0;
            }
        }
    } else {
        outOfBounds = 1.0; 
    }

    /* ---------- 3. Infinite Scatter ---------- */
    // Apply noise in the original UV space so the scatter correctly follows the 3D twist
    vec2 seed = originalUV * resolution;
    vec2 noise = vec2(hash(seed), hash(seed + 41.0)) - 0.5;
    
    // Scale down the massive -10000 to 10000 range so it maps cleanly to UV space.
    // 10000 * 0.0001 = 1.0 (Full screen maximum offset)
    vec2 scatterOffset = noise * (Scatter * 0.0001); 
    
    vec2 finalUV = originalUV + scatterOffset;

    /* ---------- 4. Output Mapping ---------- */
    // Apply uvScale exactly when sampling to satisfy Panzoid layer rules
    vec4 col = texture2D(tDiffuse, finalUV * uvScale);
    
    // Mask out pixels beyond the 3D rotation edges
    if (outOfBounds > 0.5) {
        col = vec4(0.0); 
    }

    /* ---------- 5. Transfer Modes ---------- */
    vec4 outCol;
    int mode = int(Transfer_Mode + 0.5);
    
    // Fetch the original un-scattered/un-twisted pixel to blend against
    vec4 baseCol = texture2D(tDiffuse, uv * uvScale);

    if (mode == 1) { // 1 = Screen
        outCol.rgb = 1.0 - (1.0 - baseCol.rgb) * (1.0 - col.rgb);
        outCol.a = max(baseCol.a, col.a);
    } else if (mode == 2) { // 2 = Add
        outCol.rgb = baseCol.rgb + col.rgb;
        outCol.a = max(baseCol.a, col.a);
    } else if (mode == 3) { // 3 = Alpha Add
        outCol.rgb = baseCol.rgb + col.rgb;
        outCol.a = clamp(baseCol.a + col.a, 0.0, 1.0); // Adds the alphas together
    } else { // 0 = Composite (Normal replacement)
        outCol = col;
    }

    gl_FragColor = clamp(outCol, 0.0, 1.0);
}
