precision highp float;
precision highp int;

// Core Panzoid Uniforms
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUvScaled;

// Custom User Parameters
uniform float Completion;        // Range: 0 to 100
uniform vec2 Center;             // Type: Position (Pixels)
uniform float Rotation;          // Range: 0 to 360
uniform float Borders;           // Range: 0 to 200
uniform float Tiles;             // Range: 1 to 100
uniform float Shape;             // Type: Selector (0=Doors, 1=Radial, 2=Rectangular)
uniform bool Reverse_Transition; // Type: Checkbox

// Constants
#define SHAPE_DOORS 0
#define SHAPE_RADIAL 1
#define SHAPE_RECT  2

void main() {
    // 1. Setup & Coordinates
    vec2 uv = vUvScaled;
    float aspect = resolution.x / resolution.y;
    
    // Normalize Parameters
    float comp = clamp(Completion / 100.0, 0.0, 1.0);
    float nTiles = max(1.0, Tiles);
    int shapeType = int(Shape + 0.5);
    
    // Convert Pixel Center to UV Space
    vec2 centerUV = Center / resolution;
    if (Center.x == 0.0 && Center.y == 0.0) centerUV = vec2(0.5, 0.5);

    // 2. Aspect Corrected Space
    vec2 p = uv;
    p.x *= aspect;
    vec2 c = centerUV;
    c.x *= aspect;
    
    // 3. Global Rotation
    float ang = radians(Rotation);
    float s = sin(ang);
    float cA = cos(ang);
    
    vec2 delta = p - c;
    vec2 pRot = vec2(
        delta.x * cA - delta.y * s,
        delta.x * s + delta.y * cA
    ) + c;
    
    // 4. Grid Logic
    vec2 gridPos = pRot * nTiles;
    vec2 tileId = floor(gridPos);
    vec2 tileUv = fract(gridPos) - 0.5; // Local UV (-0.5 to 0.5)
    
    // 5. Calculate Distance for the Wipe
    vec2 tileCenterPos = (tileId + 0.5) / nTiles;
    
    // Max distance calculation
    float d1 = distance(vec2(0.0, 0.0), c);
    float d2 = distance(vec2(aspect, 0.0), c);
    float d3 = distance(vec2(0.0, 1.0), c);
    float d4 = distance(vec2(aspect, 1.0), c);
    float maxDist = max(max(d1, d2), max(d3, d4));
    
    float dist = distance(tileCenterPos, c);
    
    if (Reverse_Transition) {
        dist = maxDist - dist;
    }
    
    // 6. Transition Progress & Scaling
    float borderW = max(0.001, Borders * 0.015);
    float startCut = -borderW;
    float endCut = maxDist;
    float cutPos = mix(startCut, endCut, comp);
    
    // Scale goes from 1.0 (Solid) to 0.0 (Transparent)
    float scale = smoothstep(cutPos, cutPos + borderW, dist);
    
    // 7. Shape Drawing (Fixed Sizes)
    float sdf = 0.0;
    float maxRadius = 0.5; 
    
    // Overlap Buffer:
    // We add extra size (0.1) to ensure shapes merge perfectly at Scale 1.0
    // This removes the "Grid Lines" visible at 0% completion.
    float overlap = 0.05; 

    if (shapeType == SHAPE_DOORS) {
        // Diamond
        sdf = abs(tileUv.x) + abs(tileUv.y);
        maxRadius = 1.0 + overlap; 
    } else if (shapeType == SHAPE_RADIAL) {
        // Circle
        sdf = length(tileUv);
        // Circle needs radius ~0.71 to hit corners. We use 0.75 for safety.
        maxRadius = 0.75 + overlap; 
    } else {
        // Rectangular
        sdf = max(abs(tileUv.x), abs(tileUv.y));
        maxRadius = 0.5 + overlap;
    }
    
    float currentSize = scale * maxRadius;
    
    // 8. Output
    float aa = 0.01;
    float alpha = 1.0 - smoothstep(currentSize - aa, currentSize, sdf);
    
    // Hard clamp for 0% completion to strictly prevent any transparency lines
    if (comp <= 0.0) alpha = 1.0;

    vec4 texel = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = texel * alpha;
}
