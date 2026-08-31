precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

// Custom Panzoid Properties (Spaces automatically converted to underscores)
uniform float Factor;
uniform float Saturation;
uniform float Dithering;
uniform float Dither_Level;
uniform float Alpha_from_Src;
uniform float CRT_Filter;
uniform float CRT_Horizontal_Alpha;
uniform float CRT_Vertical_Alpha;
uniform float CRT_Blur_Radius;
uniform float CRT_RGB_Shift_1;
uniform float CRT_RGB_Shift_2;
uniform float Brightness;
uniform float Brightness_Threshold;
uniform float Palette;

// Custom Palette Colors
uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;
uniform vec3 Color_7;
uniform vec3 Color_8;

varying vec2 vUvScaled;
varying vec2 vUv;

// --- Dithering Matrices (Mathematically unrolled for WebGL 1.0 compatibility) ---
float bayer4x4(vec2 p) {
    vec2 v = mod(p, 4.0);
    int idx = int(v.x) + int(v.y) * 4;
    if(idx==0) return 0.0/16.0 - 0.5;   if(idx==1) return 8.0/16.0 - 0.5;
    if(idx==2) return 2.0/16.0 - 0.5;   if(idx==3) return 10.0/16.0 - 0.5;
    if(idx==4) return 12.0/16.0 - 0.5;  if(idx==5) return 4.0/16.0 - 0.5;
    if(idx==6) return 14.0/16.0 - 0.5;  if(idx==7) return 6.0/16.0 - 0.5;
    if(idx==8) return 3.0/16.0 - 0.5;   if(idx==9) return 11.0/16.0 - 0.5;
    if(idx==10) return 1.0/16.0 - 0.5;  if(idx==11) return 9.0/16.0 - 0.5;
    if(idx==12) return 15.0/16.0 - 0.5; if(idx==13) return 7.0/16.0 - 0.5;
    if(idx==14) return 13.0/16.0 - 0.5; return 5.0/16.0 - 0.5;
}

float bayer8x8(vec2 p) {
    vec2 v1 = mod(p, 4.0);
    vec2 v2 = mod(floor(p / 4.0), 2.0);
    float b4 = bayer4x4(v1) + 0.5;
    int idx2 = int(v2.x) + int(v2.y) * 2;
    float b2 = 0.0;
    if(idx2==0) b2=0.0; else if(idx2==1) b2=2.0; else if(idx2==2) b2=3.0; else b2=1.0;
    return ((b4 + b2 * 16.0) / 64.0) - 0.5;
}

float bayer8x4(vec2 p) {
    return bayer8x8(vec2(p.x, p.y * 2.0));
}

// --- Palette Matching Logic ---
vec3 mapToPalette(vec3 col, int pal) {
    if (pal == 0) return col; // None

    vec3 best = vec3(0.0);
    float minD = 999.0;
    
    // Macro to check distance quickly
    #define CHK(c) { float d = dot(col-(c), col-(c)); if(d < minD) { minD = d; best = (c); } }

    if (pal == 1) { // Picker Mode
        CHK(Color_1); CHK(Color_2); CHK(Color_3); CHK(Color_4);
        CHK(Color_5); CHK(Color_6); CHK(Color_7); CHK(Color_8);
    } 
    else if (pal == 2) { // NES (Essential Subset)
        CHK(vec3(0.0)); CHK(vec3(1.0)); CHK(vec3(0.46,0.46,0.46)); CHK(vec3(0.0,0.0,0.98));
        CHK(vec3(0.0,0.45,0.85)); CHK(vec3(0.0,0.68,0.52)); CHK(vec3(0.0,0.65,0.0));
        CHK(vec3(0.22,0.56,0.0)); CHK(vec3(0.54,0.44,0.0)); CHK(vec3(0.79,0.33,0.0));
        CHK(vec3(0.89,0.11,0.0)); CHK(vec3(0.87,0.0,0.45)); CHK(vec3(0.68,0.0,0.8));
        CHK(vec3(0.39,0.0,0.98));
    } 
    else if (pal == 3) { // GBC
        CHK(vec3(0.05,0.22,0.05)); CHK(vec3(0.18,0.38,0.18));
        CHK(vec3(0.54,0.67,0.05)); CHK(vec3(0.60,0.73,0.05));
    } 
    else if (pal == 4) { // Commodore 64
        CHK(vec3(0.0)); CHK(vec3(1.0)); CHK(vec3(0.53,0.0,0.0)); CHK(vec3(0.66,1.0,0.93));
        CHK(vec3(0.8,0.26,0.8)); CHK(vec3(0.0,0.8,0.33)); CHK(vec3(0.0,0.0,0.66));
        CHK(vec3(0.93,0.93,0.46)); CHK(vec3(0.86,0.53,0.33)); CHK(vec3(0.4,0.26,0.0));
        CHK(vec3(1.0,0.46,0.46)); CHK(vec3(0.2)); CHK(vec3(0.46)); CHK(vec3(0.66,1.0,0.4));
        CHK(vec3(0.0,0.53,1.0)); CHK(vec3(0.73));
    }
    else if (pal == 5) { // Aqua
        CHK(vec3(0.0,0.2,0.4)); CHK(vec3(0.0,0.4,0.6)); CHK(vec3(0.0,0.6,0.8)); CHK(vec3(0.0,0.8,1.0)); CHK(vec3(0.2,1.0,1.0)); CHK(vec3(1.0));
    }
    else if (pal == 6) { // Retro
        CHK(vec3(0.1,0.0,0.2)); CHK(vec3(0.4,0.0,0.4)); CHK(vec3(0.8,0.0,0.4)); CHK(vec3(1.0,0.2,0.0)); CHK(vec3(1.0,0.8,0.0)); CHK(vec3(0.0,1.0,1.0));
    }
    else if (pal == 7) { // Pastel128
        CHK(vec3(1.0,0.7,0.7)); CHK(vec3(0.7,1.0,0.7)); CHK(vec3(0.7,0.7,1.0)); CHK(vec3(1.0,1.0,0.7)); CHK(vec3(0.7,1.0,1.0)); CHK(vec3(1.0,0.7,1.0)); CHK(vec3(0.9)); CHK(vec3(0.5));
    }
    else if (pal == 8) { // Fire_1
        CHK(vec3(0.0)); CHK(vec3(0.3,0.0,0.0)); CHK(vec3(0.6,0.1,0.0)); CHK(vec3(0.9,0.3,0.0)); CHK(vec3(1.0,0.6,0.0)); CHK(vec3(1.0,0.9,0.0)); CHK(vec3(1.0));
    }
    else if (pal == 9) { // Fire_2
        CHK(vec3(0.1,0.0,0.0)); CHK(vec3(0.4,0.0,0.1)); CHK(vec3(0.8,0.2,0.1)); CHK(vec3(1.0,0.5,0.2)); CHK(vec3(1.0,0.8,0.4)); CHK(vec3(1.0,1.0,0.8));
    }
    
    return best;
}

// --- Main Pixel Processing Function ---
vec4 getPixelatedSample(vec2 uv) {
    float f = max(1.0, floor(Factor));
    vec2 gridUv = floor(uv * resolution / f) * f / resolution;
    vec2 centerUv = gridUv + (f / 2.0) / resolution;
    vec2 texUv = centerUv * uvScale;
    
    vec4 baseCol = texture2D(tDiffuse, texUv);
    
    // 1. Handle Alpha Inheritance
    float alpha = baseCol.a;
    if (Alpha_from_Src < 0.5) {
        alpha = step(0.99, alpha);
    }
    
    // 2. Saturation Processing
    float lum = dot(baseCol.rgb, vec3(0.299, 0.587, 0.114));
    vec3 col = mix(vec3(lum), baseCol.rgb, 1.0 + Saturation);
    
    // 3. Dithering Processing
    vec2 ditherCoord = floor(gridUv * resolution / f);
    float ditherVal = 0.0;
    int dMode = int(Dithering);
    
    if (dMode == 1) ditherVal = bayer4x4(ditherCoord);
    else if (dMode == 2) ditherVal = bayer8x8(ditherCoord);
    else if (dMode == 3) ditherVal = bayer8x4(ditherCoord);
    
    col += ditherVal * Dither_Level;
    
    // 4. Quantize to Palette
    col = mapToPalette(clamp(col, 0.0, 1.0), int(Palette));
    
    return vec4(col, alpha);
}

void main() {
    vec4 finalOut;
    
    if (CRT_Filter < 0.5) {
        finalOut = getPixelatedSample(vUv);
    } else {
        // --- CRT Filter: Shift & Blur Logic ---
        float br = CRT_Blur_Radius;
        float s1 = CRT_RGB_Shift_1 / resolution.x;
        float s2 = CRT_RGB_Shift_2 / resolution.x;
        
        vec2 off[5];
        off[0] = vec2(0.0);
        off[1] = vec2(1.0, 0.0) * br / resolution;
        off[2] = vec2(-1.0, 0.0) * br / resolution;
        off[3] = vec2(0.0, 1.0) * br / resolution;
        off[4] = vec2(0.0, -1.0) * br / resolution;
        
        vec3 blurredCol = vec3(0.0);
        float alphaAccum = 0.0;
        
        // Combine Pre-blur shift (s1) and Post-blur chromatic shift (s2)
        for(int i = 0; i < 5; i++) {
            vec2 tapUv = vUv + off[i];
            vec4 rTap = getPixelatedSample(tapUv + vec2(s1 + s2, 0.0));
            vec4 gTap = getPixelatedSample(tapUv);
            vec4 bTap = getPixelatedSample(tapUv - vec2(s1 + s2, 0.0));
            
            blurredCol += vec3(rTap.r, gTap.g, bTap.b);
            alphaAccum += gTap.a; // Use green channel alpha as structural baseline
        }
        
        blurredCol *= 0.2;
        alphaAccum *= 0.2;
        
        // --- CRT Scanlines ---
        float scanH = sin(vUv.y * resolution.y * 3.14159) * 0.5 + 0.5;
        float scanV = sin(vUv.x * resolution.x * 3.14159) * 0.5 + 0.5;
        
        blurredCol *= (1.0 - (1.0 - scanH) * CRT_Horizontal_Alpha);
        blurredCol *= (1.0 - (1.0 - scanV) * CRT_Vertical_Alpha);
        
        finalOut = vec4(max(vec3(0.0), blurredCol), alphaAccum);
    }
    
    // --- Post-Processing Brightness (Recalculating darkened CRT screens) ---
    float outLum = dot(finalOut.rgb, vec3(0.299, 0.587, 0.114));
    if ((outLum * 255.0) <= Brightness_Threshold) {
        // Brightness scaled for standard 0-255 mapping
        finalOut.rgb += (Brightness / 255.0); 
    }
    
    gl_FragColor = finalOut;
}
