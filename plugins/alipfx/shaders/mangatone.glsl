precision highp float;
precision highp int;

// Uniforms provided by Panzoid
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

// Variables passed from Panzoid Vertex Shader
varying vec2 vUvScaled;
varying vec2 vUv;

// === Custom Parameters ===
// Input Adjustment
uniform float Contrast;
uniform float Tone_Curve_Gamma;

// Outline
uniform int Outline_Enable;
uniform float Outline_Threshold;
uniform float Outline_Strength;
uniform float Outline_Fill_Radius;
uniform float Lines_Dark_Fill_Threshold;

// Tone General
uniform int Pattern_Type;
uniform float Tone_Levels;
uniform int Solid_Black_Enable;
uniform float Solid_Black_Threshold;
uniform int Solid_White_Enable;
uniform float Solid_White_Threshold;
uniform int Gradient_Boundaries;
uniform float Gradient_Smoothness;
uniform float Pattern_Size;
uniform float Tone_Rotation;
uniform int Background_Alpha;
uniform float Background_Opacity;
uniform int Alpha_Ink_Color;

// --- INVERTED DOT PARAMETERS ---
// 1.0 = Enable inverted dots in dark areas, 0.0 = Disable
uniform float Invert_Pattern_Enable; 
// Luminance threshold below which the pattern inverts (e.g., 0.3)
uniform float Invert_Pattern_Threshold; 

// Stages
uniform float Tone_Coeff_1;
uniform float Upper_Boundary_1;
uniform float Tone_Coeff_2;
uniform float Upper_Boundary_2;
uniform float Tone_Coeff_3;
uniform float Upper_Boundary_3;
uniform float Tone_Coeff_4;

// Helper: Calculate Luminance
float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

// Helper: 2D Rotation Matrix
mat2 rotate2d(float _angle) {
    return mat2(cos(_angle), -sin(_angle),
                sin(_angle), cos(_angle));
}

// Helper: Sobel Edge Detection
float sobelEdge(sampler2D tex, vec2 uv, vec2 res, float radius) {
    vec2 step = radius / res;
    
    // Kernel
    float tL = luminance(texture2D(tex, uv + vec2(-step.x, step.y)).rgb);
    float tC = luminance(texture2D(tex, uv + vec2(0.0, step.y)).rgb);
    float tR = luminance(texture2D(tex, uv + vec2(step.x, step.y)).rgb);
    
    float mL = luminance(texture2D(tex, uv + vec2(-step.x, 0.0)).rgb);
    float mR = luminance(texture2D(tex, uv + vec2(step.x, 0.0)).rgb);
    
    float bL = luminance(texture2D(tex, uv + vec2(-step.x, -step.y)).rgb);
    float bC = luminance(texture2D(tex, uv + vec2(0.0, -step.y)).rgb);
    float bR = luminance(texture2D(tex, uv + vec2(step.x, -step.y)).rgb);
    
    // Sobel Masks
    float x = tL + 2.0*mL + bL - tR - 2.0*mR - bR;
    float y = tL + 2.0*tC + tR - bL - 2.0*bC - bR;
    
    return sqrt(x*x + y*y);
}

// Helper: Generate Halftone Pattern
float getPattern(vec2 uv, int type, float size, float angle) {
    vec2 st = uv;
    // Normalize coordinates based on screen aspect ratio
    float aspect = resolution.x / resolution.y;
    st.x *= aspect;
    
    // Apply Rotation
    st -= vec2(0.5 * aspect, 0.5);
    st *= rotate2d(radians(angle));
    st += vec2(0.5 * aspect, 0.5);
    
    // Scale for pattern size
    st *= size;
    
    if (type == 0) {
        // Dot Pattern
        vec2 grid = fract(st) - 0.5;
        float dist = length(grid);
        // Returns a value between 0 and 1, where 1 is the center of the dot
        return 1.0 - (dist * 2.0); 
    } else {
        // Line Pattern
        float line = fract(st.y);
        return 1.0 - abs((line - 0.5) * 2.0);
    }
}

void main() {
    // 1. Fetch Original Texel
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 color = texel.rgb;
    float alpha = texel.a;

    // 2. Input Adjustment
    // Apply Contrast
    color = (color - 0.5) * max(Contrast, 0.0) + 0.5;
    // Apply Gamma
    color = pow(abs(color), vec3(1.0 / max(Tone_Curve_Gamma, 0.01)));
    
    // Get Base Luminance
    float lum = luminance(color);

    // 3. Outline Processing
    float edge = 0.0;
    if (Outline_Enable == 1) {
        edge = sobelEdge(tDiffuse, vUvScaled, resolution, max(Outline_Fill_Radius, 1.0));
        edge *= Outline_Strength;
        // Apply threshold - hard cutoff if threshold is reached
        edge = step(Outline_Threshold, edge);
        
        // Add dark areas to outline if enabled by threshold
        if (lum < Lines_Dark_Fill_Threshold) {
            edge = 1.0; 
        }
    }

    // 4. Tone Processing
    float finalTone = 1.0; // Start white
    
    if (edge < 1.0) { // If not an edge pixel, calculate tone
        // Map luminance to discrete stages based on user boundaries
        float stageValue = 0.0;
        float targetTone = 1.0;
        
        // Determine which stage the luminance falls into
        if (lum <= Upper_Boundary_1) {
            targetTone = Tone_Coeff_1;
        } else if (lum <= Upper_Boundary_2) {
            targetTone = Tone_Coeff_2;
        } else if (lum <= Upper_Boundary_3) {
            targetTone = Tone_Coeff_3;
        } else {
            targetTone = Tone_Coeff_4;
        }

        // Handle Gradient Smoothness between boundaries
        if (Gradient_Boundaries == 1 && Gradient_Smoothness > 0.0) {
             float smoothRange = Gradient_Smoothness * 0.1; // Scale smoothness
             
             // Smoothstep between stages to blend the Tone Coefficients
             if (abs(lum - Upper_Boundary_1) < smoothRange) {
                 float t = smoothstep(Upper_Boundary_1 - smoothRange, Upper_Boundary_1 + smoothRange, lum);
                 targetTone = mix(Tone_Coeff_1, Tone_Coeff_2, t);
             } else if (abs(lum - Upper_Boundary_2) < smoothRange) {
                 float t = smoothstep(Upper_Boundary_2 - smoothRange, Upper_Boundary_2 + smoothRange, lum);
                 targetTone = mix(Tone_Coeff_2, Tone_Coeff_3, t);
             } else if (abs(lum - Upper_Boundary_3) < smoothRange) {
                 float t = smoothstep(Upper_Boundary_3 - smoothRange, Upper_Boundary_3 + smoothRange, lum);
                 targetTone = mix(Tone_Coeff_3, Tone_Coeff_4, t);
             }
        }

        // Generate the spatial pattern
        float patternVal = getPattern(vUv, Pattern_Type, Pattern_Size, Tone_Rotation);
        
        // Apply Tone Levels (quantize the pattern)
        if (Tone_Levels > 0.0) {
            patternVal = floor(patternVal * Tone_Levels) / Tone_Levels;
        }

        // Determine if we should invert the pattern based on luminance threshold
        // Modified to use a float for Enable (> 0.5 acts as true)
        bool invertPattern = (Invert_Pattern_Enable > 0.5 && lum < Invert_Pattern_Threshold);

        if (invertPattern) {
            // Inverted Logic: Background is black (0.0), dots are white (1.0)
            if (patternVal > (1.0 - targetTone)) {
                finalTone = 1.0; // White dots
            } else {
                finalTone = 0.0; // Black background
            }
        } else {
            // Standard Logic: Background is white (1.0), dots are black (0.0)
            if (patternVal > targetTone) {
                finalTone = 0.0; // Black dots
            } else {
                finalTone = 1.0; // White background
            }
        }

        // Solid Overrides
        if (Solid_Black_Enable == 1 && lum <= Solid_Black_Threshold) {
            finalTone = 0.0;
        }
        if (Solid_White_Enable == 1 && lum >= Solid_White_Threshold) {
            finalTone = 1.0;
        }
    } else {
        // It's an edge
        finalTone = 0.0; 
    }

    // 5. Output Formatting
    vec4 outputColor = vec4(vec3(finalTone), 1.0);

    // Alpha Handling
    if (alpha < 1.0) { // If there's transparency in the source
        if (Background_Alpha == 1) {
            // Blend with background opacity
            outputColor.a = Background_Opacity;
        } else {
            // Determine Alpha Ink Color
            if (Alpha_Ink_Color == 0) {
                // Keep Original Alpha
                outputColor.a = alpha;
            } else if (Alpha_Ink_Color == 1) {
                 // Force Black
                 outputColor = vec4(0.0, 0.0, 0.0, 1.0);
            } else if (Alpha_Ink_Color == 2) {
                 // Force White
                 outputColor = vec4(1.0, 1.0, 1.0, 1.0);
            }
        }
    }

    gl_FragColor = outputColor;
}
