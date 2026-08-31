precision highp float;
precision highp int;

// Built-in Panzoid uniforms
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

// Built-in Panzoid varyings
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom dynamic properties (Create these in your Panzoid properties menu)
uniform float Hatch_Density;     // Recommended range: 0.2 to 1.5
uniform float Outline_Strength;  // Recommended range: 1.0 to 5.0
uniform float Shading_Darkness;  // Recommended range: 0.5 to 1.5

// Helper function to calculate the brightness (luminance) of a pixel
float getLuminance(vec2 uv) {
    vec4 color = texture2D(tDiffuse, uv);
    return dot(color.rgb, vec3(0.299, 0.587, 0.114));
}

void main()
{
    // Calculate 1-pixel step size mapping correctly onto Panzoid's buffer coordinate system
    vec2 st = uvScale / resolution;
    
    // 3x3 Grid Sampling for Sobel Edge Detection (Outlines)
    float l00 = getLuminance(vUvScaled + vec2(-st.x, -st.y));
    float l10 = getLuminance(vUvScaled + vec2(0.0, -st.y));
    float l20 = getLuminance(vUvScaled + vec2(st.x, -st.y));
    float l01 = getLuminance(vUvScaled + vec2(-st.x, 0.0));
    float l21 = getLuminance(vUvScaled + vec2(st.x, 0.0));
    float l02 = getLuminance(vUvScaled + vec2(-st.x, st.y));
    float l12 = getLuminance(vUvScaled + vec2(0.0, st.y));
    float l22 = getLuminance(vUvScaled + vec2(st.x, st.y));

    // Sobel kernels for horizontal and vertical edge gradients
    float sobX = l00 + 2.0 * l01 + l02 - l20 - 2.0 * l21 - l22;
    float sobY = l00 + 2.0 * l10 + l20 - l02 - 2.0 * l12 - l22;
    float edge = sqrt(sobX * sobX + sobY * sobY);
    
    // Scale edge detection by your custom property strength
    float outline = smoothstep(0.1, 0.4, edge * Outline_Strength);

    // Get current fragment center luminance
    float currentLum = l10; // re-use center-top or l11 for center
    currentLum = getLuminance(vUvScaled);

    // Convert normalized screenspace UV to absolute pixel positions for noise lines
    vec2 pixelPos = vUv * resolution;

    // Create pencil-like hatching strokes using clean periodic wave frequencies
    float density = Hatch_Density > 0.0 ? Hatch_Density : 0.6;
    float line1 = abs(sin((pixelPos.x + pixelPos.y) * density));
    float line2 = abs(sin((pixelPos.x - pixelPos.y) * density));

    // Classical "Take On Me" background/paper colors (Light slate blue-gray paper)
    vec3 paperColor = vec3(0.84, 0.89, 0.94); 
    vec3 graphiteColor = vec3(0.12, 0.16, 0.22); // Dark sketch charcoal pencil ink

    // Determine shading based on luminance levels (cross-hatching thresholding)
    float sketchFactor = 1.0;

    // Mid-tones: Apply first diagonal pencil strokes
    if (currentLum < 0.75) {
        if (line1 < 0.25) {
            sketchFactor *= mix(1.0, currentLum, Shading_Darkness);
        }
    }
    // Shadows: Cross-hatch with opposing diagonal lines
    if (currentLum < 0.45) {
        if (line2 < 0.3) {
            sketchFactor *= mix(1.0, currentLum * 0.8, Shading_Darkness);
        }
    }
    // Deep Shadows: Fill in solid dark graphite spots
    if (currentLum < 0.18) {
        sketchFactor *= 0.4;
    }

    // Force outlines to be drawn as dark pencil ink lines
    sketchFactor = mix(sketchFactor, 0.0, outline);

    // Mix final pencil shading with the background sketch paper tint
    vec3 finalColor = mix(graphiteColor, paperColor, sketchFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}
