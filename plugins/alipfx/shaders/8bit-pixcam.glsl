precision highp float;
precision highp int;

// Default Panzoid Uniforms & Varyings
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom 8Bit PixCam Uniforms (Automatically linked to PZ Properties)
uniform float Factor;
uniform float Brightness;
uniform float Contrast;
uniform float Dither_Level;
uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform float Draw_Grid_Lines;
uniform vec3 Grid_Color;

// Procedural 4x4 Bayer Dither Matrix Generation
float getBayer(vec2 pos) {
    int x = int(mod(pos.x, 4.0));
    int y = int(mod(pos.y, 4.0));
    int index = x + y * 4;
    
    float val = 0.0;
    if (index == 0) val = 0.0;
    else if (index == 1) val = 8.0;
    else if (index == 2) val = 2.0;
    else if (index == 3) val = 10.0;
    else if (index == 4) val = 12.0;
    else if (index == 5) val = 4.0;
    else if (index == 6) val = 14.0;
    else if (index == 7) val = 6.0;
    else if (index == 8) val = 3.0;
    else if (index == 9) val = 11.0;
    else if (index == 10) val = 1.0;
    else if (index == 11) val = 9.0;
    else if (index == 12) val = 15.0;
    else if (index == 13) val = 7.0;
    else if (index == 14) val = 13.0;
    else if (index == 15) val = 5.0;
    
    return val / 16.0;
}

void main() {
    // 1. Prevent division by zero and set minimum pixelation factor
    float safeFactor = max(1.0, Factor);
    vec2 fragCoord = vUv * resolution;
    
    // 2. Pixelate coordinates based on Factor
    vec2 pixelCoord = floor(fragCoord / safeFactor) * safeFactor;
    
    // 3. Convert back to UV space and apply Panzoid's uvScale buffer fix
    vec2 pUv = (pixelCoord + 0.5 * safeFactor) / resolution;
    vec2 pUvScaled = pUv * uvScale;
    
    // 4. Sample the underlying layer
    vec4 texel = texture2D(tDiffuse, pUvScaled);
    
    // 5. Apply Brightness and Contrast
    // Adjusting from a 1.0 baseline as default neutral
    vec3 adjusted = (texel.rgb - 0.5) * Contrast + 0.5 + (Brightness - 1.0);
    
    // 6. Calculate Grayscale Luminance (NTSC formula)
    float lum = dot(adjusted, vec3(0.299, 0.587, 0.114));
    
    // 7. Generate and Apply Bayer Dithering
    vec2 ditherCoord = floor(fragCoord / safeFactor);
    float ditherVal = getBayer(ditherCoord);
    
    // Center the dither value and apply intensity
    lum = lum + (ditherVal - 0.5) * Dither_Level;
    lum = clamp(lum, 0.0, 1.0);
    
    // 8. Map to 4-Color Palette based on luminance thresholds
    vec3 outColor;
    float stepNum = floor(lum * 4.0); // Bins into 0.0, 1.0, 2.0, 3.0, 4.0
    
    if (stepNum <= 0.0) {
        outColor = Color_1;
    } else if (stepNum <= 1.0) {
        outColor = Color_2;
    } else if (stepNum <= 2.0) {
        outColor = Color_3;
    } else {
        outColor = Color_4;
    }
    
    // 9. Overlay Grid Lines (1 pixel thick lines mapping to the Factor edge)
    if (Draw_Grid_Lines >= 0.5) {
        if (mod(fragCoord.x, safeFactor) < 1.0 || mod(fragCoord.y, safeFactor) < 1.0) {
            outColor = Grid_Color;
        }
    }
    
    // 10. Output Final Pixel
    gl_FragColor = vec4(outColor, texel.a);
}
