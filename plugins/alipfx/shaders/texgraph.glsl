precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;

// Panzoid Custom Properties Map
uniform float Scale;
uniform float Erode;
uniform float Dither_Level;
uniform float Text_Color_from_SRC;
uniform float Text_BG_Color_from_SRC;
uniform vec3 Text_Color;
uniform vec3 Text_BG_Color;
uniform float Text_BG_Alpha;

// Pseudo-random hash function for selecting characters & dithering
float hash12(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Bit extractor for the procedural 3x5 font grid
float getBit(float n, vec2 p) {
    if (p.x < 0.0 || p.x > 2.0 || p.y < 0.0 || p.y > 4.0) return 0.0;
    float bitPos = p.x + p.y * 3.0;
    // float arithmetic for WebGL 1 cross-compatibility
    return mod(floor(n / exp2(bitPos)), 2.0);
}

// 16 alphanumeric characters compressed into 15-bit float masks
float getCharMask(int index) {
    if(index == 0) return 31599.0; // 0 / O
    if(index == 1) return 29874.0; // 1
    if(index == 2) return 29671.0; // 2
    if(index == 3) return 31207.0; // 3
    if(index == 4) return 23497.0; // 4
    if(index == 5) return 31183.0; // 5
    if(index == 6) return 31215.0; // 6
    if(index == 7) return 29257.0; // 7
    if(index == 8) return 31727.0; // 8 / B
    if(index == 9) return 31711.0; // 9
    if(index == 10) return 23533.0; // H
    if(index == 11) return 29647.0; // E
    if(index == 12) return 29263.0; // C
    if(index == 13) return 27503.0; // D
    if(index == 14) return 11115.0; // L
    if(index == 15) return 23182.0; // S
    return 31599.0;
}

void main() {
    // Prevent zero division, actual text sizing logic
    float actualScale = max(Scale, 1.0);

    // Font is 3x5 pixels. We use a 4x6 block to include 1px spacing horizontally and vertically.
    vec2 blockSize = actualScale * vec2(4.0, 6.0);

    // Pixel coordinate handling mapped to screen resolution
    vec2 fragCoord = (vUvScaled / uvScale) * resolution;

    // Grid coordinates
    vec2 blockPos = floor(fragCoord / blockSize);

    // Coordinates within the current grid cell (normalized 0.0 - 1.0)
    vec2 localUv = fract(fragCoord / blockSize);

    // Coordinate mapping to our specific 4x6 pixel setup
    vec2 charPixel = floor(localUv * vec2(4.0, 6.0));

    // Sample the center of the block for accurate source coloring
    vec2 blockCenter = (blockPos + 0.5) * blockSize;
    vec2 sampleUv = (blockCenter / resolution) * uvScale;

    vec4 srcColor = texture2D(tDiffuse, sampleUv);

    // Generate random seed per block
    float randVal = hash12(blockPos);

    // Select random alphanumeric character from our dictionary (0 to 15)
    int charIdx = int(mod(randVal * 16.0, 16.0));
    float charMask = getCharMask(charIdx);

    float isText = 0.0;

    // Constrain rendering strictly within the 3x5 area, leaving a gap.
    if (charPixel.x < 3.0 && charPixel.y < 5.0) {
        isText = getBit(charMask, charPixel);

        // ERODE Logic: Thickens the contour line mathematically
        if (Erode >= 1.0 && isText == 0.0) {
            float n1 = getBit(charMask, charPixel + vec2(1.0, 0.0));
            float n2 = getBit(charMask, charPixel - vec2(1.0, 0.0));
            float n3 = getBit(charMask, charPixel + vec2(0.0, 1.0));
            float n4 = getBit(charMask, charPixel - vec2(0.0, 1.0));
            isText = max(max(n1, n2), max(n3, n4));
        }
    }

    // Source Luminance Calculation for Masking
    float lum = dot(srcColor.rgb, vec3(0.299, 0.587, 0.114));

    // DITHER Logic: Adjusts text placement probability across gradients
    float thresholdNoise = fract(randVal * 43.123);
    float ditherOffset = (thresholdNoise - 0.5) * (Dither_Level * 0.1);
    float adjustedLum = lum + ditherOffset;

    // Density Cutoff: Hides text in pure black/dark areas to map original image contours
    if (adjustedLum < 0.15 || srcColor.a < 0.1) {
        isText = 0.0;
    }

    // Process Text Color Configuration
    vec3 finalTextColor = Text_Color;
    if (Text_Color_from_SRC > 0.5) {
        finalTextColor = srcColor.rgb;
    }

    // Process Background Color Configuration
    vec3 finalBgColor = Text_BG_Color;
    if (Text_BG_Color_from_SRC > 0.5) {
        finalBgColor = srcColor.rgb;
    }

    // Normalize Alpha channel based on the 0-255 parameter
    float bgAlpha = clamp(Text_BG_Alpha / 255.0, 0.0, 1.0);
    vec4 bgColorOutput = vec4(finalBgColor, bgAlpha);
    vec4 textColorOutput = vec4(finalTextColor, 1.0); // Text itself is always opaque

    // Final compositor
    gl_FragColor = mix(bgColorOutput, textColorOutput, isText);
}
