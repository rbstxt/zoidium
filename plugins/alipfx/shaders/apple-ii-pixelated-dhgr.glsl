precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution; // Panzoid's built-in layer resolution

// 16-Color Palette
uniform float Pixel_Size;
vec3 palette[16];

void initPalette() {
    palette[0] = vec3(0.000, 0.000, 0.000); // Black
    palette[1] = vec3(0.890, 0.180, 0.380); // Deep Red
    palette[2] = vec3(0.120, 0.150, 0.600); // Dark Blue
    palette[3] = vec3(0.900, 0.350, 0.900); // Purple
    palette[4] = vec3(0.000, 0.450, 0.150); // Dark Green
    palette[5] = vec3(0.333, 0.333, 0.333); // Dark Gray
    palette[6] = vec3(0.150, 0.660, 0.950); // Medium Blue
    palette[7] = vec3(0.600, 0.750, 1.000); // Light Blue
    palette[8] = vec3(0.500, 0.300, 0.000); // Brown
    palette[9] = vec3(1.000, 0.400, 0.000); // Orange
    palette[10]= vec3(0.666, 0.666, 0.666); // Light Gray
    palette[11]= vec3(1.000, 0.600, 0.600); // Pink
    palette[12]= vec3(0.100, 0.900, 0.100); // Light Green
    palette[13]= vec3(1.000, 0.900, 0.000); // Yellow
    palette[14]= vec3(0.300, 0.900, 0.700); // Aqua
    palette[15]= vec3(1.000, 1.000, 1.000); // White
}

// 4x4 Bayer Dither Matrix Generator (Optimized for pixel chunks)
float getBayer(vec2 p) {
    vec2 v = mod(p, 4.0);
    float f = 0.0;
    if (v.y < 1.0) {
        if (v.x < 1.0) f=0.0; else if (v.x < 2.0) f=8.0; else if (v.x < 3.0) f=2.0; else f=10.0;
    } else if (v.y < 2.0) {
        if (v.x < 1.0) f=12.0; else if (v.x < 2.0) f=4.0; else if (v.x < 3.0) f=14.0; else f=6.0;
    } else if (v.y < 3.0) {
        if (v.x < 1.0) f=3.0; else if (v.x < 2.0) f=11.0; else if (v.x < 3.0) f=1.0; else f=9.0;
    } else {
        if (v.x < 1.0) f=15.0; else if (v.x < 2.0) f=7.0; else if (v.x < 3.0) f=13.0; else f=5.0;
    }
    return f / 16.0 - 0.5; 
}

// Perceptual distance for color matching
float colorDist(vec3 c1, vec3 c2) {
    vec3 diff = c1 - c2;
    vec3 weights = vec3(0.299, 0.587, 0.114);
    diff = diff * diff * weights;
    return diff.x + diff.y + diff.z;
}

vec3 quantize(vec3 color) {
    vec3 closest = palette[0];
    float minDist = 999.0;
    for(int i = 0; i < 16; i++) {
        float d = colorDist(color, palette[i]);
        if(d < minDist) { minDist = d; closest = palette[i]; }
    }
    return closest;
}

void main() {
    initPalette();

    // --- CONFIGURATION ---
    // Increase this number to make the pixels chunkier!
    // Try 2.0, 4.0, or 6.0
    float pixelSize = Pixel_Size; 
    // ---------------------

    // Calculate how many chunky "blocks" fit on the screen
    vec2 grid = resolution / pixelSize;
    
    // Snap the UV coordinates to that grid
    vec2 pixelatedUv = floor(vUv * grid) / grid;
    
    // Sample the video layer at those pixelated coordinates
    vec4 texel = texture2D(tDiffuse, pixelatedUv * uvScale);
    vec3 color = texel.rgb;
    
    // Contrast boost to ensure vibrant retro color mapping
    color = (color - 0.5) * 1.3 + 0.5;
    
    // Calculate the Bayer dither mapping to the chunky pixel grid
    // This ensures the dither pattern scales properly with your pixel size
    float ditherVal = getBayer(floor(vUv * grid));
    
    // Apply the dither spread
    color += ditherVal * 0.4;
    
    // Snap to the closest Apple II color
    vec3 finalColor = quantize(clamp(color, 0.0, 1.0));
    
    // Output to Panzoid
    gl_FragColor = vec4(finalColor, texel.a);
}
