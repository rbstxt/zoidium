precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;

// === CUSTOM PROPERTIES (create these in the Shader Effect panel) ===
uniform float Method;            // 0.0 = XDoG Anime, 1.0 = XDoG Manga, 2.0 = Multiply Blur
uniform float Threshold;         // 0.0 - 1.0
uniform float Line_Thickness;    // 0.0 - 10.0 (scales sample radius)
uniform float Softness;          // 0.0 - 1.0
uniform float Noise_Reduction;   // 0.0 - 1.0 (threshold bias)
uniform float Sigma;             // 0.0 - 5.0 (detail/blur level)
uniform float Sigma_Ratio;       // 0.1 - 5.0
uniform float Sharpness;         // 0.0 - 100.0
uniform float Edge_Hardness;     // 0.0 - 100.0 (0=soft, 100=hard)
uniform float Detail_Boost;      // 0.0 - 5.0
uniform float Invert_Lines;      // 0.0 = off, 1.0 = on
uniform float Output_Mode;       // 0.0 = composite, 1.0 = lines only (alpha)
uniform vec3 Line_Color;         // RGB line tint
uniform float Use_Line_Color;    // 0.0 = default tones, 1.0 = use Line_Color
uniform vec3 Background_Color;   // RGB background
uniform float Background_Opacity; // 0.0 - 100.0

// ================================================================

float luminance(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

float sampleLum(vec2 uv) {
    return luminance(texture2D(tDiffuse, uv).rgb);
}

void main() {
    vec2 uv = vUvScaled;
    vec2 px = 1.0 / resolution;
    
    // Sigma handling: if Sigma=0, use near-original (0.01) for inner blur
    // and treat Sigma_Ratio as the absolute outer sigma
    float s1 = max(Sigma, 0.01);
    float s2 = (Sigma > 0.0) ? max(s1 * Sigma_Ratio, 0.01) : max(Sigma_Ratio, 0.01);
    
    // Add Line_Thickness as extra radius
    s1 += Line_Thickness;
    s2 += Line_Thickness;
    
    // 5x5 Difference-of-Gaussians kernel
    float sum1 = 0.0;
    float sum2 = 0.0;
    float w1 = 0.0;
    float w2 = 0.0;
    
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            vec2 off = vec2(float(x), float(y));
            float distSq = dot(off, off);
            
            float g1 = exp(-distSq / (2.0 * s1 * s1));
            float g2 = exp(-distSq / (2.0 * s2 * s2));
            
            vec2 sampleUV = uv + off * px;
            float lum = sampleLum(sampleUV);
            
            sum1 += lum * g1;
            sum2 += lum * g2;
            w1 += g1;
            w2 += g2;
        }
    }
    
    float blur1 = sum1 / w1;
    float blur2 = sum2 / w2;
    float dog = abs(blur2 - blur1) * Sharpness;
    
    // Detail boost: add local high-frequency detail
    float centerLum = sampleLum(uv);
    dog += abs(centerLum - blur1) * Detail_Boost;
    
    // Noise reduction: slightly raise threshold
    float thresh = Threshold + Noise_Reduction * 0.05;
    float hard = clamp(Edge_Hardness / 100.0, 0.0, 1.0);
    
    float lineMask = 0.0;
    
    if (Method < 0.5) {
        // XDoG Anime: smooth anti-aliased sketch lines with gray tones
        float soft = mix(0.15, 0.001, hard) + Softness * 0.1;
        lineMask = smoothstep(thresh - soft, thresh + soft, dog);
    } 
    else if (Method < 1.5) {
        // XDoG Manga: hard threshold + FILL DARK REGIONS
        float edgeMask = step(thresh, dog);
        
        // NEW: Fill any original-image region darker than threshold with black
        float fillMask;
        if (Softness > 0.0) {
            float soft = Softness * 0.05;
            fillMask = 1.0 - smoothstep(thresh - soft, thresh + soft, centerLum);
        } else {
            fillMask = 1.0 - step(thresh, centerLum);
        }
        
        // Combine edges + dark region fill
        lineMask = max(edgeMask, fillMask);
    } 
    else {
        // Multiply Blur: high contrast edges (white on black default)
        float soft = mix(0.1, 0.001, hard) + Softness * 0.05;
        lineMask = smoothstep(thresh - soft, thresh + soft, dog);
    }
    
    // Invert switch
    if (Invert_Lines > 0.5) {
        lineMask = 1.0 - lineMask;
    }
    lineMask = clamp(lineMask, 0.0, 1.0);
    
    // Color logic
    vec3 lineCol;
    vec3 bgCol = mix(vec3(1.0), Background_Color, Background_Opacity / 100.0);
    
    if (Method > 1.5) {
        lineCol = (Use_Line_Color > 0.5) ? Line_Color : vec3(1.0);
        bgCol = vec3(0.0);
    } else {
        lineCol = (Use_Line_Color > 0.5) ? Line_Color : vec3(0.0);
    }
    
    // Output
    if (Output_Mode < 0.5) {
        vec3 final = mix(bgCol, lineCol, lineMask);
        gl_FragColor = vec4(final, 1.0);
    } else {
        gl_FragColor = vec4(lineCol, lineMask);
    }
}
