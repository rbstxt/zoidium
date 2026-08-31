precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

// --- Better Ramp Uniforms ---
uniform vec2 Start_Point;
uniform vec3 Start_Color;
uniform float Start_Opacity;
uniform vec2 End_Point;
uniform vec3 End_Color;
uniform float End_Opacity;

uniform float Type; // 0: Linear, 1: Radial
uniform float Swap_Colors; // 0: Disabled, 1: Enabled

uniform float Radial_Highlight_Angle;
uniform float Radial_Highlight_Length;

uniform float Blend;
uniform float Bias;
uniform float Scatter;
uniform float Perceptual_Mix;
uniform float Blend_Mode;

// --- Oklab Perceptual Color Space Functions ---
float srgb_to_linear(float c) {
    return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 srgb_to_linear(vec3 c) {
    return vec3(srgb_to_linear(c.r), srgb_to_linear(c.g), srgb_to_linear(c.b));
}
float linear_to_srgb(float c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linear_to_srgb(vec3 c) {
    return vec3(linear_to_srgb(c.r), linear_to_srgb(c.g), linear_to_srgb(c.b));
}

vec3 linear_srgb_to_oklab(vec3 c) {
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    float l_ = pow(max(l, 0.0), 1.0/3.0);
    float m_ = pow(max(m, 0.0), 1.0/3.0);
    float s_ = pow(max(s, 0.0), 1.0/3.0);
    return vec3(
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    );
}

vec3 oklab_to_linear_srgb(vec3 c) {
    float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    float l = l_*l_*l_;
    float m = m_*m_*m_;
    float s = s_*s_*s_;
    return vec3(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
       -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
       -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

// --- High-Frequency Pseudo-Random Noise ---
float rand(vec2 co){
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// --- Blend Mode Functions ---
float blendOverlay(float b, float f) { return (b < 0.5) ? (2.0 * b * f) : (1.0 - 2.0 * (1.0 - b) * (1.0 - f)); }
vec3 blendOverlay(vec3 b, vec3 f) { return vec3(blendOverlay(b.r, f.r), blendOverlay(b.g, f.g), blendOverlay(b.b, f.b)); }
float blendSoftLight(float b, float f) { return (f < 0.5) ? (b - (1.0 - 2.0 * f) * b * (1.0 - b)) : (b + (2.0 * f - 1.0) * (sqrt(b) - b)); }
vec3 blendSoftLight(vec3 b, vec3 f) { return vec3(blendSoftLight(b.r, f.r), blendSoftLight(b.g, f.g), blendSoftLight(b.b, f.b)); }

void main() {
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
    vec2 uv = vUv * aspect;
    vec2 p1 = Start_Point * aspect;
    vec2 p2 = End_Point * aspect;

    float t = 0.0;
    
    if (Type < 0.5) {
        // Linear Mode
        vec2 dir = p2 - p1;
        float lenSq = dot(dir, dir);
        t = lenSq > 0.00001 ? dot(uv - p1, dir) / lenSq : 0.0;
    } else {
        // Radial Mode
        float r = distance(p1, p2);
        float angleRad = radians(Radial_Highlight_Angle);
        float shiftAmt = clamp(Radial_Highlight_Length / 100.0, 0.0, 0.999) * r;
        
        vec2 F = p1 + vec2(cos(angleRad), sin(angleRad)) * shiftAmt;
        vec2 C = p1;
        
        vec2 V = uv - F;
        vec2 D = C - F;
        
        float A = dot(D, D) - r * r;
        float B = -2.0 * dot(V, D);
        float C_val = dot(V, V);
        
        float disc = B * B - 4.0 * A * C_val;
        if (disc >= 0.0 && abs(A) > 0.00001) {
            float t_rad = (-B - sqrt(disc)) / (2.0 * A);
            if (t_rad < 0.0) t_rad = (-B + sqrt(disc)) / (2.0 * A);
            t = clamp(t_rad, 0.0, 1.0);
        } else {
            t = r > 0.00001 ? distance(uv, p1) / r : 0.0;
        }
    }

    t = clamp(t, 0.0, 1.0);

    // Normalize Opacities & Base Color assignments
    float actualStartOpacity = Start_Opacity > 1.0 ? Start_Opacity / 100.0 : Start_Opacity;
    float actualEndOpacity = End_Opacity > 1.0 ? End_Opacity / 100.0 : End_Opacity;
    vec3 colStart = Start_Color;
    vec3 colEnd = End_Color;

    // --- FIXED SWAP COLORS LOGIC ---
    // Swapping color definitions directly without modifying 't' removes the cancellation bug.
    if (Swap_Colors > 0.5) {
        float tempOp = actualStartOpacity;
        actualStartOpacity = actualEndOpacity;
        actualEndOpacity = tempOp;
        colStart = End_Color;
        colEnd = Start_Color;
    }

    // Smooth Contrast (Blend) and Distribution (Bias)
    float blendVal = max(Blend / 100.0, 0.0001);
    t = clamp((t - 0.5) / blendVal + 0.5, 0.0, 1.0);
    
    float biasVal = clamp(Bias / 100.0, 0.001, 0.999);
    t = pow(t, log(0.5) / log(biasVal));

    // Scatter Engine (restricts noise to boundaries properly)
    if (Scatter > 0.0) {
        float noise = (rand(vUv) - 0.5) * (Scatter / 100.0);
        t = clamp(t + noise, 0.0, 1.0);
    }

    // Color Mixing Matrix mapping
    vec3 linStart = srgb_to_linear(colStart);
    vec3 linEnd = srgb_to_linear(colEnd);
    
    vec3 okStart = linear_srgb_to_oklab(linStart);
    vec3 okEnd = linear_srgb_to_oklab(linEnd);
    vec3 okMix = oklab_to_linear_srgb(mix(okStart, okEnd, t));
    
    vec3 rgbMix = mix(linStart, linEnd, t);
    vec3 finalGradCol = linear_to_srgb(mix(rgbMix, okMix, Perceptual_Mix / 100.0));
    
    float finalGradAlpha = mix(actualStartOpacity, actualEndOpacity, t);

    // Final Compositing & Blend Modes
    vec4 baseTexel = texture2D(tDiffuse, vUvScaled);
    vec3 base = baseTexel.rgb;
    vec3 result = finalGradCol;
    float outAlpha = finalGradAlpha;

    if (Blend_Mode > 0.5 && Blend_Mode < 11.5) {
        vec3 blendedCol = finalGradCol;
        if (Blend_Mode == 1.0) { blendedCol = finalGradCol; }
        else if (Blend_Mode == 2.0) { blendedCol = 1.0 - (1.0 - base) * (1.0 - finalGradCol); }
        else if (Blend_Mode == 3.0) { blendedCol = min(base + finalGradCol, 1.0); }
        else if (Blend_Mode == 4.0) { blendedCol = base * finalGradCol; }
        else if (Blend_Mode == 5.0) { blendedCol = blendOverlay(base, finalGradCol); }
        else if (Blend_Mode == 6.0) { blendedCol = blendSoftLight(base, finalGradCol); }
        else if (Blend_Mode == 7.0) { blendedCol = abs(base - finalGradCol); }
        
        result = mix(base, blendedCol, finalGradAlpha);
        outAlpha = finalGradAlpha + baseTexel.a * (1.0 - finalGradAlpha);
    } 
    else if (Blend_Mode >= 12.0) {
        float luma = dot(finalGradCol, vec3(0.299, 0.587, 0.114));
        result = base;
        if (Blend_Mode == 12.0) { outAlpha = baseTexel.a * (1.0 - finalGradAlpha); }
        else if (Blend_Mode == 14.0) { outAlpha = baseTexel.a * finalGradAlpha; }
    }

    gl_FragColor = vec4(result, outAlpha);
}
