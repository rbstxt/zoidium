precision highp float;
precision highp int;

// Built-in Panzoid Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUv;
varying vec2 vUvScaled;
uniform vec2 resolution;
uniform float time;

// Sapphire S_WipeBlobs Parameters (No Background Layer)
uniform float Transition_Dir;
uniform float Auto_Trans;
uniform float Wipe_Percent;
uniform float Edge_Softness;
uniform float Frequency;
uniform float Rel_Width;
uniform float Octaves;
uniform float Seed;
uniform vec2 Shift_XY;
uniform float Grad_Add;
uniform float Grad_Angle;
uniform float Border_Width;
uniform vec3 Border_Color;
uniform float Border_Opacity;
uniform float Border_Softness;
uniform float Border_Shift;

// Pseudo-random hash for noise generation
float hash(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// 2D Value Noise Function
float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    // Hermite interpolation for smooth edges
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion (FBM) to handle "Octaves"
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    vec2 shift = vec2(100.0);
    // Rotation matrix to eliminate alignment artifacts between octaves
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));

    // WebGL 1.0 requires constant loop bounds
    for (int i = 0; i < 10; ++i) {
        if (i >= octaves) break;
        value += amplitude * noise(p);
        p = rot * p * 2.0 + shift;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    // 1. Calculate Transition Progress
    float progress = (Auto_Trans > 0.5) ? fract(time * 0.5) : clamp(Wipe_Percent / 100.0, 0.0, 1.0);

    // 2. Coordinate System & Aspect Ratio Setup
    vec2 uv = vUv;
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);

    // 3. Apply Noise Transforms (Shift, Rel Width, Frequency, Seed)
    vec2 baseUV = uv - (Shift_XY / resolution);
    vec2 noiseUV = baseUV * aspect;
    
    noiseUV.x /= max(Rel_Width, 0.0001); // Horizontal stretching
    noiseUV *= Frequency;                // Density scale
    noiseUV += vec2(Seed * 13.73, Seed * 43.19); // Randomize pattern based on Seed

    // 4. Generate Blob Noise Texture
    // FIX: Clamp as float first, then cast to int to avoid WebGL 1.0 errors
    int oct = int(clamp(Octaves, 1.0, 10.0));
    float n = fbm(noiseUV, oct); 

    // 5. Apply Grad Add & Grad Angle (Directional Wave)
    float angleRad = radians(Grad_Angle);
    vec2 gradDir = vec2(cos(angleRad), sin(angleRad));
    vec2 centeredUV = uv - 0.5;
    
    float gradValue = dot(centeredUV, gradDir);
    float gradInfluence = gradValue * Grad_Add;

    float testVal = n + gradInfluence;

    // 6. Dynamic Threshold Mapping
    float maxGrad = 0.707 * Grad_Add; 
    float valMin = 0.0 - abs(maxGrad);
    float valMax = 1.0 + abs(maxGrad);

    float threshold = mix(valMin - 0.05, valMax + 0.05, progress);

    // 7. Transition Direction Inversion
    if (Transition_Dir > 0.5) {
        testVal = (valMax + valMin) - testVal;
    }

    // 8. Base Mask Generation & Edge Softness
    float soft = max(Edge_Softness * 0.01, 0.0001); 
    float mask = smoothstep(threshold - soft, threshold + soft, testVal);

    // 9. Sample Input Layer (Foreground)
    vec4 fg = texture2D(tDiffuse, vUvScaled);

    // 10. Mix to Alpha Instead of a Background Layer
    vec4 transparentBg = vec4(0.0); // Pure transparency (0,0,0,0)
    vec4 finalColor = mix(transparentBg, fg, mask);

    // 11. Border Rendering 
    if (Border_Width > 0.0) {
        float bWidth = Border_Width * 0.01;
        float bShift = Border_Shift * 0.01;
        float bSoft = max(Border_Softness * 0.01, 0.0001);

        float bCenter = threshold - bShift;
        float dist = abs(testVal - bCenter);

        float borderAlpha = 1.0 - smoothstep(bWidth - bSoft, bWidth + bSoft, dist);
        borderAlpha *= Border_Opacity;

        // Composite the colored border over the transition
        finalColor.rgb = mix(finalColor.rgb, Border_Color, borderAlpha);
        finalColor.a = mix(finalColor.a, Border_Opacity, borderAlpha); 
    }

    gl_FragColor = finalColor;
}
