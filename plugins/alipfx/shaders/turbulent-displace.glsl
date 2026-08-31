precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale; // CRITICAL for Panzoid texturing
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom properties
// NOTE: If you make properties like Displacement or Pinning "Static" in Panzoid, 
// remove their 'uniform' declarations below, as Panzoid auto-injects them via #define.
uniform int Displacement;            // 0-8
uniform float Amount;                // Intensity (pixels)
uniform float Size;                  // Scale
uniform vec2 Offset;                 // Offset (Turbulence)
uniform float Complexity;            // Detail level
uniform float Evolution;             // Time animation (in degrees)
uniform int Cycle_Evolution;         // 0 or 1
uniform float Cycle_in_Revolutions;  // Loop cycles
uniform float Random_Seed;           // Noise seed
uniform int Pinning;                 // 0-14
uniform int Resize_Layer;            // 0 or 1
uniform int Antialiasing_for_Best_Quality; // 0 or 1

// Simplex noise function
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                   + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m;
    m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float deg2rad(float degrees) {
    return degrees * 0.017453292519943295;
}

// Fractal noise generator
float fractalNoise(vec2 uv, float complexity, float evolution, float seed) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    // Seed Offset
    uv += vec2(seed * 100.0);
    
    // Evolution Translation (Simple approach, accurate 3D requires 3D noise)
    float evoRad = deg2rad(evolution) * 0.1;
    uv += vec2(cos(evoRad), sin(evoRad)) * evolution * 0.005; // Adds a swirling effect
    
    for (int i = 0; i < 8; i++) {
        if (float(i) >= complexity) break;
        value += amplitude * snoise(uv * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    
    float frac = fract(complexity);
    if (frac > 0.0 && complexity > 0.0 && complexity < 8.0) {
        value += frac * amplitude * snoise(uv * frequency);
    }
    return value;
}

float getEvolvedValue(float baseEvolution, int cycleEnabled, float cycleRevolutions) {
    if (cycleEnabled == 1 && cycleRevolutions > 0.0) {
        float totalDegrees = cycleRevolutions * 360.0;
        return mod(baseEvolution, totalDegrees);
    }
    return baseEvolution;
}

vec2 getPinningMask(vec2 uv, int pinMode) {
    vec2 mask = vec2(1.0);
    float leftDist = uv.x;
    float rightDist = 1.0 - uv.x;
    float bottomDist = uv.y;
    float topDist = 1.0 - uv.y;
    
    float smth = 0.05;
    float lckSmth = 0.01;
    float falloff = 0.05;
    
    if (pinMode == 1) { mask.x = smoothstep(0.0, smth, min(leftDist, rightDist)); mask.y = smoothstep(0.0, smth, min(bottomDist, topDist)); }
    else if (pinMode == 2) { mask.x = smoothstep(0.0, smth, min(leftDist, rightDist)); }
    else if (pinMode == 3) { mask.y = smoothstep(0.0, smth, min(bottomDist, topDist)); }
    else if (pinMode == 4) { mask.x = smoothstep(0.0, smth, leftDist); }
    else if (pinMode == 5) { mask.x = smoothstep(0.0, smth, rightDist); }
    else if (pinMode == 6) { mask.y = smoothstep(0.0, smth, topDist); }
    else if (pinMode == 7) { mask.y = smoothstep(0.0, smth, bottomDist); }
    else if (pinMode == 8) { 
        mask.x = smoothstep(0.0, lckSmth, min(leftDist, rightDist)) * smoothstep(0.0, falloff, min(leftDist, rightDist)); 
        mask.y = smoothstep(0.0, lckSmth, min(bottomDist, topDist)) * smoothstep(0.0, falloff, min(bottomDist, topDist)); 
    }
    else if (pinMode == 9) { mask.x = smoothstep(0.0, lckSmth, min(leftDist, rightDist)) * smoothstep(0.0, falloff, min(leftDist, rightDist)); }
    else if (pinMode == 10) { mask.y = smoothstep(0.0, lckSmth, min(bottomDist, topDist)) * smoothstep(0.0, falloff, min(bottomDist, topDist)); }
    else if (pinMode == 11) { mask.x = smoothstep(0.0, lckSmth, leftDist) * smoothstep(0.0, falloff, leftDist); }
    else if (pinMode == 12) { mask.x = smoothstep(0.0, lckSmth, rightDist) * smoothstep(0.0, falloff, rightDist); }
    else if (pinMode == 13) { mask.y = smoothstep(0.0, lckSmth, topDist) * smoothstep(0.0, falloff, topDist); }
    else if (pinMode == 14) { mask.y = smoothstep(0.0, lckSmth, bottomDist) * smoothstep(0.0, falloff, bottomDist); }
    
    return mask;
}

vec2 applyDisplacement(vec2 scaledUV, int mode, float amount, float complexity, float evolvedValue, float seed, vec2 pinMask) {
    vec2 displacement = vec2(0.0);
    
    vec2 amountUV = (amount * pinMask) / resolution;
    
    float n1 = fractalNoise(scaledUV, complexity, evolvedValue, seed);

    if (mode == 0 || mode == 3 || mode == 8) { 
        // Turbulent / Turbulent Smoother / Cross
        float comp = (mode == 3) ? max(1.0, complexity * 0.5) : complexity;
        float n2 = fractalNoise(scaledUV + vec2(100.0, 50.0), comp, evolvedValue, seed + 100.0);
        
        // FIX: The core issue was that standard noise ranges -1 to 1. 
        // If we want a turbulent displacement that shifts pixels primarily in one direction, 
        // we might need an absolute value or a different mapping.
        // In standard After Effects 'Turbulent' displacement, it often pushes coordinates using noise mapped to [-1, 1]
        // Let's refine the displacement mapping.
        displacement = vec2(n1, n2) * amountUV * 2.0;
    }
    else if (mode == 1 || mode == 4 || mode == 2 || mode == 5) { 
        // Bulge / Twist modes ... (keeping your previous logic)
        float comp = (mode == 4 || mode == 5) ? max(1.0, complexity * 0.5) : complexity;
        
        vec2 eps = vec2(0.02, 0.0);
        float nX1 = fractalNoise(scaledUV - eps.xy, comp, evolvedValue, seed);
        float nX2 = fractalNoise(scaledUV + eps.xy, comp, evolvedValue, seed);
        float nY1 = fractalNoise(scaledUV - eps.yx, comp, evolvedValue, seed);
        float nY2 = fractalNoise(scaledUV + eps.yx, comp, evolvedValue, seed);
        vec2 grad = vec2(nX2 - nX1, nY2 - nY1) * (1.0 / (2.0 * eps.x));

        if (mode == 1 || mode == 4) {
            displacement = grad * amountUV * 0.35; // Bulge
        } else {
            displacement = vec2(grad.y, -grad.x) * amountUV * 0.35; // Twist
        }
    }
    else if (mode == 6) { // Vertical Displacement
        displacement = vec2(0.0, n1 * amountUV.y * 2.0);
    }
    else if (mode == 7) { // Horizontal Displacement
        displacement = vec2(n1 * amountUV.x * 2.0, 0.0);
    }
    
    return displacement;
}

void main() {
    vec2 uv = vUv;
    
    vec2 aspect = vec2(resolution.x / min(resolution.x, resolution.y), resolution.y / min(resolution.x, resolution.y));
    vec2 aspectUV = uv * aspect;
    
    vec2 scaledUV = aspectUV * (100.0 / max(Size, 0.001)) - (Offset / min(resolution.x, resolution.y));
    
    float evolvedValue = getEvolvedValue(Evolution, Cycle_Evolution, Cycle_in_Revolutions);
    vec2 pinMask = getPinningMask(uv, Pinning);
    
    vec2 displacement = applyDisplacement(scaledUV, Displacement, Amount, Complexity, evolvedValue, Random_Seed, pinMask);
    
    vec2 displacedUV = uv + displacement;
    if (Resize_Layer == 0) {
        displacedUV = clamp(displacedUV, 0.0, 1.0);
    }
    
    vec2 finalBufferUV = displacedUV * uvScale;
    
    vec4 color;
    if (Antialiasing_for_Best_Quality == 1) {
        vec2 texelSize = uvScale / resolution;
        color = texture2D(tDiffuse, finalBufferUV);
        color += texture2D(tDiffuse, finalBufferUV + vec2(texelSize.x, 0.0));
        color += texture2D(tDiffuse, finalBufferUV + vec2(-texelSize.x, 0.0));
        color += texture2D(tDiffuse, finalBufferUV + vec2(0.0, texelSize.y));
        color += texture2D(tDiffuse, finalBufferUV + vec2(0.0, -texelSize.y));
        color /= 5.0;
    } else {
        color = texture2D(tDiffuse, finalBufferUV);
    }
    
    gl_FragColor = color;
}
