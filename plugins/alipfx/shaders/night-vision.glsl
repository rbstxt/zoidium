precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

uniform vec2 resolution;
// Panzoid's built-in time uniform for animating the noise
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

void main()
{
    // 1. Initial Input Sample
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    // 2. Bloom / Light Glow
    vec3 bloom = vec3(0.0);
    if (Bloom > 0.0) {
        float blurSize = 4.0 / resolution.x;
        for(int i = -2; i <= 2; i++) {
            for(int j = -2; j <= 2; j++) {
                vec2 offset = vec2(float(i), float(j)) * blurSize;
                vec3 tap = texture2D(tDiffuse, vUvScaled + offset).rgb;
                float tapLum = dot(tap, vec3(0.299, 0.587, 0.114));
                bloom += tap * smoothstep(0.4, 1.0, tapLum);
            }
        }
        bloom /= 25.0; 
        texel.rgb += bloom * (Bloom * 3.0); 
    }

    // 3. Gain (Light Amplification & Contrast)
    float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    lum = pow(lum, 1.0 - (Gain * 0.6)); 
    lum *= (1.0 + Gain * 2.5); 
    lum = clamp(lum, 0.0, 1.0);

    // 4. Phosphor Color Gradient Mapping
    vec3 colorShadow, colorMid, colorHigh;
    
    if (Phosphor < 0.5) { 
        // 0: Gen-3 Green
        colorShadow = vec3(0.0, 0.15, 0.0);
        colorMid    = vec3(0.1, 0.8, 0.2);
        colorHigh   = vec3(0.85, 1.0, 0.85);
    } else if (Phosphor < 1.5) { 
        // 1: White Phosphor (Adjusted to match the cold cyan/silver tint)
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

    vec3 finalColor;
    // Map the luminance smoothly across the three colors
    if (lum < 0.5) {
        finalColor = mix(colorShadow, colorMid, lum * 2.0);
    } else {
        finalColor = mix(colorMid, colorHigh, (lum - 0.5) * 2.0);
    }

    // 5. Soft Vignette (Scanlines removed)
    vec2 centerDist = vUv - 0.5;
    float vig = dot(centerDist, centerDist);
    finalColor *= 1.0 - vig * 1.2;

    // 6. Sensor Noise (Scintillation)
    if (Sensor_Noise > 0.0) {
        float n = rand(vUv * (time * 10.0 + 1.0));
        float noiseIntensity = Sensor_Noise * (1.0 - lum * 0.6) * 0.4; 
        finalColor += (n - 0.5) * noiseIntensity;
    }

    // 7. Scope Overlay
    if (Scope_Overlay > 0.5) {
        vec2 centeredUv = vUv - 0.5;
        centeredUv.x *= resolution.x / resolution.y; 
        
        float dist = length(centeredUv);
        
        float scopeMask = 1.0 - smoothstep(0.40, 0.42, dist);
        
        // Scope Crosshairs
        float lineThickness = 0.0015;
        float crossX = 1.0 - smoothstep(0.0, lineThickness, abs(centeredUv.x));
        float crossY = 1.0 - smoothstep(0.0, lineThickness, abs(centeredUv.y));
        float crosshair = max(crossX, crossY) * step(dist, 0.40); 
        
        finalColor = (finalColor * scopeMask) + (crosshair * 0.2 * colorMid);
    }

    // Output final composition
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), texel.a);
}
