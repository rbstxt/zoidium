precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;

// --- Properties Map ---
uniform float Composite; 
uniform vec3 Color;
uniform float Size;
uniform vec2 Offset;
uniform float Invert_Offset;
uniform float Opacity; 
uniform float Sharp;
uniform float Long_Shadow;

// Additional Outline (Outline 2)
uniform float Enable_Outline_2;
uniform vec3 Color_Outline_2;
uniform float Size_Outline_2;
uniform vec2 Offset_Outline_2;
uniform float Invert_Offset_Outline_2; // Added independent invert offset
uniform float Opacity_Outline_2; 
uniform float Sharp_Outline_2;
uniform float Long_Shadow_Outline_2;

// Gradient Outline
uniform float Enable_Gradient;
uniform float Gradient_Type;
uniform float Gradient_Angle;
uniform vec3 Color_1; uniform vec3 Color_2; uniform vec3 Color_3; uniform vec3 Color_4;
uniform vec3 Color_5; uniform vec3 Color_6; uniform vec3 Color_7; uniform vec3 Color_8;
uniform float Gradient_Colors;

// Low Poly
uniform float Poly_Sample;
uniform float Random_Seed;
uniform float Fill_Holes;

#define PI 3.14159265359

// --- Helper Functions ---
vec4 blend(vec4 top, vec4 bot) {
    return top + bot * (1.0 - top.a);
}

float hash(vec2 p, float seed) {
    return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
}

vec2 getVoronoiUV(vec2 uv) {
    if (Poly_Sample <= 0.0) return uv;
    
    vec2 grid = floor(uv * Poly_Sample);
    vec2 fractUV = fract(uv * Poly_Sample);
    
    vec2 minDistUV = uv;
    float minDist = 10.0;
    
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 point = vec2(
                hash(grid + neighbor, Random_Seed),
                hash(grid + neighbor, Random_Seed + 123.456)
            );
            
            vec2 diff = neighbor + point - fractUV;
            float dist = dot(diff, diff);
            
            if (dist < minDist) {
                minDist = dist;
                minDistUV = (grid + neighbor + point) / Poly_Sample;
            }
        }
    }
    return minDistUV;
}

vec3 getGradient(float t) {
    t = clamp(t, 0.0, 1.0);
    float activeColors = max(2.0, Gradient_Colors);
    float stops = clamp(activeColors, 2.0, 8.0) - 1.0;
    float stepT = t * stops;
    
    int index = int(floor(stepT));
    float mixT = fract(stepT);
    
    if (index == 0) return mix(Color_1, Color_2, mixT);
    if (index == 1) return mix(Color_2, Color_3, mixT);
    if (index == 2) return mix(Color_3, Color_4, mixT);
    if (index == 3) return mix(Color_4, Color_5, mixT);
    if (index == 4) return mix(Color_5, Color_6, mixT);
    if (index == 5) return mix(Color_6, Color_7, mixT);
    if (index == 6) return mix(Color_7, Color_8, mixT);
    return Color_8;
}

vec3 applyGradient(vec2 uv, vec3 baseColor, float depth) {
    if (Enable_Gradient < 0.5) return baseColor;
    
    float t = 0.0;
    if (Gradient_Type < 0.5) {
        float rad = Gradient_Angle * (PI / 180.0);
        vec2 dir = vec2(cos(rad), sin(rad));
        t = dot(uv - 0.5, dir) + 0.5;
    } else if (Gradient_Type < 1.5) {
        t = length(uv - 0.5) * 2.0;
    } else {
        t = depth;
    }
    return getGradient(t);
}

// --- 8-Way Raycast to Detect Enclosed Gaps (Fill Holes) ---
bool checkIsHole(vec2 uv) {
    if (texture2D(tDiffuse, uv).a > 0.1) return false;
    
    int hits = 0;
    float stepSize = 0.015; 
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(float(i)*stepSize, 0.0)).a > 0.1) { hits++; break; } }
    if (hits == 0) return false; 
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(-float(i)*stepSize, 0.0)).a > 0.1) { hits++; break; } }
    if (hits == 1) return false;
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(0.0, float(i)*stepSize)).a > 0.1) { hits++; break; } }
    if (hits == 2) return false;
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(0.0, -float(i)*stepSize)).a > 0.1) { hits++; break; } }
    if (hits == 3) return false;
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(float(i)*stepSize, float(i)*stepSize)).a > 0.1) { hits++; break; } }
    if (hits == 4) return false;
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(-float(i)*stepSize, float(i)*stepSize)).a > 0.1) { hits++; break; } }
    if (hits == 5) return false;
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(float(i)*stepSize, -float(i)*stepSize)).a > 0.1) { hits++; break; } }
    if (hits == 6) return false;
    
    for(int i=1; i<=45; i++) { if(texture2D(tDiffuse, uv + vec2(-float(i)*stepSize, -float(i)*stepSize)).a > 0.1) { hits++; break; } }
    
    return hits == 8;
}

vec2 getAlphaAndDepth(vec2 uv, float size, vec2 offset, float sharp, float ls, float invOff, bool doDepthCalculation) {
    float finalAlpha = 0.0;
    float depth = 1.0; 
    vec2 px = 1.0 / resolution;
    
    vec2 finalOffset = offset * ((invOff > 0.5) ? -1.0 : 1.0);
    
    for(int j = 0; j < 30; j++) {
        if (ls < 0.5 && j > 0) break;
        
        float t = (ls > 0.5) ? float(j) / 29.0 : 0.0;
        vec2 c = uv - finalOffset * px * t; 
        
        float cA = texture2D(tDiffuse, c).a;
        if (cA > 0.0) {
            finalAlpha = max(finalAlpha, cA);
            depth = 0.0; 
        }
        
        if (size > 0.0) {
            if (doDepthCalculation) {
                for (int r = 1; r <= 5; r++) {
                    float currentDepth = float(r) / 5.0;
                    if (currentDepth >= depth) continue; 
                    
                    float currentRadius = currentDepth * size;
                    float ringAlpha = 0.0;
                    
                    for (int i = 0; i < 10; i++) {
                        float ang = float(i) * 0.62831853; 
                        ringAlpha = max(ringAlpha, texture2D(tDiffuse, c + vec2(cos(ang), sin(ang)) * currentRadius * px).a);
                    }
                    
                    if (ringAlpha > 0.0) {
                        finalAlpha = max(finalAlpha, ringAlpha);
                        depth = min(depth, currentDepth); 
                    }
                }
            } else {
                for (int i = 0; i < 12; i++) {
                    float ang = float(i) * 0.52359877; 
                    finalAlpha = max(finalAlpha, texture2D(tDiffuse, c + vec2(cos(ang), sin(ang)) * size * px).a);
                }
                for (int i = 0; i < 6; i++) {
                    float ang = float(i) * 1.04719755; 
                    finalAlpha = max(finalAlpha, texture2D(tDiffuse, c + vec2(cos(ang), sin(ang)) * size * 0.5 * px).a);
                }
            }
        }
    }
    
    if (sharp > 0.5) finalAlpha = step(0.01, finalAlpha);
    
    return vec2(clamp(finalAlpha, 0.0, 1.0), depth);
}

void main() {
    vec4 original = texture2D(tDiffuse, vUvScaled);
    vec4 result = vec4(0.0); 
    
    float op1 = clamp(Opacity * 0.01, 0.0, 1.0);
    float op2 = clamp(Opacity_Outline_2 * 0.01, 0.0, 1.0);
    
    bool useOutlineDepthGradient = (Enable_Gradient > 0.5 && Gradient_Type > 1.5 && Gradient_Type < 2.5);
    vec2 outlineUV = getVoronoiUV(vUvScaled);
    
    // Execute Raycast only if enabled
    bool isHole = false;
    if (Fill_Holes > 0.5) {
        isHole = checkIsHole(vUvScaled);
    }
    
    // Render Outline 2 (Bottom Layer) - Now uses Invert_Offset_Outline_2
    if (Enable_Outline_2 > 0.5 && op2 > 0.0) {
        vec2 out2;
        if (isHole) {
            out2 = vec2(1.0, 0.0); 
        } else {
            out2 = getAlphaAndDepth(outlineUV, Size_Outline_2, Offset_Outline_2, Sharp_Outline_2, Long_Shadow_Outline_2, Invert_Offset_Outline_2, false);
        }
        float a2 = clamp(out2.x * op2, 0.0, 1.0);
        result = vec4(Color_Outline_2 * a2, a2);
    }
    
    // Render Outline 1 (Middle Layer)
    if (op1 > 0.0) {
        vec2 out1;
        if (isHole) {
            out1 = vec2(1.0, 0.0);
        } else {
            out1 = getAlphaAndDepth(outlineUV, Size, Offset, Sharp, Long_Shadow, Invert_Offset, useOutlineDepthGradient);
        }
        float a1 = clamp(out1.x * op1, 0.0, 1.0);
        vec3 finalColor1 = applyGradient(outlineUV, Color, out1.y);
        vec4 layer1 = vec4(finalColor1 * a1, a1);
        result = blend(layer1, result); 
    }
    
    // Composite Output Logic
    if (Composite > 0.5) {
        // Outline Only: Mask out the original image alpha
        result *= (1.0 - original.a);
        gl_FragColor = result;
    } else {
        // Normal: Blend the original image on top
        result = blend(original, result);
        gl_FragColor = result;
    }
}
