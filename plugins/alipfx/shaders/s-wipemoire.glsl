precision highp float;
precision highp int;

// --- Panzoid Built-ins ---
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float time;
varying vec2 vUvScaled;

// --- Custom Parameters ---
uniform float Transition_Dir; // 0 = Wipe Off, 1 = Wipe On
uniform float Auto_Trans;     // 0 = Manual, 1 = Auto
uniform float Wipe_Percent;   // 0 to 100
uniform float Edge_Softness;  // 0 to 100

// Geometry
uniform vec2 A_Center_XY;
uniform vec2 B_Center_XY;
uniform float Frequency;
uniform float Phase_Start;
uniform float Phase_Speed;
uniform float Moire_Phase;
uniform float Moire_Speed;

// Relative Adjustments
uniform float A_Rel_Freq;
uniform float A_Rel_Width;
uniform float A_Rotate;
uniform float B_Rel_Freq;
uniform float B_Rel_Width;
uniform float B_Rotate;

// Gradient
uniform float Grad_Add;
uniform float Grad_Angle;

// Border
uniform float Border_Width;
uniform vec3 Border_Color;
uniform float Border_Opacity;
uniform float Border_Softness;
uniform float Border_Shift;

// --- Helpers ---
#define PI 3.14159265359

mat2 rotate2d(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

// Convert AE pixel coords -> UV
vec2 aePxToUv(vec2 px) {
    vec2 p = px + vec2(0.5, 0.5);
    vec2 uv = p / resolution;
    uv.y = 1.0 - uv.y;
    return uv;
}

// Generates a sine wave ring pattern (-1.0 to 1.0)
float getRingPattern(vec2 uv, vec2 centerPx, float relFreq, float relWidth, float rotDeg,
                     float globalPhase, float localPhase) {

    float aspect = resolution.x / resolution.y;
    vec2 effectiveCenterPx = (abs(centerPx.x) < 1e-6 && abs(centerPx.y) < 1e-6) ? (resolution * 0.5) : centerPx;
    vec2 centerUv = aePxToUv(effectiveCenterPx);
    
    vec2 p = uv - centerUv;
    p.x *= aspect;
    float rads = radians(rotDeg);
    p = rotate2d(rads) * p;
    p.x /= max(0.01, relWidth);
    
    float dist = length(p);
    return cos(dist * Frequency * relFreq * 20.0 + globalPhase + localPhase);
}

void main() {

    // 1. Progress (0.0 to 1.0)
    float progress;
    if (Auto_Trans > 0.5) {
        float autoSpeed = 0.5; 
        progress = clamp(time * autoSpeed, 0.0, 1.0);
    } else {
        progress = Wipe_Percent / 100.0;
    }
    progress = clamp(progress, 0.0, 1.0);

    // 2. Animation Phase
    float animTime = time;
    float globalPhase = Phase_Start + (Phase_Speed * animTime);
    float moireAnim  = Moire_Phase + (Moire_Speed * animTime);

    // 3. Generate Base Pattern
    float patA = getRingPattern(vUvScaled, A_Center_XY, A_Rel_Freq, A_Rel_Width, A_Rotate, globalPhase,  moireAnim);
    float patB = getRingPattern(vUvScaled, B_Center_XY, B_Rel_Freq, B_Rel_Width, B_Rotate, globalPhase, -moireAnim);

    float rawPattern = (patA + patB) * 0.5; // Natural bounds: [-1.0, 1.0]

    // 4. Gradient Slope Bounds Calculation
    float aspect = resolution.x / resolution.y;
    vec2 gUv = vUvScaled;
    gUv.x *= aspect;
    float gradRad = radians(Grad_Angle);
    vec2 gradDir = vec2(cos(gradRad), sin(gradRad));
    
    float minGrad = 0.0;
    float maxGrad = 0.0;
    float gradVal = 0.0;

    if (abs(Grad_Add) > 0.0) {
        gradVal = dot(gUv, gradDir) * (Grad_Add * 0.5);

        float d00 = 0.0;
        float d10 = gradDir.x * aspect;
        float d01 = gradDir.y;
        float d11 = gradDir.x * aspect + gradDir.y;

        float minDot = min(min(d00, d10), min(d01, d11));
        float maxDot = max(max(d00, d10), max(d01, d11));

        minGrad = minDot * (Grad_Add * 0.5);
        maxGrad = maxDot * (Grad_Add * 0.5);

        if (Grad_Add < 0.0) {
            float temp = minGrad;
            minGrad = maxGrad;
            maxGrad = temp;
        }
    }

    rawPattern += gradVal;

    // 5. Normalization
    float minRaw = -1.0 + minGrad;
    float maxRaw =  1.0 + maxGrad;
    float matte = (rawPattern - minRaw) / max(0.0001, (maxRaw - minRaw));

    // 6. Wipe & Softness Logic
    float softness = max(0.001, Edge_Softness * 0.01);
    float safeThreshold = mix(-softness, 1.0 + softness, progress);

    float alpha;
    if (Transition_Dir < 0.5) {
        alpha = smoothstep(safeThreshold - softness, safeThreshold + softness, matte);
    } else {
        alpha = 1.0 - smoothstep(safeThreshold - softness, safeThreshold + softness, matte);
    }

    // 7. Border Logic (Fixed Softness)
    vec4 borderFinal = vec4(0.0);
    if (Border_Width > 0.0) {
        float bSoft  = max(0.001, Border_Softness * 0.01);
        float bShift = Border_Shift * 0.1;
        float bWidth = Border_Width * 0.01;

        float distToEdge = abs(matte - (safeThreshold + bShift));

        // Symmetric smoothstep: expands the blur BOTH ways (inward and outward)
        float bMask = 1.0 - smoothstep(max(0.0, bWidth - bSoft), bWidth + bSoft, distToEdge);
        bMask *= Border_Opacity;

        borderFinal = vec4(Border_Color, bMask);
    }

    // 8. Final Composite
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec4 finalColor = texel;
    finalColor.a *= alpha;

    // Mix Border on top
    finalColor.rgb = mix(finalColor.rgb, borderFinal.rgb, borderFinal.a);
    finalColor.a   = max(finalColor.a, borderFinal.a);

    gl_FragColor = finalColor;
}
