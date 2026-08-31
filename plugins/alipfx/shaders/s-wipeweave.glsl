precision highp float;
precision highp int;

// Panzoid Built-ins
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

// Custom Properties
uniform int Transition_Dir;   // 0: Wipe Off to Bg, 1: Wipe On from Bg
uniform int Auto_Trans;       // 0: No, 1: Yes
uniform float Wipe_Percent;   // 0 to 100
uniform int Strands;          // 0: Shrink, 1: Grow
uniform float Edge_Softness;  // 0.0 to 1.0+
uniform float Frequency;      // e.g. 20.0
uniform float Rel_Length;     // e.g. 10.0
uniform int Octaves;          // 1 to 10
uniform float Seed;           
uniform vec2 Shift_XY;        
uniform float H_Speed_X;      
uniform float V_Speed_Y;      
uniform float Grad_Add;       
uniform float Grad_Angle;     
uniform float Border_Width;   
uniform vec3 Border_Color;    
uniform float Border_Opacity; 
uniform float Border_Softness;
uniform float Border_Shift;   

uniform float time; 

// --- Helper Functions ---

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float res = mix(mix(hash(i + vec2(0.0, 0.0)), 
                        hash(i + vec2(1.0, 0.0)), f.x),
                    mix(hash(i + vec2(0.0, 1.0)), 
                        hash(i + vec2(1.0, 1.0)), f.x), f.y);
    return res;
}

float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 10; i++) { 
        if (i >= octaves) break;
        value += amp * noise(p * freq);
        p += vec2(100.0 + Seed * 10.0); 
        freq *= 2.0;
        amp *= 0.5;
    }
    return value;
}

mat2 rotate2d(float angle) {
    return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
}

void main() {
    // 1. Setup Progress
    float progress = Wipe_Percent / 100.0;
    if (Auto_Trans == 1) {
        progress = fract(time * 0.5); 
    }

    // 2. Setup Coordinates & Motion
    vec2 p = vUv;
    p += Shift_XY * 0.001; 
    vec2 movement = vec2(H_Speed_X, V_Speed_Y) * time * 0.1;
    p += movement;

    // 3. Generate Weave Pattern
    vec2 pVert = p * Frequency;
    vec2 pHorz = p * Frequency;
    
    // Rel Length: stretches strands. 
    // Higher Rel Length = longer strands = lower noise frequency on that axis.
    pVert.y /= max(0.1, Rel_Length); 
    pHorz.x /= max(0.1, Rel_Length);

    float n1 = fbm(pVert + vec2(Seed), Octaves);
    float n2 = fbm(pHorz + vec2(Seed + 13.37), Octaves);
    
    float weavePattern = max(n1, n2);
    weavePattern = clamp(weavePattern, 0.0, 1.0);

    // 4. Gradient (Grad Add)
    if (Grad_Add > 0.0) {
        vec2 centeredUv = vUv - 0.5;
        float rad = radians(Grad_Angle);
        centeredUv = rotate2d(rad) * centeredUv;
        float grad = centeredUv.y + 0.5; 
        weavePattern = mix(weavePattern, grad, clamp(Grad_Add * 0.5, 0.0, 0.8));
    }

    // 5. Logic: Strands (Grow vs Shrink)
    if (Strands == 1) { 
       weavePattern = 1.0 - weavePattern;
    }

    // 6. Calculate Matte (Alpha)
    // As progress goes 0->1, threshold increases.
    // smoothstep(low, high, x): if x > high return 1. if x < low return 0.
    // As low/high increase past x, result goes 1 -> 0.
    // Therefore, default behavior is "Wipe Off" (Starts visible, ends invisible).
    
    float threshold = progress;
    float soft = max(0.001, Edge_Softness * 0.1);
    
    float p_min = threshold * (1.0 + 2.0 * soft) - soft;
    float p_max = p_min + soft;
    
    float alpha = smoothstep(p_min, p_max, weavePattern);

    // 7. Transition Direction Logic (FIXED)
    // 0 = Wipe Off to Bg (Default 1->0 behavior). Do nothing.
    // 1 = Wipe On from Bg (Inverse 0->1 behavior). Invert.
    if (Transition_Dir == 1) {
        alpha = 1.0 - alpha; 
    }

    // 8. Border Calculation
    vec4 borderColorOutput = vec4(0.0);
    if (Border_Width > 0.0) {
        float borderCenter = p_min; 
        float bSoft = max(0.001, Border_Softness * 0.1);
        float bWidth = Border_Width * 0.01; 
        float bShift = Border_Shift * 0.01;
        float bDist = abs(weavePattern - (borderCenter + bShift));
        
        float bAlpha = 1.0 - smoothstep(bWidth, bWidth + bSoft, bDist);
        bAlpha *= Border_Opacity;
        borderColorOutput = vec4(Border_Color, bAlpha);
    }

    // 9. Final Mix
    vec4 currentLayer = texture2D(tDiffuse, vUvScaled);
    vec4 backgroundColor = vec4(0.0); // Transparent

    // Apply Transition Alpha
    vec4 finalColor = mix(backgroundColor, currentLayer, alpha);

    // Apply Border
    // We add border on top, handling alpha composition
    finalColor = vec4(mix(finalColor.rgb, Border_Color, borderColorOutput.a), 
                      min(1.0, finalColor.a + borderColorOutput.a));

    gl_FragColor = finalColor;
}
