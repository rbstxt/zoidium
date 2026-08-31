precision highp float;
precision highp int;

// Panzoid built-in uniforms
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// Custom Uniforms (configured as float uniforms in Panzoid)
uniform float Charset;
uniform float Detail_columns;
uniform float Font_Size;
uniform float Line_Height;
uniform float Character_Aspect;
uniform float Contrast;
uniform float Brightness;
uniform float Invert;
uniform float Transparent_Background;
uniform float Color_From_Image;
uniform vec3 Text_Color;

// Helper to get powers of 2 for cross-platform WebGL 1.0 bit extraction
float getBitPower(int index) {
    if (index == 0) return 1.0;
    if (index == 1) return 2.0;
    if (index == 2) return 4.0;
    if (index == 3) return 8.0;
    if (index == 4) return 16.0;
    if (index == 5) return 32.0;
    if (index == 6) return 64.0;
    if (index == 7) return 128.0;
    if (index == 8) return 256.0;
    if (index == 9) return 512.0;
    if (index == 10) return 1024.0;
    if (index == 11) return 2048.0;
    if (index == 12) return 4096.0;
    if (index == 13) return 8192.0;
    return 16384.0; // index == 14
}

// Function that returns the packed 3x5 font pixel grid mask
int getGlyphMask(int charsetType, float luma, int cellX, int cellY) {
    if (luma < 0.05) return 0; // Blank for dark pixels

    if (charsetType == 0) { // 0: Standard
        int idx = int(luma * 7.99);
        if (idx == 0) return 8192;  // .
        if (idx == 1) return 1040;  // :
        if (idx == 2) return 448;   // -
        if (idx == 3) return 1488;  // +
        if (idx == 4) return 2728;  // *
        if (idx == 5) return 21653; // X
        if (idx == 6) return 24441; // #
        return 33647;               // 0
    }
    else if (charsetType == 1) { // 1: Dense
        int idx = int(luma * 10.99);
        if (idx == 0) return 8192;  // .
        if (idx == 1) return 1040;  // :
        if (idx == 2) return 448;   // -
        if (idx == 3) return 1488;  // +
        if (idx == 4) return 3640;  // =
        if (idx == 5) return 2728;  // *
        if (idx == 6) return 21653; // X
        if (idx == 7) return 24441; // #
        if (idx == 8) return 33647; // 0
        return 32767;               // Full solid block
    }
    else if (charsetType == 2) { // 2: Minimal
        int idx = int(luma * 4.99);
        if (idx == 0) return 8192;  // .
        if (idx == 1) return 1488;  // +
        if (idx == 2) return 24441; // #
        if (idx == 3) return 33647; // 0
        return 32767;               // Full solid block
    }
    else if (charsetType == 3) { // 3: Blocks
        int idx = int(luma * 4.99);
        if (idx == 0) return 4369;  // Sparse dots
        if (idx == 1) return 21845; // Light dither
        if (idx == 2) return 10922; // Medium dither
        if (idx == 3) return 27305; // Heavy dither
        return 32767;               // Full solid block
    }
    else if (charsetType == 4) { // 4: Retro (Procedural Source Code lines)
        // Fixed WebGL 1.0 integer modulo limitation
        int wordCycle = int(mod(floor(float(cellX) / 6.0), 5.0));
        int charIdx = int(mod(float(cellX), 6.0));
        
        if (wordCycle == 0) { // "class"
            if (charIdx == 0) return 29311; // c
            if (charIdx == 1) return 29193; // l
            if (charIdx == 2) return 31247; // a
            if (charIdx == 3) return 31111; // s
            if (charIdx == 4) return 31111; // s
            return 0;
        }
        if (wordCycle == 1) { // "void "
            if (charIdx == 0) return 18949; // v
            if (charIdx == 1) return 33647; // o
            if (charIdx == 2) return 9362;  // i
            if (charIdx == 3) return 33647; // d
            return 0;
        }
        if (wordCycle == 2) { // "main()"
            if (charIdx == 0) return 24441; // m
            if (charIdx == 1) return 31247; // a
            if (charIdx == 2) return 9362;  // i
            if (charIdx == 3) return 29311; // n
            if (charIdx == 4) return 4802;  // (
            return 8720;                    // )
        }
        if (wordCycle == 3) { // "float"
            if (charIdx == 0) return 31239; // f
            if (charIdx == 1) return 29193; // l
            if (charIdx == 2) return 33647; // o
            if (charIdx == 3) return 31247; // a
            if (charIdx == 4) return 4714;  // t
            return 0;
        }
        // "vec4"
        if (charIdx == 0) return 18949; // v
        if (charIdx == 1) return 31239; // e
        if (charIdx == 2) return 29311; // c
        if (charIdx == 3) return 24441; // 4
        return 0;
    }
    else { // 5: Binary (0 and 1 stream)
        if (mod(float(cellX + cellY), 2.0) == 0.0) {
            return 33647; // 0
        } else {
            return 9362;  // 1
        }
    }
}

void main()
{
    float screenAspect = resolution.x / resolution.y;
    
    // Fallback safe limits
    float cols = max(Detail_columns, 1.0);
    float charAspect = max(Character_Aspect, 0.1);
    
    // Normalization logic if user provides percent notation instead of scale factor
    float lineHeight = max(Line_Height, 0.1);
    if (lineHeight > 5.0) lineHeight /= 100.0;
    
    float normContrast = Contrast;
    if (normContrast > 5.0) normContrast /= 100.0;
    
    float normBrightness = Brightness;
    if (abs(normBrightness) > 2.0) normBrightness /= 100.0;
    
    // Calculate precise grid sizes in normalized coordinates
    float cellW = 1.0 / cols;
    float cellH = cellW * charAspect * screenAspect * lineHeight;
    
    // Locate the current tile
    vec2 cellIndex = floor(vUvScaled / vec2(cellW, cellH));
    vec2 cellCenterUV = (cellIndex + 0.5) * vec2(cellW, cellH);
    
    // Fixed clamp limitation for WebGL 1.0
    cellCenterUV = vec2(clamp(cellCenterUV.x, 0.0, 1.0), clamp(cellCenterUV.y, 0.0, 1.0));
    
    // Sample texture source color
    vec4 texel = texture2D(tDiffuse, cellCenterUV);
    
    // Calculate contrast and brightness updated luminance
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    luma = (luma - 0.5) * normContrast + 0.5 + normBrightness;
    luma = clamp(luma, 0.0, 1.0);
    
    if (Invert > 0.5) {
        luma = 1.0 - luma;
    }
    
    // Local internal coordinate [0.0, 1.0] inside the cell
    vec2 localUV = fract(vUvScaled / vec2(cellW, cellH));
    
    // Scale handling for font size (Accepts both absolute pixel width or scale ratio)
    float cellWidthPixels = resolution.x / cols;
    float glyphScale = Font_Size;
    if (glyphScale > 2.0) {
        glyphScale = glyphScale / cellWidthPixels;
    }
    glyphScale = max(glyphScale, 0.05);
    
    // Map local coordinates into centered glyph bounding box
    vec2 glyphUV = (localUV - 0.5) / glyphScale + 0.5;
    
    bool isTextPixel = false;
    
    if (glyphUV.x >= 0.0 && glyphUV.x <= 1.0 && glyphUV.y >= 0.0 && glyphUV.y <= 1.0) {
        int px = int(glyphUV.x * 3.0);
        int py = int((1.0 - glyphUV.y) * 5.0); // Flip Y vector for font tracking top-to-bottom
        
        // Fixed clamp integer limitation for WebGL 1.0
        px = int(clamp(float(px), 0.0, 2.0));
        py = int(clamp(float(py), 0.0, 4.0));
        
        int bitIndex = py * 3 + px;
        int mask = getGlyphMask(int(Charset), luma, int(cellIndex.x), int(cellIndex.y));
        
        float p = getBitPower(bitIndex);
        isTextPixel = mod(floor(float(mask) / p), 2.0) >= 1.0;
    }
    
    // Output assignment based on options mapping
    vec3 finalColor = vec3(0.0);
    float finalAlpha = 1.0;
    
    if (isTextPixel) {
        if (Color_From_Image > 0.5) {
            finalColor = texel.rgb;
        } else {
            finalColor = Text_Color;
        }
    } else {
        if (Transparent_Background > 0.5) {
            finalAlpha = 0.0;
        } else {
            finalColor = vec3(0.0);
        }
    }
    
    gl_FragColor = vec4(finalColor, finalAlpha);
}
