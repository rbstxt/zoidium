precision highp float;
precision highp int;

// --- Input Textures ---
uniform sampler2D tDiffuse; // The Image to be transitioned
uniform sampler2D tTo;      // Unused (but kept for compatibility)

// --- Main Wipe Variables ---
uniform float wipePercent;  // Range: 0 to 1
uniform float dots;         // 0.0 = Grow, 1.0 = Shrink
uniform float invert;       // 0.0 = Normal, 1.0 = Invert Inside/Outside

// --- Dot Pattern Settings ---
uniform float edgeSoftness; // Range: 0 or greater
uniform float angle;        // Range: any
uniform float frequency;    // Range: 0.1 or greater
uniform float relWidth;     // Range: 0.1 or greater
uniform float relWidPreRot; // Range: 0.1 or greater
uniform vec2 shift;         // Range: any

// --- Gradient Settings ---
uniform float gradAdd;      // Range: -10 to 10
uniform float gradAngle;    // Range: any

// --- Border Variables ---
uniform float borderWidth;    // Default: 0, Range: 0 or greater
uniform vec3 borderColor;     // Default: [0.75, 0.0, 0.0]
uniform float borderOpacity;  // Default: 1, Range: 0 to 1
uniform float borderSoftness; // Default: 0, Range: 0 or greater
uniform float borderShift;    // Default: 0, Range: any

varying vec2 vUvScaled;

// --- Helper Functions ---
vec2 rotate(vec2 v, float a) {
    float s = sin(radians(a));
    float c = cos(radians(a));
    mat2 m = mat2(c, -s, s, c);
    return m * v;
}

void main() {
    // 1. Center UVs
    vec2 center = vec2(0.5);
    vec2 uv = vUvScaled - center;

    // 2. Gradient Timing
    float gradientOffset = 0.0;
    if (gradAdd > 0.0) {
        vec2 gradUV = rotate(uv, gradAngle);
        float gradVal = gradUV.x + 0.5; 
        gradientOffset = gradVal * gradAdd;
    }

    // 3. Transform UVs (Squash/Stretch/Rotate)
    uv.x /= max(0.001, relWidPreRot);
    uv = rotate(uv, angle);
    uv.x /= max(0.001, relWidth);

    // 4. Generate Grid
    vec2 gridUV = uv * frequency + shift;
    vec2 cellUV = fract(gridUV) - 0.5;

    // 5. Distance Field
    float dist = length(cellUV);

    // 6. Calculate Radius Logic
    float maxRadius = 0.8; 
    float totalRange = 1.0 + gradAdd;
    
    // Expand range slightly for borders/softness
    float safeRange = totalRange + edgeSoftness + borderWidth;
    float currentWipe = wipePercent * safeRange;
    float localProgress = currentWipe - gradientOffset;

    float currentRadius;
    
    // Handle Grow vs Shrink Logic
    if (dots > 0.5) { 
        // --- SHRINK ---
        currentRadius = (1.0 - localProgress) * maxRadius;
    } else { 
        // --- GROW ---
        currentRadius = localProgress * maxRadius;
    }

    // 7. Generate Main Alpha Mask
    float alphaMask;
    float mainStep = smoothstep(currentRadius - edgeSoftness, currentRadius, dist);

    // Apply Invert and Dot Mode Logic
    if (dots > 0.5) {
        // Shrink Mode: Inside(0) = Visible, Outside(1) = Transparent
        if (invert > 0.5) alphaMask = 1.0 - mainStep;
        else alphaMask = mainStep;
    } else {
        // Grow Mode: Inside(0) = Transparent, Outside(1) = Visible
        // Logic: Inside Grow (dist < radius) is the "Wipe" action
        float insideIsWipe = 1.0 - mainStep;
        
        if (invert > 0.5) alphaMask = 1.0 - insideIsWipe;
        else alphaMask = insideIsWipe;
    }
    // Note: alphaMask here represents "How much of the wipe is complete at this pixel".
    // 0.0 = Show Original Image. 
    // 1.0 = Show Transparency.

    // 8. Generate Border Mask
    float finalBorderMask = 0.0;
    if (borderWidth > 0.0) {
        float borderCenter = currentRadius + borderShift;
        float distFromBorder = abs(dist - borderCenter);
        float halfWidth = borderWidth * 0.5; 
        finalBorderMask = 1.0 - smoothstep(halfWidth, halfWidth + borderSoftness, distFromBorder);
    }

    // 9. Composite Final Image
    vec4 texFrom = texture2D(tDiffuse, vUvScaled);
    vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

    // Mix Image with Transparency
    // alphaMask 0 -> texFrom
    // alphaMask 1 -> transparent
    vec4 baseColor = mix(texFrom, transparent, clamp(alphaMask, 0.0, 1.0));

    // Apply the Border
    // The border is solid color mixed on top of the base
    vec4 borderColWithAlpha = vec4(borderColor, 1.0);
    
    // We mix the baseColor with the Border Color using the borderMask
    gl_FragColor = mix(baseColor, borderColWithAlpha, finalBorderMask * borderOpacity);
}
