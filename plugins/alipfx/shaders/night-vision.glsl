precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

uniform vec2 resolution;
// Panzoid's uniform for proper layer mapping
uniform vec2 uvScale; 
uniform float time; 

// Custom Properties mapped from Panzoid
uniform float Phosphor;
uniform float Gain;
uniform float Bloom;
uniform float Sensor_Noise;
uniform float Scope_Overlay;

// Pseudo-random noise function
float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

// Function to map luminance to the chosen Phosphor color gradient
vec3 getMappedColor(float lum) {
    vec3 colorShadow, colorMid, colorHigh;
    
    if (Phosphor < 0.5) { 
        // 0: Gen-3 Green
        colorShadow = vec3(0.0, 0.15, 0.0);
        colorMid    = vec3(0.1, 0.8, 0.2);
        colorHigh   = vec3(0.85, 1.0, 0.85);
    } else if (Phosphor < 1.5) { 
        // 1: White Phosphor 
        colorShadow = vec3(0.02, 0.05, 0.08); 
        colorMid    = vec3(0.35, 0.45, 0.55); 
        colorHigh   = vec3(0.95, 0.98, 1.0);  
    } else if (Phosphor < 2.5) { 
        // 2: Amber
        colorShadow = vec3(0.2, 0.05, 0.0);
        colorMid    = vec3(0.8, 0.45, 0.05);
        colorHigh   = vec3(1.0, 0.9, 0.6);
    } else { 
        // 3: Blue Intensifier
        colorShadow = vec3(0.0, 0.05, 0.2);
        colorMid    = vec3(0.1, 0.4, 0.8);
        colorHigh   = vec3(0.8, 0.9, 1.0);
    }

    if (lum < 0.5) {
        return mix(colorShadow, colorMid, lum * 2.0);
    } else {
        return mix(colorMid, colorHigh, (lum - 0.5) * 2.0);
    }
}

// Function to calculate brightness (and bloom) for a specific UV coordinate
float getLuminance(vec2 uv, bool doBloom) {
    vec3 tap = texture2D(tDiffuse, uv).rgb;
    
    if (doBloom && Bloom > 0.0) {
        vec3 bloom = vec3(0.0);
        float blurSize = 4.0 / resolution.x;
        for(int i = -2; i <= 2; i++) {
            for(int j = -2; j <= 2; j++) {
                vec2 offset = vec2(float(i), float(j)) * blurSize;
                vec3 bTap = texture2D(tDiffuse, uv + offset).rgb;
                float tapLum = dot(bTap, vec3(0.299, 0.587, 0.114));
                bloom += bTap * smoothstep(0.4, 1.0, tapLum);
            }
        }
        bloom /= 25.0; 
        tap += bloom * (Bloom * 3.0); 
    }

    float lum = dot(tap, vec3(0.299, 0.587, 0.114));
    lum = pow(lum, 1.0 - (Gain * 0.6)); 
    lum *= (1.0 + Gain * 2.5); 
    return clamp(lum, 0.0, 1.0);
}

void main()
{
    // Aspect-ratio corrected coordinates for the static scope UI
    vec2 centeredUv = vUv - 0.5;
    vec2 aspectUv = centeredUv;
    aspectUv.x *= resolution.x / resolution.y; 
    float dist = length(aspectUv);

    // --- 0. Bulge (Barrel Distortion) ---
    float warpFactor = 1.0;
    if (Scope_Overlay > 0.5) {
        warpFactor = 1.0 - 0.85 * (dist * dist); 
    }
    
    vec2 warpedUv = 0.5 + centeredUv * warpFactor;
    vec2 centerScaled = 0.5 * uvScale;
    vec2 warpedUvScaled = centerScaled + (vUvScaled - centerScaled) * warpFactor;

    // --- 1. Base Phosphor Image (No RGB Separation on Footage) ---
    float lum = getLuminance(warpedUvScaled, true);
    vec3 finalColor = getMappedColor(lum);

    // --- 2. Soft Vignette ---
    vec2 centerDist = warpedUv - 0.5;
    float vig = dot(centerDist, centerDist);
    finalColor *= 1.0 - vig * 1.5;

    // --- 3. Sensor Noise (Scintillation) ---
    if (Sensor_Noise > 0.0) {
        float n = rand(vUv * (time * 10.0 + 1.0));
        float noiseIntensity = Sensor_Noise * (1.0 - lum * 0.6) * 0.4; 
        finalColor += (n - 0.5) * noiseIntensity;
    }

    // --- 4. Scope Overlay & Edge RGB Separation ---
    if (Scope_Overlay > 0.5) {
        // Offset for the red and blue channels on the circle's edge
        float edgeCA = 0.005; 
        
        // Calculate the mask separately for R, G, and B
        float maskR = 1.0 - smoothstep(0.40, 0.42, dist - edgeCA);
        float maskG = 1.0 - smoothstep(0.40, 0.42, dist);
        float maskB = 1.0 - smoothstep(0.40, 0.42, dist + edgeCA);
        
        // Apply separated edge masks
        finalColor.r *= maskR;
        finalColor.g *= maskG;
        finalColor.b *= maskB;
        
        // Scope Crosshairs
        float lineThickness = 0.0015;
        float crossX = 1.0 - smoothstep(0.0, lineThickness, abs(aspectUv.x));
        float crossY = 1.0 - smoothstep(0.0, lineThickness, abs(aspectUv.y));
        float crosshair = max(crossX, crossY) * step(dist, 0.40); 
        
        vec3 crosshairColor = getMappedColor(0.5); 
        
        // Add the crosshair over the masked image
        finalColor += (crosshair * 0.2 * crosshairColor);
    }

    // Output final composition
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
