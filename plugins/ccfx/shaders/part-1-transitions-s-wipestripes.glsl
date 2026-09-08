precision highp float;
precision highp int;

// --- Input Textures ---
uniform sampler2D tDiffuse; // The "From" image
uniform sampler2D tTo;      // The "To" image (Added for transition logic)

// --- Wipe Variables ---
uniform float wipePercent;  // Default: 0, Range: 0 to 1
uniform float edgeSoftness; // Default: 0, Range: 0 or greater
uniform float angle;        // Default: 45, Range: any
uniform float frequency;    // Default: 6, Range: 0.1 or greater
uniform float shiftStripes; // Default: 0, Range: any
uniform float gradAdd;      // Default: 0, Range: -10 to 10
uniform float gradAngle;    // Default: 0, Range: any

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

void main()
{
    vec2 center = vec2(0.5);
    vec2 uv = vUvScaled - center;

    // 1. Generate Stripe Pattern
    vec2 stripeUV = rotate(uv, angle);
    // Create sawtooth wave (0.0 to 1.0)
    float pattern = fract(stripeUV.x * frequency + shiftStripes);

    // 2. Calculate Gradient (for Progressive Wipes)
    float gradientVal = 0.0;
    if (gradAdd != 0.0) {
        vec2 gradUV = rotate(uv, gradAngle);
        gradientVal = gradUV.x + 0.5; 
    }

    // 3. Create the Main Mask
    float combinedMask = pattern + (gradientVal * gradAdd);

    // 4. Calculate Thresholds
    // Range must cover 1.0 + gradAdd, plus room for softness and border
    float totalRange = 1.0 + abs(gradAdd); 
    // We expand the total travel distance slightly so the border clears the screen fully
    float currentThreshold = wipePercent * (totalRange + edgeSoftness + borderWidth);

    // 5. Main Wipe Logic
    // Smoothstep creates the gradient for edge softness
    float mixVal = smoothstep(currentThreshold - edgeSoftness, currentThreshold, combinedMask);
    float finalMix = 1.0 - mixVal;

    // 6. Border Logic
    float borderMask = 0.0;
    if (borderWidth > 0.0) {
        // Find distance from the current cut line (threshold)
        // Apply Border Shift here
        float dist = abs(combinedMask - (currentThreshold + borderShift));
        
        // Create the band: 1.0 at center, fading out to borderWidth
        // We use smoothstep inverted to create the fade
        float outerEdge = borderWidth + borderSoftness;
        borderMask = 1.0 - smoothstep(borderWidth, outerEdge, dist);
    }

    // 7. Composite
    vec4 texFrom = texture2D(tDiffuse, vUvScaled);
    vec4 texTo = texture2D(tTo, vUvScaled);

    // Mix the two images based on the Wipe
    vec4 baseColor = mix(texFrom, texTo, finalMix);

    // Apply the Border on top
    // We mix the baseColor with the Border Color based on the mask and opacity
    gl_FragColor = mix(baseColor, vec4(borderColor, 1.0), borderMask * borderOpacity);
}
