precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

// Custom dynamic properties
uniform float Progress; 
uniform float Slash1_Rotation; 
uniform float Slash2_Rotation; 
uniform float Glow_Intensity; 
uniform vec3 Core_Color; 
uniform vec3 Glow_Color; 

// Helper function to rotate 2D UV coordinates
vec2 rotateUV(vec2 uv, float rotationDegrees) {
    float rad = radians(rotationDegrees);
    float s = sin(rad);
    float c = cos(rad);
    return vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
}

void main()
{
    vec4 baseTexel = texture2D(tDiffuse, vUvScaled);
    vec2 uv = vUv - 0.5;
    
    // Correct aspect ratio before rotating
    uv.x *= resolution.x / resolution.y;

    // Map the single 'Progress' to the three stages
    float p1 = clamp(Progress / 0.3, 0.0, 1.0);
    float p2 = clamp((Progress - 0.3) / 0.3, 0.0, 1.0);
    float reveal = clamp((Progress - 0.6) / 0.4, 0.0, 1.0);

    // Rotate coordinate space for each slash
    vec2 uv1 = rotateUV(uv, Slash1_Rotation);
    vec2 uv2 = rotateUV(uv, Slash2_Rotation);

    float d1 = abs(uv1.x);
    float d2 = abs(uv2.x);
    float pos1 = uv1.y;
    float pos2 = uv2.y;

    // The sweeping animation mask
    float draw1 = smoothstep(pos1, pos1 + 0.1, (p1 * 3.0) - 1.5);
    float draw2 = smoothstep(pos2, pos2 + 0.1, (p2 * 3.0) - 1.5);

    // Calculate thicknesses: The core is always slightly wider than the hole
    float holeThickness = reveal * 1.5;
    float coreThickness = holeThickness + 0.005; // 0.005 is the base solid line width

    // 1. Create the Transparent Hole Mask
    float h1 = (1.0 - smoothstep(holeThickness, holeThickness + 0.003, d1)) * draw1;
    float h2 = (1.0 - smoothstep(holeThickness, holeThickness + 0.003, d2)) * draw2;
    float holeMask = clamp(h1 + h2, 0.0, 1.0);
    
    // Prevent the hole from appearing before the reveal phase starts
    holeMask *= step(0.001, reveal);

    // 2. Create the Solid Core Mask (subtracting the hole from it)
    float c1 = (1.0 - smoothstep(coreThickness, coreThickness + 0.003, d1)) * draw1;
    float c2 = (1.0 - smoothstep(coreThickness, coreThickness + 0.003, d2)) * draw2;
    float coreMask = clamp(c1 + c2, 0.0, 1.0) - holeMask;
    coreMask = clamp(coreMask, 0.0, 1.0);

    // 3. Create the Glow Mask (pushed outward by the core)
    float d1_glow = max(0.0, d1 - coreThickness);
    float d2_glow = max(0.0, d2 - coreThickness);
    float g1 = (Glow_Intensity * 0.005) / (d1_glow + 0.001) * draw1;
    float g2 = (Glow_Intensity * 0.005) / (d2_glow + 0.001) * draw2;
    float totalGlow = clamp(g1 + g2, 0.0, 1.0);

    vec4 finalColor = baseTexel;

    // Blend the Glow
    finalColor.rgb = mix(finalColor.rgb, Glow_Color, totalGlow);
    
    // Blend the Solid Core
    finalColor.rgb = mix(finalColor.rgb, Core_Color, coreMask);
    finalColor.a = mix(baseTexel.a, 1.0, coreMask); // Ensure the core is fully opaque
    
    // Blend the Transparent Hole
    finalColor.rgb = mix(finalColor.rgb, vec3(0.0), holeMask);
    finalColor.a = mix(finalColor.a, 0.0, holeMask); // Cut the alpha

    gl_FragColor = finalColor;
}
