precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom Panzoid Properties
uniform float Sepia_Strength;
uniform float Ink_Tone;
uniform float Tint_Density;
uniform float Print_Definition;

void main()
{
    // Sample the original input layer
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    // 1. Calculate the base Luma (Grayscale)
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    
    // 2. Define the Specific Ink Tones
    vec3 toneStandard = vec3(1.0, 0.82, 0.62);  // Classic Warm Sepia
    vec3 toneGold     = vec3(1.0, 0.65, 0.75);  // Pinkish Rose
    vec3 toneCopper   = vec3(0.70, 0.95, 0.60); // Greenish Olive
    
    // 3. Strict conditional check to prevent color bleeding
    vec3 currentTone;
    if (Ink_Tone < 0.5) {
        currentTone = toneStandard; // Applies to 0 (Standard)
    } else if (Ink_Tone >= 0.5 && Ink_Tone < 1.5) {
        currentTone = toneGold;     // Applies to 1 (Gold)
    } else {
        currentTone = toneCopper;   // Applies to 2 (Copper)
    }
    
    // 4. Apply Tint Density (Depth of the chemical dye)
    float densityPower = mix(0.4, 1.4, Tint_Density);
    vec3 sepiaBase = pow(vec3(luma), vec3(densityPower)) * currentTone;
    
    // Boost saturation/brightness slightly at higher densities
    sepiaBase *= mix(0.85, 1.2, Tint_Density);
    
    // 5. Apply Print Definition (Paper grade / hardness)
    float contrast = mix(0.5, 1.1, Print_Definition);
    vec3 printedColor = (sepiaBase - 0.5) * contrast + 0.5;
    
    // Lift the black levels for lower print definitions to simulate faded paper
    float blackLift = mix(0.15, 0.0, Print_Definition);
    printedColor += blackLift;
    
    // Clamp the final processed color
    printedColor = clamp(printedColor, 0.0, 1.0);
    
    // 6. Apply Sepia Strength
    vec3 finalColor = mix(texel.rgb, printedColor, clamp(Sepia_Strength, 0.0, 1.0));
    
    // Output the final pixel
    gl_FragColor = vec4(finalColor, texel.a);
}
