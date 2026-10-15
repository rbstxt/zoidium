precision highp float;
precision highp int;

// Panzoid Built-ins
uniform sampler2D tDiffuse;
varying vec2 vUv;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom 38 Properties
uniform float Composite;
uniform float Source_Map;
uniform float Dot_Shape;
uniform float Shape_1;
uniform float Shape_2;
uniform float Shape_3;
uniform float Shape_4;
uniform vec3 Fill_Color;
uniform float Dot_Size;
uniform float Grid_Spacing;
uniform float Grid_Angle;
uniform float Dots_Angle;
uniform float Scale;
uniform float Rotate;
uniform float Random_Seed;
uniform float Invert_Pattern;
uniform float Enable_Ramp;
uniform float Ramp_Style;
uniform vec2 Start_Point;
uniform vec2 End_Point;

// NEW: Random Color & Position/Offset Parameters
uniform float Enable_Random_Color;
uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;
uniform vec3 Color_7;
uniform vec3 Color_8;
uniform float Random_Colors;
uniform float Color_Hue;
uniform float Color_Saturation;
uniform float Color_Seed;
uniform vec2 Position;
uniform float Odd_Row;
uniform float Even_Row;
uniform float Odd_Column;
uniform float Even_Column;

// Helper: Pseudo-random number generator
float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

// Helper: RGB to HSL conversion
vec3 rgb2hsl(vec3 c) {
    float cMin = min(min(c.r, c.g), c.b);
    float cMax = max(max(c.r, c.g), c.b);
    float l = (cMax + cMin) / 2.0;
    float s = 0.0;
    float h = 0.0;
    if (cMax != cMin) {
        float d = cMax - cMin;
        s = l > 0.5 ? d / (2.0 - cMax - cMin) : d / (cMax + cMin);
        if (cMax == c.r) { h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); }
        else if (cMax == c.g) { h = (c.b - c.r) / d + 2.0; }
        else { h = (c.r - c.g) / d + 4.0; }
        h /= 6.0;
    }
    return vec3(h, s, l);
}

// Helper: HSL to RGB conversion
vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

// Helper: Source Map Interpreter
float getSourceVal(vec4 col) {
    int sm = int(Source_Map);
    if (sm == 0) return 1.0; // None
    if (sm == 1) return col.r;
    if (sm == 2) return col.g;
    if (sm == 3) return col.b;
    if (sm == 4) return col.a;
    if (sm == 5) return dot(col.rgb, vec3(0.299, 0.587, 0.114)); // Luminance
    
    vec3 hsl = rgb2hsl(col.rgb);
    if (sm == 6) return hsl.x; // Hue
    if (sm == 7) return hsl.z; // Lightness
    if (sm == 8) return hsl.y; // Saturation
    if (sm == 9) return max(max(col.r, col.g), col.b); // Full
    if (sm == 10) return (col.r + col.g + col.b) / 3.0; // Half
    
    return 1.0;
}

// Helper: Ramp Generator (Pixel Space)
float getRamp(vec2 pixelU) {
    if (Enable_Ramp < 0.5) return 1.0;
    
    vec2 dir = End_Point - Start_Point;
    float len2 = dot(dir, dir);
    if (len2 == 0.0) return 0.5;
    
    float t = dot(pixelU - Start_Point, dir) / len2;
    int style = int(Ramp_Style);
    
    if (style == 0) { // Linear
        return clamp(t, 0.0, 1.0);
    } else if (style == 1) { // Radial
        float d = distance(pixelU, Start_Point) / (distance(Start_Point, End_Point) + 0.0001);
        return clamp(1.0 - d, 0.0, 1.0);
    } else if (style == 2) { // Symmetric
        return clamp(1.0 - abs(t * 2.0 - 1.0), 0.0, 1.0);
    } else if (style == 3) { // Box / Square
        vec2 p = pixelU - Start_Point;
        float angle = atan(dir.y, dir.x);
        float s = sin(-angle), c = cos(-angle);
        p = mat2(c, -s, s, c) * p; 
        float d = max(abs(p.x), abs(p.y)) / (distance(Start_Point, End_Point) + 0.0001);
        return clamp(1.0 - d, 0.0, 1.0);
    } else { // Diamond
        vec2 p = pixelU - Start_Point;
        float angle = atan(dir.y, dir.x);
        float s = sin(-angle), c = cos(-angle);
        p = mat2(c, -s, s, c) * p; 
        float d = (abs(p.x) + abs(p.y)) / (distance(Start_Point, End_Point) + 0.0001);
        return clamp(1.0 - d, 0.0, 1.0);
    }
}

// Helper: SDF Shapes
float getShapeDist(vec2 p, int type) {
    if (type == 0) return length(p); // Circle
    if (type == 1) return max(abs(p.x), abs(p.y)); // Square
    if (type == 2) return abs(p.x) + abs(p.y); // Diamond 
    if (type == 3) { // Love
        vec2 lp = p * 1.3;
        lp.y += 0.2;
        return length(vec2(lp.x, lp.y - 0.5 * sqrt(abs(lp.x)))); 
    }
    if (type == 4) { // Sparkle 
        float ax = abs(p.x);
        float ay = abs(p.y);
        return ax + ay + 2.0 * sqrt(ax * ay);
    }
    return 999.0;
}

void main() {
    // 1. Base Pixel Coordinates (Subtract custom Position to make it the anchor)
    vec2 pixelPos = (vUv * resolution);
    // Invert Y to match AE space for Position and Ramp coords
    pixelPos.y = resolution.y - pixelPos.y; 
    
    vec2 offsetPos = pixelPos - Position;
    
    // 2. Rotate Grid Space
    float ga = radians(Grid_Angle);
    float s = sin(ga), c = cos(ga);
    mat2 rotGrid = mat2(c, -s, s, c);
    mat2 invRotGrid = mat2(c, s, -s, c);
    
    vec2 rotatedPos = rotGrid * offsetPos;
    
    float safeSpacing = max(Grid_Spacing, 0.1);
    vec2 gridPos = rotatedPos / safeSpacing;
    
    // 3. Row & Column Offsets
    // Determine odd/even based on initial un-shifted grid
    float initialRow = floor(gridPos.y);
    float initialCol = floor(gridPos.x);
    
    bool isEvenRow = mod(abs(initialRow), 2.0) < 0.5;
    bool isEvenCol = mod(abs(initialCol), 2.0) < 0.5;
    
    float rowOffset = isEvenRow ? Even_Row : Odd_Row;
    float colOffset = isEvenCol ? Even_Column : Odd_Column;
    
    // Shift grid coordinates (subtracting offset moves the grid positively)
    gridPos.x -= rowOffset / safeSpacing; 
    gridPos.y -= colOffset / safeSpacing;
    
    vec2 cellId = floor(gridPos);
    vec2 cellLocal = fract(gridPos) - 0.5;
    
    // 4. Locate accurate physical center of THIS shifted cell for Source Map / Ramp
    vec2 physicalGridCenter = cellId + 0.5;
    physicalGridCenter.x += rowOffset / safeSpacing; // Add offset back to find true physical location
    physicalGridCenter.y += colOffset / safeSpacing;
    
    vec2 centerPixel = invRotGrid * (physicalGridCenter * safeSpacing) + Position;
    vec2 sampleUv = centerPixel / resolution;
    sampleUv.y = 1.0 - sampleUv.y; // Convert back to GLSL UV space for texture sampling
    
    vec4 srcColor = texture2D(tDiffuse, sampleUv * uvScale);
    
    // 5. Source Map & Ramp
    float mapVal = getSourceVal(srcColor);
    bool invertShape = false;
    
    if (Invert_Pattern > 0.5) {
        if (int(Source_Map) != 0) {
            mapVal = 1.0 - mapVal;
        } else {
            invertShape = true;
        }
    }
    
    mapVal *= getRamp(centerPixel); 
    
    // 6. Color Selection Math
    vec3 dotColor = Fill_Color;
    
    if (Enable_Random_Color > 0.5) {
        float activeColors = clamp(floor(Random_Colors), 1.0, 8.0);
        float randColorVal = rand(cellId + Color_Seed + 99.0);
        int cIndex = int(mod(randColorVal * activeColors, activeColors));
        
        if (cIndex == 0) dotColor = Color_1;
        else if (cIndex == 1) dotColor = Color_2;
        else if (cIndex == 2) dotColor = Color_3;
        else if (cIndex == 3) dotColor = Color_4;
        else if (cIndex == 4) dotColor = Color_5;
        else if (cIndex == 5) dotColor = Color_6;
        else if (cIndex == 6) dotColor = Color_7;
        else dotColor = Color_8;
        
        // Apply Color Hue and Saturation Shifts
        vec3 hsl = rgb2hsl(dotColor);
        hsl.x = fract(hsl.x + (Color_Hue / 360.0)); // Shift hue (Degrees mapped to 0-1)
        hsl.y = clamp(hsl.y * (Color_Saturation / 100.0), 0.0, 1.0); // Scale saturation (Percentage mapped to 0-1)
        dotColor = hsl2rgb(hsl);
    }
    
    // 7. Dot Processing & Mixing
    int currentShape = int(Dot_Shape);
    
    if (currentShape >= 5) {
        float rnd = rand(cellId + Random_Seed + 5.5);
        int choice = int(mod(rnd * 4.0, 4.0));
        
        int shapeChoice = 0;
        if (choice == 0) shapeChoice = int(Shape_1);
        else if (choice == 1) shapeChoice = int(Shape_2);
        else if (choice == 2) shapeChoice = int(Shape_3);
        else shapeChoice = int(Shape_4);
        
        currentShape = shapeChoice - 1;
    }
    
    // 8. Transformations
    float r1 = rand(cellId + Random_Seed);
    float r2 = rand(cellId + Random_Seed + 1.23);
    
    float dAngle = radians(Dots_Angle) + (r1 * 2.0 - 1.0) * radians(Rotate);
    float dS = sin(dAngle), dC = cos(dAngle);
    mat2 rotDot = mat2(dC, -dS, dS, dC);
    
    vec2 p = rotDot * cellLocal;
    
    float normScale = clamp(Scale / 100.0, 0.0, 1.0);
    float dotScaleFactor = max(1.0 - (r2 * normScale), 0.001);
    p /= dotScaleFactor;
    
    // 9. Draw Shape
    float d = getShapeDist(p, currentShape);
    
    float targetSize = (Dot_Size * mapVal) / (safeSpacing * 2.0);
    float aa = 1.0 / safeSpacing; 
    
    float dotAlpha = smoothstep(targetSize + aa, targetSize - aa, d);
    if (currentShape < 0) dotAlpha = 0.0; 
    
    if (invertShape) {
        dotAlpha = 1.0 - dotAlpha;
    }
    
    // 10. Composite
    vec4 orig = texture2D(tDiffuse, vUvScaled);
    int comp = int(Composite);
    
    if (comp == 0) {
        gl_FragColor = mix(vec4(0.0, 0.0, 0.0, 1.0), vec4(dotColor, 1.0), dotAlpha);
    } else if (comp == 1) {
        gl_FragColor = mix(orig, vec4(dotColor, 1.0), dotAlpha);
    } else if (comp == 2) {
        gl_FragColor = vec4(dotColor, dotAlpha);
    } else {
        gl_FragColor = orig;
    }
}
