precision highp float;
precision highp int;

uniform sampler2D tDiffuse; 
varying vec2 vUvScaled; 

#define MAX_ITERATIONS 20 

// --- Editable Uniforms ---
uniform int uIterations; 
uniform vec2 uResolution; 
uniform float uExtrusionDistance; 
uniform vec2 uExtrusionDirection; 
uniform float uScaleFactor; 
uniform float uAttenuation;

// NEW: Extrusion Color Properties
uniform vec3 uExtrusionColor; // The RGB color of the extrusion (e.g., vec3(1.0, 0.0, 0.0) for red)
uniform float uColorMix;      // 0.0 = original texture, 1.0 = solid uExtrusionColor

void main() {
    vec4 finalColor = vec4(0.0);
    vec2 center = vec2(0.5);
    
    float maxDimension = max(uResolution.x, uResolution.y);
    vec2 pixelToUv = vec2(maxDimension / uResolution.x, maxDimension / uResolution.y) / maxDimension;

    // Iterate to draw the duplicated layers (back-to-front)
    for (int i = 1; i <= MAX_ITERATIONS; ++i) {
        
        if (i > uIterations) {
            break; 
        }

        int distanceIndex = uIterations - i + 1; 

        float scale = pow(uScaleFactor, float(distanceIndex));
        float totalExtrusionPixels = uExtrusionDistance * float(distanceIndex); 
        vec2 extrusionVectorPixels = uExtrusionDirection * totalExtrusionPixels;
        vec2 extrusionVectorUV = extrusionVectorPixels * pixelToUv;

        vec2 transformedUv = vUvScaled;
        transformedUv = transformedUv - extrusionVectorUV;
        transformedUv = center + (transformedUv - center) / scale;
        
        if (transformedUv.x >= 0.0 && transformedUv.x <= 1.0 && 
            transformedUv.y >= 0.0 && transformedUv.y <= 1.0) {
            
            vec4 texel = texture2D(tDiffuse, transformedUv);

            // --- COLOR MODIFICATION START ---
            // Mix the original texture color with the custom extrusion color
            // We only change the RGB, keeping the original alpha for transparency masks
            texel.rgb = mix(texel.rgb, uExtrusionColor, uColorMix);
            // --- COLOR MODIFICATION END ---

            float fadeFactor = 1.0 - (float(distanceIndex) / float(uIterations)) * uAttenuation;
            texel.a *= fadeFactor;

            finalColor = mix(finalColor, texel, texel.a); 
        }
    }

    // Draw the Original Layer (in front) - We don't apply the tint here
    vec4 originalTexel = texture2D(tDiffuse, vUvScaled);
    finalColor = mix(finalColor, originalTexel, originalTexel.a);
    
    gl_FragColor = finalColor;
}
