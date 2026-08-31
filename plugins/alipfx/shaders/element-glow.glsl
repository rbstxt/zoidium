precision highp float;
precision highp int;

// Panzoid Built-in Uniforms & Varyings
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

// --- 18 Custom Parameters (Mapped to Panzoid Uniforms) ---
// Glow Selection
uniform float Solid_Inner;      // Controls the hard selected range threshold
uniform float Filled_Band;      // Mask strength multiplier / boost
uniform float Outer_Soft;       // Controls the feathering range
uniform float Range_Mode;       // 0:Luminance, 1:Lightness, 2:Hue, 3:Saturation, 4:R, 5:G, 6:B, 7:A
uniform float Invert_Range;     // 0: Disabled, 1: Enabled

// Glow Engine Settings
uniform float Radius;           // Spread/size of the bloom
uniform float Intensity;        // Brightness/overdrive multiplier
uniform float Blend;            // 0: Add, 1: Screen, 2: Normal, 3: Under

// Tint Gradient Controls
uniform float Tint;             // 0: Disabled (Original Colors), 1: Enabled (Gradient Colors)
uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;
uniform vec3 Color_7;
uniform vec3 Color_8;
uniform float Gradient_Colors;  // Number of active gradient colors (1.0 to 8.0)

// Helper: Convert RGB to HSV for Hue/Saturation selection tracking
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Evaluates the pixel's target attribute based on the selected Range Mode
float getSelectionValue(vec4 texel) {
    float val = 0.0;
    int mode = int(Range_Mode + 0.5);
    
    if (mode == 0) {
        val = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722)); // Luminance
    } else if (mode == 1) {
        val = (texel.r + texel.g + texel.b) / 3.0; // Lightness
    } else if (mode == 2) {
        val = rgb2hsv(texel.rgb).x; // Hue
    } else if (mode == 3) {
        val = rgb2hsv(texel.rgb).y; // Saturation
    } else if (mode == 4) {
        val = texel.r; // Red
    } else if (mode == 5) {
        val = texel.g; // Green
    } else if (mode == 6) {
        val = texel.b; // Blue
    } else if (mode == 7) {
        val = texel.a; // Alpha
    }

    // Generate soft threshold mask using Solid Inner and Outer Soft properties
    float soft = max(Outer_Soft, 0.001);
    float mask = smoothstep(Solid_Inner - soft, Solid_Inner, val);
    
    // Scale by Filled Band mask strength control
    mask *= Filled_Band;

    // Handle Invert Range switch
    if (Invert_Range > 0.5) {
        mask = 1.0 - mask;
    }

    return clamp(mask, 0.0, 1.0);
}

// Multi-stop color gradient ramp evaluator (Handles up to 8 stops safely)
vec3 getGradientColor(float t) {
    int numColors = int(clamp(Gradient_Colors, 1.0, 8.0) + 0.5);
    if (numColors <= 1) return Color_1;
    
    float scaledT = t * float(numColors - 1);
    int index = int(floor(scaledT));
    float fraction = fract(scaledT);
    
    vec3 c1 = Color_1;
    vec3 c2 = Color_2;
    
    if (index == 0) { c1 = Color_1; c2 = Color_2; }
    else if (index == 1) { c1 = Color_2; c2 = Color_3; }
    else if (index == 2) { c1 = Color_3; c2 = Color_4; }
    else if (index == 3) { c1 = Color_4; c2 = Color_5; }
    else if (index == 4) { c1 = Color_5; c2 = Color_6; }
    else if (index == 5) { c1 = Color_6; c2 = Color_7; }
    else if (index == 6) { c1 = Color_7; c2 = Color_8; }
    else { c1 = Color_8; c2 = Color_8; }
    
    return mix(c1, c2, fraction);
}

// Samples and builds isolated glow source data before blurring
vec4 sampleGlowSource(vec2 uv) {
    vec4 texel = texture2D(tDiffuse, uv);
    float mask = getSelectionValue(texel);
    
    // Decide between original source colors or the custom gradient ramp based on Tint parameter
    vec3 glowColor = texel.rgb;
    if (Tint > 0.5) {
        glowColor = getGradientColor(mask);
    }
    
    // Output weighted color energy along with isolation alpha
    return vec4(glowColor * mask * (Intensity / 100.0), mask);
}

void main() {
    vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    
    // --- Silky Bloom High-End Single Pass Blur Loop ---
    vec4 accumulatedGlow = vec4(0.0);
    float totalWeight = 0.0;
    
    const int STEPS = 4;
    const int DIRS = 4;
    
    // Center sample anchor weight
    accumulatedGlow += sampleGlowSource(vUvScaled) * 2.0;
    totalWeight += 2.0;
    
    for (int d = 0; d < DIRS; d++) {
        float angle = float(d) * (6.2831853 / float(DIRS));
        vec2 direction = vec2(cos(angle), sin(angle));
        
        for (int s = 1; s <= STEPS; s++) {
            float progress = float(s) / float(STEPS);
            float weight = 1.0 - progress; // Linear-Gaussian decay falloff distribution
            
            vec2 offset = direction * (progress * Radius) / resolution;
            
            accumulatedGlow += sampleGlowSource(vUvScaled + offset) * weight;
            accumulatedGlow += sampleGlowSource(vUvScaled - offset) * weight;
            totalWeight += weight * 2.0;
        }
    }
    
    vec4 finalGlow = accumulatedGlow / totalWeight;
    vec3 outputColor = sourceTexel.rgb;
    int blendMode = int(Blend + 0.5);
    
    // --- Element Glow Compositing Modes Execution ---
    if (blendMode == 0) { 
        outputColor = sourceTexel.rgb + finalGlow.rgb; // Add
    } 
    else if (blendMode == 1) { 
        outputColor = sourceTexel.rgb + finalGlow.rgb - (sourceTexel.rgb * finalGlow.rgb); // Screen
    } 
    else if (blendMode == 2) { 
        float glowAlpha = clamp(length(finalGlow.rgb), 0.0, 1.0); // Normal
        outputColor = mix(sourceTexel.rgb, finalGlow.rgb, glowAlpha);
    } 
    else if (blendMode == 3) { 
        float originalMask = getSelectionValue(sourceTexel); // Under
        outputColor = mix(finalGlow.rgb, sourceTexel.rgb, originalMask);
    }
    
    gl_FragColor = vec4(outputColor, sourceTexel.a);
}
