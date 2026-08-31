precision highp float;
precision highp int;

// Panzoid Built-ins
uniform sampler2D tDiffuse;
varying vec2 vUv;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom 20 Properties
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
float getRamp(vec2 u) {
    if (Enable_Ramp < 0.5) return 1.0;
    
    vec2 pixelU = u * resolution;
    pixelU.y = resolution.y - pixelU.y;
    
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
    } else { // Box (Fixed Logic)
        // Use Start_Point as the true center, distance to End_Point as X/Y bounds
        vec2 extents = abs(End_Point - Start_Point);
        extents = max(extents, vec2(0.001)); // Prevent division by zero
        
        vec2 d = abs(pixelU - Start_Point) / extents;
        // max(d.x, d.y) gives a perfect square/rectangular fade
        return clamp(1.0 - max(d.x, d.y), 0.0, 1.0);
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
    // 1. Setup Grid and Aspect Ratio
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
    vec2 gridUv = vUv * aspect;
    
    float ga = radians(Grid_Angle);
    float s = sin(ga), c = cos(ga);
    mat2 rotGrid = mat2(c, -s, s, c);
    gridUv = rotGrid * gridUv;
    
    float safeSpacing = max(Grid_Spacing, 0.1);
    float density = resolution.x / safeSpacing; 
    vec2 cellP = gridUv * density;
    
    vec2 cellId = floor(cellP);
    vec2 cellLocal = fract(cellP) - 0.5;
    
    // 2. Locate center of current cell for sampling
    vec2 centerGrid = (cellId + 0.5) / density;
    mat2 invRotGrid = mat2(c, s, -s, c);
    vec2 sampleUv = (invRotGrid * centerGrid) / aspect;
    
    vec4 srcColor = texture2D(tDiffuse, sampleUv * uvScale);
    
    // 3. Obtain the source map data
    float mapVal = getSourceVal(srcColor);
    bool invertShape = false;
    
    if (Invert_Pattern > 0.5) {
        if (int(Source_Map) != 0) {
            // Invert the size map if an actual source map is selected
            mapVal = 1.0 - mapVal;
        } else {
            // If source map is "None", invert the shape so dots don't vanish
            invertShape = true;
        }
    }
    
    mapVal *= getRamp(sampleUv); 
    
    // 4. Dot Processing & Mixing
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
    
    // 5. Transformations
    float r1 = rand(cellId + Random_Seed);
    float r2 = rand(cellId + Random_Seed + 1.23);
    
    float dAngle = radians(Dots_Angle) + (r1 * 2.0 - 1.0) * radians(Rotate);
    float dS = sin(dAngle), dC = cos(dAngle);
    mat2 rotDot = mat2(dC, -dS, dS, dC);
    
    vec2 p = rotDot * cellLocal;
    
    // Convert 0-100 Scale parameter to a 0.0 - 1.0 percentage multiplier
    float normScale = clamp(Scale / 100.0, 0.0, 1.0);
    
    // Random Scale: Only scale DOWN from the maximum Dot_Size.
    // This guarantees the largest randomly-scaled dots will still fit flawlessly 
    // edge-to-edge without spilling out of their grid cells and clipping.
    float dotScaleFactor = max(1.0 - (r2 * normScale), 0.001);
    p /= dotScaleFactor;
    
    // 6. Draw Shape
    float d = getShapeDist(p, currentShape);
    
    float targetSize = (Dot_Size * mapVal) / (safeSpacing * 2.0);
    float aa = 1.0 / safeSpacing; 
    
    float dotAlpha = smoothstep(targetSize + aa, targetSize - aa, d);
    if (currentShape < 0) dotAlpha = 0.0; 
    
    if (invertShape) {
        dotAlpha = 1.0 - dotAlpha;
    }
    
    // 7. Composite
    vec4 orig = texture2D(tDiffuse, vUvScaled);
    int comp = int(Composite);
    
    if (comp == 0) {
        gl_FragColor = mix(vec4(0.0, 0.0, 0.0, 1.0), vec4(Fill_Color, 1.0), dotAlpha);
    } else if (comp == 1) {
        gl_FragColor = mix(orig, vec4(Fill_Color, 1.0), dotAlpha);
    } else if (comp == 2) {
        gl_FragColor = vec4(Fill_Color, dotAlpha);
    } else {
        gl_FragColor = orig;
    }
}
