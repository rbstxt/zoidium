precision highp float;
precision highp int;

// Panzoid Built-in Uniforms
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// Custom Properties
uniform float Preset;
uniform vec3 Ink_Color;
uniform vec3 Paper_Color;
uniform float Pre_Exposure;
uniform float Tone_Contrast;
uniform float Line_Density;
uniform float Contour_Flow;
uniform float Edge_Etching;
uniform float Wear_Tear;

// Pseudo-random noise generator for Wear & Tear
float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    // 1. Fetch Source Pixel
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    // 2. Base Luminance (Grayscale conversion)
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    
    // 3. Pre-Exposure Control
    luma = clamp(luma * (Pre_Exposure * 2.0), 0.0, 1.0);
    
    // 4. Tone Contrast Control
    float contrastFactor = Tone_Contrast * 2.5;
    luma = clamp((luma - 0.5) * contrastFactor + 0.5, 0.0, 1.0);
    
    // 5. Edge Etching Analysis (Sobel Filter approximation)
    vec2 texelSize = 1.0 / resolution;
    float lLeft  = dot(texture2D(tDiffuse, vUvScaled + vec2(-texelSize.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lRight = dot(texture2D(tDiffuse, vUvScaled + vec2(texelSize.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lTop   = dot(texture2D(tDiffuse, vUvScaled + vec2(0.0, texelSize.y)).rgb, vec3(0.299, 0.587, 0.114));
    float lBot   = dot(texture2D(tDiffuse, vUvScaled + vec2(0.0, -texelSize.y)).rgb, vec3(0.299, 0.587, 0.114));
    float edgeVal = sqrt((lRight - lLeft) * (lRight - lLeft) + (lTop - lBot) * (lTop - lBot));
    
    // 6. Contour Flow & Diagonal Line Generation
    float frequency = Line_Density * 350.0; 
    float waveOffset = luma * Contour_Flow * 35.0;
    
    // Calculate diagonal coordinates (45-degree angle rotation)
    float diagonalCoord = (vUvScaled.x + vUvScaled.y) * 0.7071;
    
    // Generate the base line pattern
    float linePattern = sin((diagonalCoord * frequency) + waveOffset);
    // Normalize sine pattern range from [-1, 1] to [0, 1]
    linePattern = (linePattern + 1.0) * 0.5;
    
    // Inversion Fix: Modulate thickness so dark luma generates thick ink lines
    float sharpness = 0.15;
    float finalLine = smoothstep(linePattern - sharpness, linePattern + sharpness, luma);
    
    // Apply Edge Etching boundaries (burns dark lines into high contrast seams)
    finalLine = mix(finalLine, 0.0, clamp(edgeVal * Edge_Etching * 5.0, 0.0, 1.0));
    
    // 7. Wear & Tear (Simulates distressed paper / ink flecks)
    float noise = rand(vUvScaled * resolution.xy);
    if (Wear_Tear > 0.01) {
        float thresholdInk = Wear_Tear * 0.12;
        float thresholdPaper = 1.0 - (Wear_Tear * 0.12);
        if (noise < thresholdInk) {
            finalLine = 0.0; // Ink flecks (Dark)
        } else if (noise > thresholdPaper) {
            finalLine = 1.0; // Paper chips (Light)
        }
    }
    
    // 8. Preset Setup & Color Logic
    vec3 activeInk = Ink_Color;
    vec3 activePaper = Paper_Color;
    
    if (Preset > 0.5 && Preset < 1.5) { 
        // 1: Banknote Green
        activeInk = vec3(0.0392, 0.2275, 0.1569);   
        activePaper = vec3(0.9490, 0.9608, 0.9294); 
    } 
    else if (Preset > 1.5 && Preset < 2.5) { 
        // 2: Copperplate
        activeInk = vec3(0.1490, 0.0824, 0.0510);   
        activePaper = vec3(0.9686, 0.9490, 0.9098); 
    } 
    else if (Preset > 2.5 && Preset < 3.5) { 
        // 3: Steel Etching
        activeInk = vec3(0.0706, 0.0941, 0.1412);   
        activePaper = vec3(0.9098, 0.9176, 0.9020); 
    } 
    else if (Preset > 3.5 && Preset < 4.5) { 
        // 4: Carmine Stamp
        activeInk = vec3(0.3490, 0.0431, 0.0902);   
        activePaper = vec3(1.0000, 0.9608, 0.9608); 
    }

    // 9. Output Composite Layer
    vec3 composition = mix(activeInk, activePaper, finalLine);
    gl_FragColor = vec4(composition, texel.a);
}
