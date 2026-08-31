precision highp float;
precision highp int;

// Panzoid Built-in Uniforms
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

// Custom Properties (User Parameters)
uniform vec2 Sample_Point;
uniform float Circle_Size;
uniform float Sample_Point_Radius;
uniform float Scale;
uniform float Offset_X;
uniform float Offset_Y;
uniform float BG_Opacity;
uniform float Lock_Color;
uniform float Show_Circle;
uniform float Show_Swatch;
uniform float Show_LCH;
uniform float Show_HSV;
uniform float Show_RGB;

// 3x5 Bitmap Font Unpacking Helper
int getBit(int val, int x, int y) {
    if (x < 0 || x > 2 || y < 0 || y > 4) return 0;
    int bitIndex = y * 3 + (2 - x);
    float power = floor(pow(2.0, float(bitIndex)) + 0.5);
    return int(mod(floor(float(val) / power), 2.0));
}

// Font Character Database (ASCII mapping to 3x5 bitmasks)
int getCharFontCode(int ascii) {
    if (ascii == 48) return 31599; // '0'
    if (ascii == 49) return 11415; // '1'
    if (ascii == 50) return 29671; // '2'
    if (ascii == 51) return 29647; // '3'
    if (ascii == 52) return 23497; // '4'
    if (ascii == 53) return 31183; // '5'
    if (ascii == 54) return 31215; // '6'
    if (ascii == 55) return 29330; // '7'
    if (ascii == 56) return 31727; // '8'
    if (ascii == 57) return 31695; // '9'
    if (ascii == 46) return 2;     // '.'
    if (ascii == 37) return 21157; // '%'
    if (ascii == 76) return 18727; // 'L'
    if (ascii == 67) return 31015; // 'C'
    if (ascii == 72) return 23533; // 'H'
    if (ascii == 83) return 31183; // 'S'
    if (ascii == 86) return 23402; // 'V'
    if (ascii == 82) return 31733; // 'R'
    if (ascii == 71) return 31087; // 'G'
    if (ascii == 66) return 27566; // 'B'
    if (ascii == 58) return 1040;  // ':'
    return 0;                      // ' '
}

// Numeric Place Digit Extractor
int getDigit(float val, int place) {
    float v = abs(val);
    float digit = 0.0;
    if (place == 100)       digit = mod(floor(v / 100.0), 10.0);
    else if (place == 10)   digit = mod(floor(v / 10.0), 10.0);
    else if (place == 1)    digit = mod(floor(v), 10.0);
    else if (place == -1)   digit = mod(floor(v * 10.0), 10.0);
    else if (place == -2)   digit = mod(floor(v * 100.0), 10.0);
    else if (place == -3)   digit = mod(floor(v * 1000.0), 10.0);
    return int(digit) + 48;
}

// Text Generation Engine
int getCharAt(int line, int col, float L, float C, float hLCH, float hHSV, float S, float V, float R, float G, float B) {
    if (line == 0) { // LCH Row 1: Lightness & Hue
        if (col == 0) return 76; // 'L'
        if (col == 1) return getDigit(L, 10);
        if (col == 2) return getDigit(L, 1);
        if (col == 3) return 46; // '.'
        if (col == 4) return getDigit(L, -1);
        if (col == 5) return getDigit(L, -2);
        if (col == 6) return 37; // '%'
        if (col == 7) return 32; // ' '
        if (col == 8) return 72; // 'H'
        if (col == 9) return (hLCH >= 100.0) ? getDigit(hLCH, 100) : 32;
        if (col == 10) return (hLCH >= 10.0) ? getDigit(hLCH, 10) : ((hLCH >= 100.0) ? 48 : 32);
        if (col == 11) return getDigit(hLCH, 1);
        if (col == 12) return 46; // '.'
        if (col == 13) return getDigit(hLCH, -1);
    }
    if (line == 1) { // LCH Row 2: Chroma & Saturation
        if (col == 0) return 67; // 'C'
        if (col == 1) return getDigit(C, 1);
        if (col == 2) return 46; // '.'
        if (col == 3) return getDigit(C, -1);
        if (col == 4) return getDigit(C, -2);
        if (col == 5) return getDigit(C, -3);
        if (col == 6) return 32; // ' '
        if (col == 7) return 32; // ' '
        if (col == 8) return 83; // 'S'
        if (col == 9) return (S >= 10.0) ? getDigit(S, 10) : 32;
        if (col == 10) return getDigit(S, 1);
        if (col == 11) return 46; // '.'
        if (col == 12) return getDigit(S, -1);
        if (col == 13) return 37; // '%'
    }
    if (line == 2) { // HSV Row 3: Hue & Value
        if (col == 0) return 72; // 'H'
        if (col == 1) return (hHSV >= 100.0) ? getDigit(hHSV, 100) : 32;
        if (col == 2) return (hHSV >= 10.0) ? getDigit(hHSV, 10) : ((hHSV >= 100.0) ? 48 : 32);
        if (col == 3) return getDigit(hHSV, 1);
        if (col == 4) return 46; // '.'
        if (col == 5) return getDigit(hHSV, -1);
        if (col == 6) return getDigit(hHSV, -2);
        if (col == 7) return 32; // ' '
        if (col == 8) return 86; // 'V'
        if (V >= 100.0) {
            if (col == 9) return 49;  // '1'
            if (col == 10) return 48; // '0'
            if (col == 11) return 48; // '0'
            if (col == 12) return 46; // '.'
            if (col == 13) return 48; // '0'
        } else {
            if (col == 9) return (V >= 10.0) ? getDigit(V, 10) : 32;
            if (col == 10) return getDigit(V, 1);
            if (col == 11) return 46; // '.'
            if (col == 12) return getDigit(V, -1);
            if (col == 13) return 37; // '%'
        }
    }
    if (line == 3) { // RGB Row 4
        if (col == 0) return 82; // 'R'
        if (col == 1) return (R >= 100.0) ? getDigit(R, 100) : 32;
        if (col == 2) return (R >= 10.0) ? getDigit(R, 10) : ((R >= 100.0) ? 48 : 32);
        if (col == 3) return getDigit(R, 1);
        if (col == 4) return 32; // ' '
        if (col == 5) return 71; // 'G'
        if (col == 6) return (G >= 100.0) ? getDigit(G, 100) : 32;
        if (col == 7) return (G >= 10.0) ? getDigit(G, 10) : ((G >= 100.0) ? 48 : 32);
        if (col == 8) return getDigit(G, 1);
        if (col == 9) return 32; // ' '
        if (col == 10) return 66; // 'B'
        if (col == 11) return (B >= 100.0) ? getDigit(B, 100) : 32;
        if (col == 12) return (B >= 10.0) ? getDigit(B, 10) : ((B >= 100.0) ? 48 : 32);
        if (col == 13) return getDigit(B, 1);
    }
    return 32;
}

// RGB to HSV Conversion Mathematical Block
vec3 rgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// CIELCH Structural Color Convertors
vec3 rgbToXyz(vec3 rgb) {
    float r = (rgb.r > 0.04045) ? pow((rgb.r + 0.055) / 1.055, 2.4) : (rgb.r / 12.92);
    float g = (rgb.g > 0.04045) ? pow((rgb.g + 0.055) / 1.055, 2.4) : (rgb.g / 12.92);
    float b = (rgb.b > 0.04045) ? pow((rgb.b + 0.055) / 1.055, 2.4) : (rgb.b / 12.92);
    return vec3(
        r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
        r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
        r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    );
}

vec3 xyzToLab(vec3 xyz) {
    vec3 n = xyz / vec3(0.95047, 1.00000, 1.08883);
    vec3 f = vec3(
        (n.x > 0.008856) ? pow(n.x, 1.0/3.0) : (7.787 * n.x + 16.0/116.0),
        (n.y > 0.008856) ? pow(n.y, 1.0/3.0) : (7.787 * n.y + 16.0/116.0),
        (n.z > 0.008856) ? pow(n.z, 1.0/3.0) : (7.787 * n.z + 16.0/116.0)
    );
    return vec3((116.0 * f.y) - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}

void main() {
    vec4 finalColor = texture2D(tDiffuse, vUvScaled);
    
    // Spatial Box-Averaging over Sample Point Radius
    vec4 sampledTexel = vec4(0.0);
    float totalWeight = 0.0;
    int rad = int(clamp(Sample_Point_Radius, 0.0, 5.0));
    
    for (int x = -5; x <= 5; x++) {
        for (int y = -5; y <= 5; y++) {
            // FIXED: Removed abs() around integer coordinates
            if (x >= -rad && x <= rad && y >= -rad && y <= rad) {
                sampledTexel += texture2D(tDiffuse, Sample_Point + vec2(float(x), float(y)) / resolution);
                totalWeight += 1.0;
            }
        }
    }
    sampledTexel = (totalWeight > 0.0) ? (sampledTexel / totalWeight) : texture2D(tDiffuse, Sample_Point);
    vec3 rgb = sampledTexel.rgb;
    
    // Convert Spaces
    vec3 hsv = rgbToHsv(rgb);
    vec3 lab = xyzToLab(rgbToXyz(rgb));
    float hLch = atan(lab.z, lab.y) * 180.0 / 3.14159265;
    vec3 lch = vec3(lab.x, sqrt(lab.y*lab.y + lab.z*lab.z), (hLch < 0.0) ? hLch + 360.0 : hLch);

    // Active Layout Toggles
    bool vis0 = (Show_LCH > 0.5);
    bool vis1 = (Show_LCH > 0.5 || Show_HSV > 0.5);
    bool vis2 = (Show_HSV > 0.5);
    bool vis3 = (Show_RGB > 0.5);
    
    int numLines = 0;
    int pos0 = -1, pos1 = -1, pos2 = -1, pos3 = -1;
    if (vis0) { pos0 = numLines; numLines++; }
    if (vis1) { pos1 = numLines; numLines++; }
    if (vis2) { pos2 = numLines; numLines++; }
    if (vis3) { pos3 = numLines; numLines++; }
    
    // Dynamic Layout Dimensions
    float swatchSize = (Show_Swatch > 0.5 && numLines > 0) ? float(numLines * 8 - 3) : 0.0;
    float textStartX = (Show_Swatch > 0.5 && numLines > 0) ? (8.0 + swatchSize) : 4.0;
    float totalWidth = textStartX + 56.0 + 4.0;
    float totalHeight = (numLines > 0) ? float(numLines * 8 - 3) + 8.0 : 8.0;
    
    // Pixel Coordination Transform
    vec2 localPos = (vUv * resolution - (Sample_Point * resolution + vec2(Offset_X, Offset_Y))) / max(Scale, 0.001);
    
    // Overlay Circle Visualizer Execution
    if (Show_Circle > 0.5) {
        if (abs(distance(vUv * resolution, Sample_Point * resolution) - Circle_Size) < 1.2) {
            finalColor = vec4(1.0, 0.0, 0.0, 1.0); // Consistent Quality Target Circle
        }
    }
    
    // UI Panel Layer Assembly
    if (numLines > 0 && localPos.x >= 0.0 && localPos.x <= totalWidth && localPos.y >= 0.0 && localPos.y <= totalHeight) {
        vec4 overlayUi = vec4(0.0, 0.0, 0.0, BG_Opacity / 100.0);
        
        // Crisp Exterior Outline
        if (localPos.x < 1.0 || localPos.x > totalWidth - 1.0 || localPos.y < 1.0 || localPos.y > totalHeight - 1.0) {
            overlayUi = vec4(1.0, 1.0, 1.0, 1.0);
        }
        // Swatch Square Rendering
        else if (Show_Swatch > 0.5 && localPos.x >= 4.0 && localPos.x <= 4.0 + swatchSize && localPos.y >= 4.0 && localPos.y <= 4.0 + swatchSize) {
            if (abs(localPos.x - 4.0) < 1.0 || abs(localPos.x - (4.0 + swatchSize)) < 1.0 || 
                abs(localPos.y - 4.0) < 1.0 || abs(localPos.y - (4.0 + swatchSize)) < 1.0) {
                overlayUi = vec4(1.0, 1.0, 1.0, 1.0);
            } else {
                overlayUi = vec4(rgb, 1.0);
            }
        }
        // Dynamic Character Mapping Inside Grid Map
        else if (localPos.x >= textStartX && localPos.x <= textStartX + 56.0) {
            float relX = localPos.x - textStartX;
            int col = int(floor(relX / 4.0));
            float charLocalX = mod(relX, 4.0);
            
            float fromTop = totalHeight - 4.0 - localPos.y;
            int visualLine = int(floor(fromTop / 8.0));
            float charLocalY = 5.0 - mod(fromTop, 8.0);
            
            if (col >= 0 && col < 14 && charLocalX < 3.0 && visualLine >= 0 && visualLine < numLines && charLocalY >= 0.0 && charLocalY < 5.0) {
                int dataLine = -1;
                int currentVisual = 0;
                if (vis0) { if (currentVisual == visualLine) dataLine = 0; currentVisual++; }
                if (vis1) { if (currentVisual == visualLine) dataLine = 1; currentVisual++; }
                if (vis2) { if (currentVisual == visualLine) dataLine = 2; currentVisual++; }
                if (vis3) { if (currentVisual == visualLine) dataLine = 3; currentVisual++; }
                
                int ascii = getCharAt(dataLine, col, lch.x, lch.y / 100.0, lch.z, hsv.x * 360.0, hsv.y * 100.0, hsv.z * 100.0, rgb.r * 255.0, rgb.g * 255.0, rgb.b * 255.0);
                if (getBit(getCharFontCode(ascii), int(charLocalX), int(charLocalY)) == 1) {
                    overlayUi = vec4(1.0, 1.0, 1.0, 1.0);
                }
            }
        }
        finalColor = mix(finalColor, vec4(overlayUi.rgb, 1.0), overlayUi.a);
    }
    gl_FragColor = finalColor;
}
