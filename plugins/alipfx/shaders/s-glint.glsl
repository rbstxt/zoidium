precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;

uniform float Brightness;
uniform float Hue_Shift;
uniform vec3 Scale_Colors;
uniform float Brightness_X;
uniform float Brightness_Y;
uniform float Brightness_Diag1;
uniform float Brightness_Diag2;
uniform float Threshold;
uniform vec3 Threshold_Add_Color;
uniform float Threshold_Blur;
uniform float Size;
uniform float Size_X;
uniform float Size_Y;
uniform float Size_Diag1;
uniform float Size_Diag2;
uniform float Size_Red;
uniform float Size_Green;
uniform float Size_Blue;
uniform float Blur_Glint;
uniform float Affect_Alpha;
uniform float Glint_From_Alpha;
uniform float Glint_Under_Source;
uniform float Source_Opacity;
uniform float Bg_Brightness;

// Helper: Convert RGB to HSV for Hue Shifting
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Helper: Convert HSV back to RGB
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Generates the highlight mask based on threshold
vec3 getHighlight(vec2 uv) {
    vec4 col = texture2D(tDiffuse, uv);
    
    // Simulate Threshold Blur via localized sampling
    if (Threshold_Blur > 0.0) {
        vec2 bOff = (Threshold_Blur / resolution) * uvScale * 1.5;
        col += texture2D(tDiffuse, uv + vec2(bOff.x, 0.0));
        col += texture2D(tDiffuse, uv - vec2(bOff.x, 0.0));
        col += texture2D(tDiffuse, uv + vec2(0.0, bOff.y));
        col += texture2D(tDiffuse, uv - vec2(0.0, bOff.y));
        col *= 0.2; 
    }
    
    vec3 highlight = col.rgb;
    
    if (Glint_From_Alpha > 0.5) {
        highlight = vec3(col.a);
    }
    
    // Apply Threshold & Add Color Penalty
    highlight.r = max(0.0, highlight.r - (Threshold + Threshold_Add_Color.r));
    highlight.g = max(0.0, highlight.g - (Threshold + Threshold_Add_Color.g));
    highlight.b = max(0.0, highlight.b - (Threshold + Threshold_Add_Color.b));
    
    return highlight;
}

// Core Raymarching Function
vec3 gatherRays(vec2 uv, vec2 dir, float szMul, float brMul) {
    vec3 acc = vec3(0.0);
    float baseSize = Size * szMul;
    
    if (baseSize <= 0.001 || brMul <= 0.001) return acc;
    
    // Increased steps so large size values (like 480) create smooth, solid rays
    const int STEPS = 48; 
    float fSteps = float(STEPS);
    vec2 px = 1.0 / resolution;
    
    // Treat Size exactly as it is (pixels/radius) without the artificial multiplier
    float maxDist = baseSize * 1.5; // Slight bump to match AE's screen-space scaling
    
    for(int i = 1; i <= STEPS; i++) {
        float t = float(i) / fSteps;
        
        vec2 offset = dir * (t * maxDist) * px * uvScale;
        vec2 perp = vec2(-dir.y, dir.x) * (Blur_Glint * t * 4.0) * px * uvScale;
        
        vec3 hP = getHighlight(uv + offset + perp);
        vec3 hM = getHighlight(uv - offset - perp);
        
        float wR = max(0.0, 1.0 - (t / max(0.001, Size_Red)));
        float wG = max(0.0, 1.0 - (t / max(0.001, Size_Green)));
        float wB = max(0.0, 1.0 - (t / max(0.001, Size_Blue)));
        
        float falloff = pow(1.0 - t, 2.0);
        
        acc.r += (hP.r + hM.r) * wR * falloff;
        acc.g += (hP.g + hM.g) * wG * falloff;
        acc.b += (hP.b + hM.b) * wB * falloff;
    }
    
    // Multiplier adjusted so the rays punch through nicely at high sample counts
    return (acc / fSteps) * brMul * 4.0; 
}

void main() {
    vec2 dirX  = vec2(1.0, 0.0);
    vec2 dirY  = vec2(0.0, 1.0);
    vec2 dirD1 = vec2(0.7071, -0.7071);
    vec2 dirD2 = vec2(0.7071, 0.7071); 
    
    vec3 glintColor = vec3(0.0);
    glintColor += gatherRays(vUvScaled, dirX, Size_X, Brightness_X);
    glintColor += gatherRays(vUvScaled, dirY, Size_Y, Brightness_Y);
    glintColor += gatherRays(vUvScaled, dirD1, Size_Diag1, Brightness_Diag1);
    glintColor += gatherRays(vUvScaled, dirD2, Size_Diag2, Brightness_Diag2);
    
    glintColor *= Brightness * Scale_Colors;
    
    if (abs(Hue_Shift) > 0.001) {
        vec3 hsv = rgb2hsv(glintColor);
        hsv.x = fract(hsv.x + Hue_Shift); 
        glintColor = hsv2rgb(hsv);
    }
    
    float maxColor = max(max(glintColor.r, glintColor.g), glintColor.b);
    float computedAlpha = clamp(maxColor * Affect_Alpha, 0.0, 1.0);
    vec4 finalGlint = vec4(glintColor, computedAlpha);
    
    vec4 src = texture2D(tDiffuse, vUvScaled);
    vec3 bgCol = src.rgb * Bg_Brightness;
    float sOpac = Source_Opacity;
    
    vec4 outColor = vec4(0.0);
    
    if (Glint_Under_Source > 0.5) {
        vec3 under = bgCol + finalGlint.rgb * (1.0 - src.a); 
        outColor.rgb = mix(under, src.rgb * Bg_Brightness, src.a * sOpac);
        outColor.a = max(src.a * sOpac, finalGlint.a);
    } else {
        outColor.rgb = (bgCol * sOpac) + finalGlint.rgb;
        outColor.a = clamp((src.a * sOpac) + finalGlint.a, 0.0, 1.0);
    }
    
    gl_FragColor = outColor;
}
