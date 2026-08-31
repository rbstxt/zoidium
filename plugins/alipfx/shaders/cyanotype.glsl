precision highp float;
precision highp int;

// Panzoid Built-in Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom Properties (Dynamic Parameters)
uniform float Chemistry;            // 0: Classic Prussian, 1: Vibrant Wash, 2: Deep Sea, 3: Antique Botanical
uniform float Effect_Strength;     // 0.0 to 1.0
uniform float Exposure;            // 0.0 to 1.0
uniform float Chemical_Contrast;   // 0.0 to 1.0
uniform float Dye_Density;         // 0.0 to 1.0
uniform float Paper_Aging;         // 0.0 to 1.0
uniform float Water_Stains_Fibers; // 0.0 to 1.0
uniform float Pulp_Clumping;       // 0.0 to 1.0

// Pseudo-random hash function for noise generation
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 2D Value Noise function
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

// Fractal Brownian Motion for organic texturing
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    // Rotation matrix to eliminate grid line artifacts
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; ++i) {
        v += a * noise(p);
        p = rot * p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// Generates high-frequency thin organic lines mimicking paper fibers
float getFibers(vec2 uv) {
    float n1 = noise(uv * 380.0);
    float n2 = noise(uv * vec2(8.0, 480.0) + vec2(42.1));
    return smoothstep(0.78, 0.96, n1 * n2);
}

// FIXED: Generates organic chemical water stains instead of artificial blob rings
float getWaterStains(vec2 uv) {
    // Using FBM domain warping for distressed, natural paper staining
    float n = fbm(uv * 15.0);
    float stains = fbm(uv * 35.0 + n * 2.0); 
    return (stains - 0.5) * 0.35;
}

// Multi-stage gradient mapping to recreate the 4 distinct chemical compounds
vec3 applyChemistry(float luma, int mode) {
    vec3 shadowColor;
    vec3 midColor;
    vec3 highlightColor;
    
    if (mode == 0) { 
        // Classic Prussian
        shadowColor    = vec3(0.02, 0.07, 0.24);
        midColor       = vec3(0.12, 0.36, 0.70);
        highlightColor = vec3(0.93, 0.96, 0.99);
    } else if (mode == 1) { 
        // Vibrant Wash
        shadowColor    = vec3(0.00, 0.10, 0.50);
        midColor       = vec3(0.04, 0.50, 0.98);
        highlightColor = vec3(1.00, 1.00, 1.00);
    } else if (mode == 2) { 
        // Deep Sea
        shadowColor    = vec3(0.005, 0.015, 0.12);
        midColor       = vec3(0.03, 0.15, 0.40);
        highlightColor = vec3(0.85, 0.90, 0.95);
    } else { 
        // Antique Botanical (Mode 3)
        shadowColor    = vec3(0.01, 0.10, 0.20);
        midColor       = vec3(0.15, 0.42, 0.50);
        highlightColor = vec3(0.95, 0.88, 0.76);
    }
    
    // Smooth dual-zone linear interpolation
    if (luma < 0.5) {
        return mix(shadowColor, midColor, luma * 2.0);
    } else {
        return mix(midColor, highlightColor, (luma - 0.5) * 2.0);
    }
}

void main() {
    // 1. Fetch input texture fragment
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 color = texel.rgb;
    
    // 2. Exposure Control Slider
    float expFactor = Exposure < 0.5 ? (Exposure * 2.0) : (1.0 + (Exposure - 0.5) * 5.0);
    color *= expFactor;
    
    // 3. Convert to perceptual grayscale luminance
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    
    // 4. Chemical Contrast Control Slider
    float contrastFactor = Chemical_Contrast * 2.0;
    luma = clamp((luma - 0.5) * contrastFactor + 0.5, 0.0, 1.0);
    
    // 5. Apply selected Chemistry compound
    int chemMode = int(floor(Chemistry + 0.5));
    vec3 cyanotypeColor = applyChemistry(luma, chemMode);
    
    // 6. Dye Density Slider
    float cyanLuma = dot(cyanotypeColor, vec3(0.299, 0.587, 0.114));
    float densityFactor = Dye_Density * 2.0; 
    cyanotypeColor = mix(vec3(cyanLuma), cyanotypeColor, densityFactor);
    
    // 7. Paper Aging Slider
    vec3 agedPaperTint = vec3(0.97, 0.92, 0.81);
    float highlightMask = smoothstep(0.25, 1.0, luma);
    cyanotypeColor = mix(cyanotypeColor, cyanotypeColor * agedPaperTint, Paper_Aging * highlightMask);
    
    // FIXED: 8. Pulp Clumping Slider
    // Increased scale from 9.0 to 120.0 to create fine paper grit rather than massive clouds
    float clumps = fbm(vUvScaled * 120.0);
    float clumpMod = (clumps - 0.5) * 0.15 * Pulp_Clumping;
    cyanotypeColor += clumpMod;
    
    // FIXED: 9. Water Stains & Fibers Slider
    // Cleaned up the blending math to layer the grit correctly
    float organicFibers = getFibers(vUvScaled);
    float waterStains   = getWaterStains(vUvScaled);
    float textureMix    = (organicFibers * 0.30 + waterStains) * Water_Stains_Fibers;
    cyanotypeColor      = clamp(cyanotypeColor + textureMix, 0.0, 1.0);
    
    // 10. Blend output with original frame via Effect Strength
    vec3 finalOutput = mix(texel.rgb, cyanotypeColor, Effect_Strength);
    
    gl_FragColor = vec4(finalOutput, texel.a);
}
