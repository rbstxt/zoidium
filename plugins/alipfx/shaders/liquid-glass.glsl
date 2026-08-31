precision highp float;
precision highp int;

// Panzoid Built-in Uniforms
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom Properties Uniforms
uniform sampler2D Source_Layer;
uniform float Quality;
uniform float Strength;
uniform float Scale;
uniform float IOR;
uniform float Thickness;
uniform vec3 Tint_Color;
uniform float Tint_Opacity;
uniform float Opacity;
uniform float Intensity;
uniform float Softness;
uniform float Edge_Width;
uniform float Light_Angle;
uniform vec3 Light_Color;
uniform float Highlight_Distance;
uniform float Amount;
uniform float Feather;
uniform float Edge_Blur;
uniform float Enable;
uniform float Shadow_Opacity;
uniform float Shadow_Distance;
uniform float Shadow_Softness;

// Panzoid Built-in Varyings
varying vec2 vUv;
varying vec2 vUvScaled;

// Helper to safely sample mask alpha with correct scaling layout
float getMaskAlpha(vec2 uvOffset) {
    vec2 targetUv = (vUv + uvOffset) * uvScale;
    if(targetUv.x < 0.0 || targetUv.x > uvScale.x || targetUv.y < 0.0 || targetUv.y > uvScale.y) {
        return 0.0;
    }
    return texture2D(tDiffuse, targetUv).a;
}

void main() {
    vec2 texel = 1.0 / resolution;
    
    // 1. Determine Sample Steps based on Quality Parameter
    int iterations = 8;
    if (Quality < 0.5) { iterations = 4; }       // Draft
    else if (Quality < 1.5) { iterations = 8; }  // Standard
    else if (Quality < 2.5) { iterations = 16; } // High
    else { iterations = 28; }                    // Ultra (Supersampled)

    // 2. Compute Normal Vectors (Handles Edge Bending & Ball Lens Look via Scale)
    vec2 grad = vec2(0.0);
    float normStep = (Scale * 0.05) / max(resolution.x, resolution.y);
    float weightSum = 0.0;
    
    for (int i = 1; i <= 28; i++) {
        if (i > iterations) break;
        float fi = float(i);
        float w = 1.0 / fi;
        
        float stepDist = normStep * fi;
        float aR = getMaskAlpha(vec2(stepDist, 0.0));
        float aL = getMaskAlpha(vec2(-stepDist, 0.0));
        float aT = getMaskAlpha(vec2(0.0, stepDist));
        float aB = getMaskAlpha(vec2(0.0, -stepDist));
        
        grad.x += (aL - aR) * w;
        grad.y += (aB - aT) * w;
        weightSum += w;
    }
    if (weightSum > 0.0) grad /= weightSum;

    // Build the 3D surface normal
    float aspectMod = resolution.x / resolution.y;
    vec3 normal = normalize(vec3(grad.x * (Strength * 0.1), grad.y * (Strength * 0.1) * aspectMod, 1.0));
    
    // Current base alpha of the glass shape
    float currentAlpha = texture2D(tDiffuse, vUvScaled).a;
    
    // Local Edge Detection for Localized Edge Blur & Edge Feathering
    float edgeAlpha = smoothstep(0.0, max(0.001, Feather * 0.01), currentAlpha);
    
    // 3. Chromatic Aberration & Refraction Calculation
    float caShift = Amount * 0.001;
    // Bending logic scaling with Index of Refraction (IOR)
    vec2 refractDir = normal.xy * (IOR - 1.0) * (Strength * 0.002);
    
    vec2 uvR = vUv + refractDir * (1.0 + caShift);
    vec2 uvG = vUv + refractDir;
    vec2 uvB = vUv + refractDir * (1.0 - caShift);
    
    // 4. Glass Frosted Body (Thickness Blur Processing)
    vec3 refractedCol = vec3(0.0);
    float blurRadius = Thickness * 0.002;
    
    if (blurRadius > 0.0) {
        // Jittered multi-tap sample loop for clean frosted glass look
        vec2 blurOffsets[4];
        blurOffsets[0] = vec2(blurRadius, blurRadius);
        blurOffsets[1] = vec2(-blurRadius, -blurRadius);
        blurOffsets[2] = vec2(blurRadius, -blurRadius);
        blurOffsets[3] = vec2(-blurRadius, blurRadius);
        
        for(int j = 0; j < 4; j++) {
            refractedCol.r += texture2D(Source_Layer, clamp(uvR + blurOffsets[j], 0.0, 1.0)).r * 0.25;
            refractedCol.g += texture2D(Source_Layer, clamp(uvG + blurOffsets[j], 0.0, 1.0)).g * 0.25;
            refractedCol.b += texture2D(Source_Layer, clamp(uvB + blurOffsets[j], 0.0, 1.0)).b * 0.25;
        }
    } else {
        refractedCol.r = texture2D(Source_Layer, clamp(uvR, 0.0, 1.0)).r;
        refractedCol.g = texture2D(Source_Layer, clamp(uvG, 0.0, 1.0)).g;
        refractedCol.b = texture2D(Source_Layer, clamp(uvB, 0.0, 1.0)).b;
    }
    
    // Apply Tint Color Configuration
    vec3 glassBody = mix(refractedCol, Tint_Color, Tint_Opacity * 0.01);
    
    // 5. Specular Highlights Modeling (Rim Lights & Global Illumination Angle)
    float angleRad = Light_Angle * 3.14159265 / 180.0;
    vec3 lightDir = normalize(vec3(cos(angleRad), sin(angleRad), 2.0 - (Highlight_Distance * 0.02)));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfVec = normalize(lightDir + viewDir);
    
    // Polish Control: Lower Softness = tight gloss peak, High Softness = wide matte accent
    float shinyExponent = mix(128.0, 2.0, Softness * 0.01);
    float specularIntensity = pow(max(dot(normal, halfVec), 0.0), shinyExponent) * (Intensity * 0.02);
    
    // Rim Edge Highlight Generation
    float rimWeight = 1.0 - normal.z;
    float edgeHighlight = smoothstep(1.0 - (Edge_Width * 0.01), 1.0, rimWeight) * (Intensity * 0.01);
    
    vec3 finalHighlights = Light_Color * (specularIntensity + edgeHighlight);
    vec3 dynamicGlassOutput = glassBody + finalHighlights;
    
    // 6. Refractive Shadow Layout Configuration
    float shadowMask = 0.0;
    vec2 shadowOffset = vec2(0.0);
    
    if (Enable > 0.5) {
        float shadowAngleRad = angleRad + 3.14159265; // Shadow casts downstream from light source
        shadowOffset = vec2(cos(shadowAngleRad), sin(shadowAngleRad)) * (Shadow_Distance * 0.002);
        
        // Multi-sampled soft Gaussian approximation for shadow blur
        float sBlur = Shadow_Softness * 0.001;
        shadowMask += getMaskAlpha(-shadowOffset) * 0.4;
        shadowMask += getMaskAlpha(-shadowOffset + vec2(sBlur, sBlur)) * 0.15;
        shadowMask += getMaskAlpha(-shadowOffset + vec2(-sBlur, -sBlur)) * 0.15;
        shadowMask += getMaskAlpha(-shadowOffset + vec2(sBlur, -sBlur)) * 0.15;
        shadowMask += getMaskAlpha(-shadowOffset + vec2(-sBlur, sBlur)) * 0.15;
    }
    
    // 7. Composite Pass Construction
    vec4 sceneBackground = texture2D(Source_Layer, vUv);
    
    // Overlay shadow onto background scenery
    vec3 compositeBackground = mix(sceneBackground.rgb, vec3(0.0), shadowMask * (Shadow_Opacity * 0.01));
    
    // Merge background canvas and simulated glass structure cleanly
    vec3 outputColor = mix(compositeBackground, dynamicGlassOutput, edgeAlpha * (Opacity * 0.01));
    float outputAlpha = max(sceneBackground.a, edgeAlpha * (Opacity * 0.01));
    
    // Optional Localized Rim Edge Blur Processing
    if (Edge_Blur > 0.0) {
        float edgeRegion = smoothstep(0.1, 0.9, rimWeight);
        outputColor = mix(outputColor, glassBody, edgeRegion * (Edge_Blur * 0.01));
    }
    
    gl_FragColor = vec4(outputColor, outputAlpha);
}
