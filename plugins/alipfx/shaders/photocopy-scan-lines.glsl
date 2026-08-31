precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Panzoid Custom Properties
uniform float Exposure;
uniform float Contrast;
uniform float Toner_Crush;
uniform float Line_Strength;
uniform float Line_Density;
uniform float Vertical_Streaks;
uniform float Dust_Paper_Noise;

// Helper: Pseudo-random number generator
float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

// Helper: 2D Value Noise for the streaks
float valueNoise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = rand(i);
    float b = rand(i + vec2(1.0, 0.0));
    float c = rand(i + vec2(0.0, 1.0));
    float d = rand(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    // 1. Sample the base image
    vec4 texColor = texture2D(tDiffuse, vUvScaled);

    // Convert to Grayscale
    float luma = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 color = vec3(luma);

    // --- COLOR CORRECTION ---
    // Apply the warm "Photocopy Paper" tint instead of pure B&W
    vec3 paperTint = vec3(0.96, 0.93, 0.88); // Warm off-white
    vec3 inkTint = vec3(0.12, 0.12, 0.13);   // Slightly faded black
    color = mix(inkTint, paperTint, color);

    // --- TONE SECTION ---
    // Exposure
    color *= max(Exposure, 0.0);

    // Contrast
    color = (color - 0.5) * Contrast + 0.5;

    // Toner Crush (Thresholding midtones)
    float crushMin = Toner_Crush * 0.35;
    float crushMax = 1.0 - (Toner_Crush * 0.35);
    color = smoothstep(crushMin, crushMax, color);

    // --- SCAN TEXTURE SECTION ---

    // 5. Line Density & Strength (Thick Horizontal Bands)
    float lineFreq = Line_Density * 200.0;
    float linePattern = sin(vUv.y * lineFreq);
    // Using smoothstep creates thicker, TV-like bars instead of thin sharp lines
    float lines = smoothstep(-0.3, 0.7, linePattern);
    color -= (1.0 - lines) * Line_Strength * 0.7;

    // 6. Vertical Streaks (Scanner Drag)
    float streaks = valueNoise(vec2(vUv.x * 25.0, vUv.y * 1.5));
    color -= streaks * Vertical_Streaks * 0.4;

    // 7. Dust & Paper Noise (After Effects Style)
    // Base AE-style fine grain
    float aeNoise = rand(vUvScaled * 1000.0); 
    color += (aeNoise - 0.5) * Dust_Paper_Noise * 0.4;

    // Sparse dust specks (Dark and Light dots)
    float speckle = rand(vUv * 150.0);
    if (speckle < 0.015 * Dust_Paper_Noise) {
        color -= 0.8; // Dark dust
    } else if (speckle > 1.0 - 0.015 * Dust_Paper_Noise) {
        color += 0.8; // Light paper fibers
    }

    // Clamp to prevent visual artifacts
    color = clamp(color, 0.0, 1.0);

    // Output final composition
    gl_FragColor = vec4(color, texColor.a);
}
