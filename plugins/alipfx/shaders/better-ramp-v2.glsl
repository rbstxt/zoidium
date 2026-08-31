precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

// --- CUSTOM PROPERTIES ---
// 1. Gradient Type
uniform float Type; // 0 for Linear, 1 for Radial

// 2-9. Gradient Colors
uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;
uniform vec3 Color_7;
uniform vec3 Color_8;

// 10. Amount of active colors
uniform float Gradient_Colors; // Range: 2 to 8

// 11-12. Position mapping
uniform vec2 Start_Point;
uniform vec2 End_Point;

// 13-16. Value modifiers
uniform float Reverse;
uniform float Offset; // Angle in degrees
uniform float Warp_Blend; 
uniform float Scatter;

// 17-18. Blending
uniform float Blend_Mode; // 0 to 15
uniform float Blend_Opacity; // 0.0 to 100.0

// 19-20. Radial specific settings
uniform float Radial_Highlight_Angle;
uniform float Radial_Highlight_Length;

// -- GRADIENT SAMPLER --
vec3 getGradient(float t) {
    // Clamp to ensure we don't break the interpolator
    int count = int(clamp(Gradient_Colors, 2.0, 8.0));
    float pos = t * float(count - 1);
    int index = int(floor(pos));
    float frac = fract(pos);

    vec3 c0 = Color_1; 
    vec3 c1 = Color_2;
    
    // Dynamic array lookups via if-statements (Safe for all WebGL environments)
    if (index == 0) { c0 = Color_1; c1 = Color_2; }
    else if (index == 1) { c0 = Color_2; c1 = Color_3; }
    else if (index == 2) { c0 = Color_3; c1 = Color_4; }
    else if (index == 3) { c0 = Color_4; c1 = Color_5; }
    else if (index == 4) { c0 = Color_5; c1 = Color_6; }
    else if (index == 5) { c0 = Color_6; c1 = Color_7; }
    else if (index >= 6) { c0 = Color_7; c1 = Color_8; }

    return mix(c0, c1, frac);
}

void main() {
    // Fetch input layer
    vec4 baseTexel = texture2D(tDiffuse, vUvScaled);
    vec3 base = baseTexel.rgb;
    float alpha = baseTexel.a;

    // Convert UVs to precise pixel space mapping (Matches After Effects format)
    vec2 P = vUv * resolution;
    vec2 A = Start_Point;
    vec2 B = End_Point;

    // Apply Offset Rotation mapping
    float rad = radians(Offset);
    float s = sin(rad);
    float c = cos(rad);
    vec2 mid = (A + B) * 0.5;
    A = vec2(c * (A.x - mid.x) - s * (A.y - mid.y), s * (A.x - mid.x) + c * (A.y - mid.y)) + mid;
    B = vec2(c * (B.x - mid.x) - s * (B.y - mid.y), s * (B.x - mid.x) + c * (B.y - mid.y)) + mid;

    float t = 0.0;

    if (Type < 0.5) {
        // --- LINEAR MAPPING ---
        vec2 dir = B - A;
        float len2 = dot(dir, dir);
        t = (len2 > 0.0) ? dot(P - A, dir) / len2 : 0.0;
    } else {
        // --- RADIAL MAPPING WITH FOCAL OFFSET ---
        float R = length(B - A);
        vec2 F = A;
        
        // Push the focal highlight out
        if (Radial_Highlight_Length > 0.0) {
            float hRad = radians(Radial_Highlight_Angle);
            F = A + vec2(cos(hRad), sin(hRad)) * (Radial_Highlight_Length * R);
        }
        
        // Intersect ray with circle equation for precise focal gradient mapping
        vec2 D = P - F;
        vec2 F_rel = F - A;
        float a_val = dot(D, D);
        float b_val = 2.0 * dot(F_rel, D);
        float c_val = dot(F_rel, F_rel) - R * R;

        if (a_val > 0.0001) {
            float disc = b_val * b_val - 4.0 * a_val * c_val;
            if (disc >= 0.0) {
                float s_val = (-b_val + sqrt(disc)) / (2.0 * a_val);
                if (s_val > 0.0) {
                    t = 1.0 / s_val;
                }
            }
        } else {
            // Fallback safety if pixel precisely hits the focal point
            t = (R > 0.0) ? length(P - A) / R : 0.0;
        }
    }

    // Apply Scatter (Organic value-noise dithering)
    if (Scatter > 0.0) {
        float noise = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
        t += (noise - 0.5) * Scatter;
    }

    // Apply Reverse
    if (Reverse > 0.5) {
        t = 1.0 - t;
    }

    // Apply Warp Blend
    if (Warp_Blend > 0.0) {
        float wrapT = fract(t);
        t = mix(wrapT, smoothstep(0.0, 1.0, wrapT), Warp_Blend);
    } else {
        t = clamp(t, 0.0, 1.0); // Default Hard Clamp
    }

    // Pull final gradient color
    vec3 gradColor = getGradient(t);
    vec3 blended = gradColor;
    float op = clamp(Blend_Opacity / 100.0, 0.0, 1.0);

    int bm = int(Blend_Mode);

    // --- BLEND MODES (0 - 15) ---
    if (bm == 0) { blended = mix(base, gradColor, op); } // 0: None
    else if (bm == 1) { blended = mix(base, gradColor, op); } // 1: Normal
    else if (bm == 2) { blended = 1.0 - (1.0 - base) * (1.0 - gradColor); } // 2: Screen
    else if (bm == 3) { blended = base + gradColor; } // 3: Add
    else if (bm == 4) { blended = base * gradColor; } // 4: Multiply
    else if (bm == 5) { // 5: Overlay
        vec3 check = step(0.5, base);
        blended = mix(2.0 * base * gradColor, 1.0 - 2.0 * (1.0 - base) * (1.0 - gradColor), check);
    }
    else if (bm == 6) { // 6: Soft Light
        vec3 check = step(0.5, gradColor);
        blended = mix(base - (1.0 - 2.0 * gradColor) * base * (1.0 - base), base + (2.0 * gradColor - 1.0) * (sqrt(base) - base), check);
    }
    else if (bm == 7) { blended = abs(base - gradColor); } // 7: Difference
    else if (bm == 8) { blended = base / max(1.0 - gradColor, vec3(0.001)); } // 8: Color Dodge
    else if (bm == 9) { blended = 1.0 - (1.0 - base) / max(gradColor, vec3(0.001)); } // 9: Color Burn
    else if (bm == 10) { blended = min(base, gradColor); } // 10: Darken
    else if (bm == 11) { blended = max(base, gradColor); } // 11: Lighten
    else if (bm == 12) { alpha = alpha * (1.0 - length(gradColor) * op); blended = base; } // 12: Silhouette Alpha
    else if (bm == 13) { alpha = alpha * (1.0 - dot(gradColor, vec3(0.299, 0.587, 0.114)) * op); blended = base; } // 13: Silhouette Luma
    else if (bm == 14) { alpha = alpha * mix(1.0, length(gradColor), op); blended = base; } // 14: Stencil Alpha
    else if (bm == 15) { alpha = alpha * mix(1.0, dot(gradColor, vec3(0.299, 0.587, 0.114)), op); blended = base; } // 15: Stencil Luma

    // Apply Blend Opacity slider over final composite (applies to RGB composite modes 2-11)
    if (bm >= 2 && bm <= 11) {
        blended = mix(base, clamp(blended, 0.0, 1.0), op);
    }

    gl_FragColor = vec4(blended, alpha);
}
