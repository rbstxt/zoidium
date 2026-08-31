precision highp float;
precision highp int;

// Core Panzoid Uniforms
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// --- User Parameters (Create these 10 properties in Panzoid) ---
uniform float Intensity;          // 1. Intensity
uniform vec2 Center;              // 2. Center (pixels)
uniform float Radius;             // 3. Radius
uniform float Warp_Softness;      // 4. Warp Softness
uniform int Shape;                // 5. Shape (0 Round, 1 Square)
uniform float Direction;          // 6. Direction
uniform int Color_from_Source;    // 7. Color from Source (0/1)
uniform int Allow_Brightening;    // 8. Allow Brightening (0/1)
uniform vec3 Color;               // 9. Color
uniform int Transfer_Mode;        // 10. Transfer Mode (0..3)

#define SAMPLES 64

// Helper function to calculate the shape mask (your original, with safe softness clamp)
float getShapeMask(vec2 samplePosPx, vec2 centerPx, float r, float softness, int shapeType, float angle) {
    vec2 p = samplePosPx - centerPx;
    float dist = 0.0;

    if (shapeType == 0) {
        dist = length(p);
    } else {
        float rad = radians(angle);
        float s = sin(rad);
        float c = cos(rad);
        vec2 pRot = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        dist = max(abs(pRot.x), abs(pRot.y));
    }

    // Clamp softness so smoothstep range is valid
    float soft = clamp(softness, 0.0, max(r, 0.0));
    return 1.0 - smoothstep(r - soft, r, dist);
}

// NEW: distance-to-shape (Round/Square) in pixels
float getShapeDist(vec2 posPx, vec2 centerPx, int shapeType, float angle) {
    vec2 p = posPx - centerPx;

    if (shapeType == 0) {
        return length(p);
    } else {
        float rad = radians(angle);
        float s = sin(rad);
        float c = cos(rad);
        vec2 pRot = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        return max(abs(pRot.x), abs(pRot.y));
    }
}

void main() {
    // Current pixel coordinate in UV (0-1) (your original approach)
    vec2 uv = vUvScaled;

    // Convert Center from Pixel coordinates to UV space for direction calculation
    vec2 centerUV = Center / resolution;

    // Calculate vector from current pixel TO the center
    vec2 dir = centerUV - uv;

    // Step size for the loop
    vec2 delta = dir / float(SAMPLES);

    // Ray accumulation
    vec3 accColor = vec3(0.0);
    vec2 sampleUV = uv;

    // Loop to trace the light path
    for(int i = 0; i < SAMPLES; i++) {
        sampleUV += delta;

        vec4 sampleTex = texture2D(tDiffuse, sampleUV);
        vec3 sampleLight = sampleTex.rgb;

        // Apply "Color from Source" Logic
        if (Color_from_Source == 0) {
            float luma = dot(sampleLight, vec3(0.299, 0.587, 0.114));
            sampleLight = Color * luma;
        }

        // Mask in pixel space
        vec2 samplePx = sampleUV * resolution;
        float mask = getShapeMask(samplePx, Center, Radius, Warp_Softness, Shape, Direction);

        // Accumulate
        accColor += sampleLight * mask;
    }

    // Normalize and Intensity Application (your original scaling)
    vec3 rayColor = (accColor / float(SAMPLES)) * (Intensity * 0.05);

    // --- Compositing (Transfer Mode) ---
    vec4 original = texture2D(tDiffuse, uv);
    vec3 finalColor = original.rgb;

    if (Transfer_Mode == 0) {
        finalColor = rayColor; // None: rays only
    } else if (Transfer_Mode == 1) {
        finalColor += rayColor; // Add
    } else if (Transfer_Mode == 2) {
        finalColor = max(finalColor, rayColor); // Lighten
    } else if (Transfer_Mode == 3) {
        finalColor = 1.0 - (1.0 - finalColor) * (1.0 - rayColor); // Screen
    }

    // ✅ AE-TIGHTER "Allow Brightening" behavior:
    // In AE, this toggle mainly affects whether the SOURCE/EMITTER region is allowed to brighten,
    // and it's most relevant when "Color from Source" is ON. [1](https://blog.csdn.net/qq_41176800/article/details/132644702)
    //
    // When OFF: keep the emitter CORE unaltered, but allow feather/rays outside.
    // Core = (Radius - WarpSoftness), matching your smoothstep feather model. [1](https://blog.csdn.net/qq_41176800/article/details/132644702)
    if (Allow_Brightening == 0 && Color_from_Source == 1 && Transfer_Mode != 0) {

        vec2 thisPx = uv * resolution;

        float d = getShapeDist(thisPx, Center, Shape, Direction);

        float soft = clamp(Warp_Softness, 0.0, max(Radius, 0.0));
        float coreR = max(Radius - soft, 0.0);

        // Small smoothing band to avoid jagged edges (≈1px)
        float edge = 1.0;

        // coreMask = 1 inside core, 0 outside
        float coreMask = 1.0 - smoothstep(coreR - edge, coreR + edge, d);

        // Restore original ONLY in the core (prevents source brightening)
        finalColor = mix(finalColor, original.rgb, coreMask);
    }

    // Optional clamp if you still want it (AE doesn't just clamp; it prevents core brightening)
    // Keep your old clamp behavior only if you want extra safety:
    // if (Allow_Brightening == 0) rayColor = clamp(rayColor, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, original.a);
}
