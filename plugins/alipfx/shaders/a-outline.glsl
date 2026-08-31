precision highp float;
precision highp int;

// Panzoid Built-ins
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;

// --- Properties Map ---
uniform vec3 Color;
uniform float Size;
uniform vec2 Offset;
uniform float Opacity; // Now expects 0 - 100
uniform float Sharp;
uniform float Long_Shadow;

uniform float Enable_Outline_2;
uniform vec3 Color_Outline_2;
uniform float Size_Outline_2;
uniform vec2 Offset_Outline_2;
uniform float Opacity_Outline_2; // Now expects 0 - 100
uniform float Sharp_Outline_2;
uniform float Long_Shadow_Outline_2;

// --- Premultiplied Alpha Compositing ---
vec4 blend(vec4 top, vec4 bot) {
    return top + bot * (1.0 - top.a);
}

// --- Outline Generation Logic ---
float getAlpha(vec2 uv, float size, vec2 offset, float sharp, float ls) {
    float a = 0.0;
    vec2 px = 1.0 / resolution;
    
    // Loop steps for Long Shadow extrusion
    // 30 steps gives a buttery smooth continuous shadow
    for(int j = 0; j < 30; j++) {
        // Break early if Long Shadow is disabled to save massive GPU performance
        if (ls < 0.5 && j > 0) break;
        
        float t = (ls > 0.5) ? float(j) / 29.0 : 1.0;
        vec2 c = uv - offset * px * t; // Offset is converted to pixel space
        
        // Sample center baseline
        a = max(a, texture2D(tDiffuse, c).a);
        
        // Sample surrounding radius for "Size"
        if (size > 0.0) {
            // Outer Ring (12 samples)
            for (int i = 0; i < 12; i++) {
                float ang = float(i) * 0.52359877; // 2PI / 12
                a = max(a, texture2D(tDiffuse, c + vec2(cos(ang), sin(ang)) * size * px).a);
            }
            // Inner Ring (6 samples) for structural integrity on thick sizes
            for (int i = 0; i < 6; i++) {
                float ang = float(i) * 1.04719755; // 2PI / 6
                a = max(a, texture2D(tDiffuse, c + vec2(cos(ang), sin(ang)) * size * 0.5 * px).a);
            }
        }
    }
    
    // Hard clamp edges if Sharp is enabled
    if (sharp > 0.5) {
        a = step(0.01, a);
    }
    
    return clamp(a, 0.0, 1.0);
}

void main() {
    // WebGL textures (tDiffuse) are inherently premultiplied by default
    vec4 original = texture2D(tDiffuse, vUvScaled);
    vec4 result = vec4(0.0); // Start with transparent empty layer
    
    // Convert 0-100 Opacity down to 0.0-1.0 range
    float op1 = clamp(Opacity * 0.01, 0.0, 1.0);
    float op2 = clamp(Opacity_Outline_2 * 0.01, 0.0, 1.0);
    
    // 1. Render Outline 2 (Bottom-most Layer)
    if (Enable_Outline_2 > 0.5 && op2 > 0.0) {
        float a2 = getAlpha(vUvScaled, Size_Outline_2, Offset_Outline_2, Sharp_Outline_2, Long_Shadow_Outline_2);
        a2 = clamp(a2 * op2, 0.0, 1.0);
        
        // Pre-multiply RGB by Alpha
        result = vec4(Color_Outline_2 * a2, a2);
    }
    
    // 2. Render Outline 1 (Middle Layer)
    if (op1 > 0.0) {
        float a1 = getAlpha(vUvScaled, Size, Offset, Sharp, Long_Shadow);
        a1 = clamp(a1 * op1, 0.0, 1.0);
        
        // Pre-multiply RGB by Alpha
        vec4 layer1 = vec4(Color * a1, a1);
        result = blend(layer1, result); // Blend Outline 1 over Outline 2
    }
    
    // 3. Render Original Input (Top Layer)
    result = blend(original, result); // Blend Original over everything else
    
    // Final output
    gl_FragColor = result;
}
