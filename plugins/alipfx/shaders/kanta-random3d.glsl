precision highp float;
precision highp int;

// Built-in Panzoid variables
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

// Kanta Random3D Custom Properties
uniform float Count;
uniform float Random_Seed;
uniform float Spread_X;
uniform float Spread_Y;
uniform float Spread_Z;
uniform float Scale_Min;
uniform float Scale_Max;
uniform float Rotation_X;
uniform float Rotation_Y;
uniform float Rotation_Z;
uniform float Opacity_Min;
uniform float Focal_Length;
uniform float Evolution;

// Pseudo-random hash function
float hash2(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Generates smooth continuous noise based on Evolution
float getNoise(float seed, float index, float param, float evolution) {
    float evo = evolution / 360.0;
    float iEvo = floor(evo);
    // Smoothstep ensures the transition between random states is completely seamless
    float fEvo = smoothstep(0.0, 1.0, fract(evo));

    // Generate two distinct states to blend between
    vec2 p1 = vec2(seed + index * 12.345 + param * 76.543, iEvo * 13.579);
    vec2 p2 = vec2(seed + index * 12.345 + param * 76.543, (iEvo + 1.0) * 13.579);

    return mix(hash2(p1), hash2(p2), fEvo);
}

// 3D Rotation helper functions
vec3 rotateX(vec3 v, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}
vec3 rotateY(vec3 v, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
vec3 rotateZ(vec3 v, float angle) {
    float s = sin(angle), c = cos(angle);
    return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}
vec3 rotateEuler(vec3 v, vec3 angles) {
    // Apply rotations in Z-Y-X order
    return rotateZ(rotateY(rotateX(v, angles.x), angles.y), angles.z);
}

void main() {
    // Center pixel coordinates for 3D camera mapping
    vec2 pixelCoord = (vUv - 0.5) * resolution;
    
    // Prevent Division by Zero if Focal Length is dropped to 0
    float focalDist = max(Focal_Length, 1.0);

    // Setup Camera Ray
    vec3 ro = vec3(0.0, 0.0, -focalDist);
    vec3 rd = normalize(vec3(pixelCoord.x, pixelCoord.y, focalDist));

    vec4 finalColor = vec4(0.0);
    float minDepth = 9999999.0;

    // WebGL1 requires constant upper limits for loops in fragment shaders. 
    // 500 is a safe maximum for performance. The loop will break early based on your "Count" property.
    const int MAX_CARDS = 500;

    for (int i = 0; i < MAX_CARDS; i++) {
        if (float(i) >= Count) break;
        float fi = float(i);

        // 1. Calculate Transforms using the Seed & Evolution
        float px = (getNoise(Random_Seed, fi, 1.0, Evolution) * 2.0 - 1.0) * Spread_X;
        float py = (getNoise(Random_Seed, fi, 2.0, Evolution) * 2.0 - 1.0) * Spread_Y;
        float pz = (getNoise(Random_Seed, fi, 3.0, Evolution) * 2.0 - 1.0) * Spread_Z;
        vec3 cardPos = vec3(px, py, pz);

        float scaleRnd = getNoise(Random_Seed, fi, 4.0, Evolution);
        float currentScale = mix(Scale_Min, Scale_Max, scaleRnd) / 100.0;

        // Multiply by 0.0174533 to convert degrees to radians
        float rx = (getNoise(Random_Seed, fi, 5.0, Evolution) * 2.0 - 1.0) * Rotation_X * 0.0174533;
        float ry = (getNoise(Random_Seed, fi, 6.0, Evolution) * 2.0 - 1.0) * Rotation_Y * 0.0174533;
        float rz = (getNoise(Random_Seed, fi, 7.0, Evolution) * 2.0 - 1.0) * Rotation_Z * 0.0174533;
        vec3 cardRot = vec3(rx, ry, rz);

        float opRnd = getNoise(Random_Seed, fi, 8.0, Evolution);
        float currentOpacity = mix(Opacity_Min, 100.0, opRnd) / 100.0;

        // 2. Define Card Bounds and Spatial Vectors
        float hw = (resolution.x * currentScale) * 0.5;
        float hh = (resolution.y * currentScale) * 0.5;

        vec3 right = rotateEuler(vec3(hw, 0.0, 0.0), cardRot);
        vec3 up = rotateEuler(vec3(0.0, hh, 0.0), cardRot);
        vec3 normal = normalize(cross(right, up));

        // 3. Ray-Plane Intersection (Calculating Camera perspective into 3D Space)
        float denom = dot(normal, rd);
        if (abs(denom) > 0.0001) {
            float t = dot(normal, cardPos - ro) / denom;

            // 4. Hit testing and Z-Sorting
            if (t > 0.0 && t < minDepth) {
                vec3 localHit = (ro + t * rd) - cardPos;

                float u = dot(localHit, right) / dot(right, right);
                float v = dot(localHit, up) / dot(up, up);

                // If Ray intersects within the bounds of the card
                if (abs(u) <= 1.0 && abs(v) <= 1.0) {
                    vec2 texUV = vec2(u * 0.5 + 0.5, v * 0.5 + 0.5);
                    
                    // Sample input layer applying uvScale to respect Panzoid buffer mapping
                    vec4 texColor = texture2D(tDiffuse, texUV * uvScale);
                    texColor.a *= currentOpacity;

                    // Alpha cutout evaluation (This correctly Z-sorts transparent layers)
                    if (texColor.a > 0.01) {
                        minDepth = t;
                        finalColor = texColor;
                    }
                }
            }
        }
    }

    // Output calculated pixel
    gl_FragColor = finalColor;
}
