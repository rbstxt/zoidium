precision highp float;
precision highp int;

// Built-in Panzoid variables
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;
varying vec2 vUv;

// --- GLOBAL TRANSFORM ---
uniform vec2 Global_Position;

// --- BASE UNIFORMS (Now repeats the ENTIRE FILM STRIP) ---
uniform float Base_Scale_X;
uniform float Base_Scale_Y;
uniform float Base_Offset_Paths;
uniform vec3 Base_Color;
uniform float Base_Stroke;
uniform float Base_Stroke_Width;
uniform vec3 Base_Stroke_Color;
uniform float Base_Copies;
uniform vec2 Base_Position;

// --- MAIN UNIFORMS (Repeats the BIG HOLES horizontally) ---
uniform float Main_Scale_X;
uniform float Main_Scale_Y;
uniform float Main_Roundness;
uniform float Main_Offset_Paths;
uniform float Main_Copies;
uniform vec2 Main_Position;

// --- SUB UNIFORMS (Repeats the SMALL HOLES horizontally) ---
uniform float Sub_Scale_X;
uniform float Sub_Scale_Y;
uniform float Sub_Roundness;
uniform float Sub_Offset_Paths;
uniform float Sub_Copies;
uniform vec2 Sub_Position;

// Basic SDF for a rounded rectangle
float getRectSDF(vec2 p, vec2 size, float roundness, float offsetPath) {
    vec2 halfSize = max(size * 0.5, vec2(0.0));
    vec2 d = abs(p) - halfSize + roundness;
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - roundness;
    return dist - offsetPath; 
}

// Function to handle After Effects Repeater logic for the holes
float getRepeatedSDF(vec2 p, vec2 size, float roundness, float offsetPath, float copies, vec2 posStep) {
    float minDist = 999999.0;
    float c = max(1.0, copies);
    vec2 startOffset = posStep * (c - 1.0) * 0.5; 
    
    // Limit to 100 copies for performance
    for(int i = 0; i < 100; i++) {
        if(float(i) >= copies) break;
        vec2 offset = -startOffset + posStep * float(i);
        float d = getRectSDF(p - offset, size, roundness, offsetPath);
        minDist = min(minDist, d);
    }
    return minDist;
}

// --- NEW: Assembles ONE complete film strip ---
float getSingleStripSDF(vec2 p) {
    // 1. Draw Base Box
    vec2 baseSize = vec2(Base_Scale_X, Base_Scale_Y);
    float baseDist = getRectSDF(p, baseSize, 0.0, Base_Offset_Paths);

    // 2. Draw Main Holes
    vec2 aeMainPos = vec2(Main_Position.x, -Main_Position.y);
    vec2 mainSize = vec2(Main_Scale_X, Main_Scale_Y);
    float mainDist = getRepeatedSDF(p, mainSize, Main_Roundness, Main_Offset_Paths, Main_Copies, aeMainPos);

    // 3. Draw Sub Holes (Sprockets)
    vec2 pSub = p;
    float subYOffset = (Base_Scale_Y * 0.25) + (Main_Scale_Y * 0.25);
    pSub.y = abs(p.y) - subYOffset; // Mirror top and bottom
    
    vec2 aeSubPos = vec2(Sub_Position.x, -Sub_Position.y);
    vec2 subSize = vec2(Sub_Scale_X, Sub_Scale_Y);
    float subDist = getRepeatedSDF(pSub, subSize, Sub_Roundness, Sub_Offset_Paths, Sub_Copies, aeSubPos);

    // Combine holes
    float holeDist = min(mainDist, subDist);

    // BOOLEAN SUBTRACT: Cut the holes out of the base mathematically
    // This allows strokes to outline both the outside edges AND the holes perfectly
    return max(baseDist, -holeDist);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec2 p = (vUv - 0.5) * resolution; 
    
    // Master transform offset
    p -= vec2(Global_Position.x, -Global_Position.y);
    
    // --- APPLY BASE REPEATER TO THE ENTIRE STRIP ---
    float finalStripDist = 999999.0;
    float c = max(1.0, Base_Copies);
    vec2 aeBasePos = vec2(Base_Position.x, -Base_Position.y);
    vec2 startOffset = aeBasePos * (c - 1.0) * 0.5;
    
    // Loops outer strips (limit 20 to keep frame rates high)
    for(int i = 0; i < 20; i++) {
        if(float(i) >= Base_Copies) break;
        
        vec2 offset = -startOffset + aeBasePos * float(i);
        // Calculate the completed film strip at this offset
        float d = getSingleStripSDF(p - offset);
        finalStripDist = min(finalStripDist, d);
    }
    
    float aa = 1.0;
    
    // Calculate final Alpha based on the combined SDF
    float filmAlpha = 1.0 - smoothstep(0.0, aa, finalStripDist);
    vec4 finalCol = vec4(Base_Color, filmAlpha);
    
    // Draw Stroke Outline (applies to outer edges and inner holes perfectly!)
    if (Base_Stroke > 0.5) {
        float strokeDist = abs(finalStripDist) - Base_Stroke_Width * 0.5;
        float strokeAlpha = 1.0 - smoothstep(0.0, aa, strokeDist);
        
        finalCol.rgb = mix(finalCol.rgb, Base_Stroke_Color, strokeAlpha);
        filmAlpha = max(filmAlpha, strokeAlpha);
        finalCol.a = filmAlpha;
    }
    
    // Composite over background
    vec3 blendedRGB = mix(texel.rgb, finalCol.rgb, finalCol.a);
    float blendedA = texel.a + finalCol.a * (1.0 - texel.a);
    
    gl_FragColor = vec4(blendedRGB, blendedA);
}
