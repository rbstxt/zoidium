precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- User Variables (Uniforms) ---

// Offset: Offset of the pattern (Default: 0, 0)
uniform vec2 uOffset;

// Size: Size of pattern (Range: 0.5 to 200, Default: 10)
// At 100, one hex fills layer vertically.
uniform float uSize;

// Stretch: Vertical scaling (Range: 0.01 to 10, Default: 1)
uniform float uStretch;

// Coloring: 0=Layer, 1=Solid, 2=Stripes, 3=Tricolor, 4=Cube, 5=Triangles, 6=Pentagonal
uniform float uColoring;

// Colors
uniform vec4 uColor1;
uniform vec4 uColor2;
uniform vec4 uColor3;

// Alpha: Pattern opacity (Range: 0 to 1, Default: 1)
uniform float uAlpha;

// Blending Mode: 0=Normal, 1=Multiply, 2=Screen, 3=Overlay, 4=Overflow, 5=PunchOut
uniform float uBlendingMode;

// Scale Using Layer Alpha: 0=Off, 1=On
uniform float uScaleLayerAlpha;

// Copy Layer Alpha: 0=Off, 1=On
uniform float uCopyLayerAlpha;

// Line Width: Ratio of hex size (Range: 0 to 1, Default: 0.1)
uniform float uLineWidth;

// Feather: Softness (Range: 0 to 1, Default: 0.05)
uniform float uFeather;

// Angle: Rotation in degrees
uniform float uAngle;

// Screen Space: 0=Off, 1=On
uniform float uScreenSpace;

// Constants
const float PI = 3.14159265359;
const float SQRT3 = 1.7320508;

// Helper: Rotation Matrix
mat2 rotate2d(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

// Helper: Value Step (mimics if/else for floats)
float when_eq(float x, float y) {
    return 1.0 - abs(sign(x - y));
}

float when_between(float x, float start, float end) {
    return step(start, x) * step(x, end);
}

// Helper: Hexagon Math
// Returns vec4: xy = skew coords, zw = grid ID
vec4 hexCoords(vec2 uv) {
    vec2 r = vec2(1.0, SQRT3);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    
    // Calculate ID (approximate center for randomness/stripes)
    vec2 id = uv - gv;
    // Fix ID coordinate space to be roughly integer-like for modulo arithmetic
    // Convert back to grid integers roughly
    float iy = floor((id.y + 0.1) / (SQRT3 * 0.5));
    float ix = floor((id.x + 0.1 + (mod(iy, 2.0) * 0.5))); // Offset row logic
    
    return vec4(gv.x, gv.y, id.x, id.y);
}

// Hexagon SDF (Distance to edge)
float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, vec2(0.5, SQRT3 * 0.5)), p.x); // Pointy top logic mostly
}

// Blend Modes
vec3 blendMultiply(vec3 base, vec3 blend) { return base * blend; }
vec3 blendScreen(vec3 base, vec3 blend) { return 1.0 - (1.0 - base) * (1.0 - blend); }
vec3 blendOverlay(vec3 base, vec3 blend) {
    return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(0.5, base));
}

void main() {
    // 1. Coordinate Setup
    vec2 uv = vUvScaled;
    
    // Screen Space logic (simplified, assuming standard UV implies layer space)
    // If ScreenSpace is on, we might ignore aspect adjustments, but here we treat uv as is.
    
    // Center UVs generally for rotation
    vec2 center = vec2(0.5);
    vec2 pos = uv - center;
    
    // Apply Rotation
    float rad = radians(uAngle);
    pos = rotate2d(-rad) * pos;
    
    // Apply Offset (relative to layer, so we subtract)
    pos -= uOffset;
    
    // Apply Stretch (Vertical scaling)
    pos.y /= max(0.001, uStretch); // Avoid divide by zero
    
    // Apply Size
    // Size 100 = 1.0 UV height (approx). 
    // Grid Scale factor. 
    float gridSize = max(0.5, uSize) / 100.0;
    // Hex Grid math usually relies on specific spacing. 
    // Scale pos down so the grid logic works on unit 1.0
    // Adjust scale so Size 10 => 0.1 height per hex.
    float scale = 1.0 / (gridSize * SQRT3); // Adjust factor to match "100 = full screen" roughly
    pos *= scale;

    // 2. Grid Calculation
    // We use a manual grid approach for robustness without integer bitwise ops
    vec2 r = vec2(1.0, SQRT3);
    vec2 h = r * 0.5;
    
    vec2 a = mod(pos, r) - h;
    vec2 b = mod(pos - h, r) - h;
    
    vec2 gv; // Local UV in hex
    vec2 id; // Center of hex
    
    // Check which grid center is closer
    float d1 = dot(a, a);
    float d2 = dot(b, b);
    
    // Mix/Step to avoid if
    float which = step(d2, d1); // 1 if b is closer
    gv = mix(a, b, which);
    id = pos - gv;

    // 3. Hexagon ID for Coloring
    // We need integer-like IDs for parity checks (Stripes/Tricolor)
    // Reverse engineer grid coordinates (col, row)
    // y-row is approx id.y / (SQRT3 * 0.5)
    float row = floor((id.y / (SQRT3 * 0.5)) + 0.5);
    // x-col: if row is even, id.x is integer. if row is odd, id.x is integer + 0.5
    float shift = mod(row, 2.0) * 0.5;
    float col = floor(id.x - shift + 0.5);

    // 4. Sample Layer Data (Pixel at center of hex)
    // We need to un-transform the ID to get the UV of the center.
    // Re-apply Size, Stretch, Offset, Rotation (Inverse)
    vec2 centerUV = id / scale;
    centerUV.y *= uStretch;
    centerUV += uOffset;
    centerUV = rotate2d(rad) * centerUV;
    centerUV += center;
    
    vec4 layerColor = texture2D(tDiffuse, centerUV);
    vec4 originalPixel = texture2D(tDiffuse, vUvScaled);
    float layerAlpha = layerColor.a;

    // 5. Calculate Shape & Mask
    // Distance from center of hex (gv)
    // Pointy topped hex distance
    // Using simple math: max(abs(x)*0.866 + abs(y)*0.5, abs(y))
    // But our grid is slightly different orientation, let's stick to standard hex dist:
    vec2 absGV = abs(gv);
    float dist = max(dot(absGV, vec2(0.5, SQRT3 * 0.5)), absGV.x); // rotated 90 deg relative to standard?
    // Let's normalize dist to 0.0-0.5 range (0 at center, 0.5 at edge of incircle)
    
    // Scale Using Layer Alpha logic
    float sizeMod = 1.0;
    sizeMod = mix(1.0, layerAlpha, uScaleLayerAlpha);
    
    // Line Width Logic
    // Max radius of hex in this grid space is 0.5 (apothem). 
    // Map LineWidth 0..1 to threshold.
    float radius = 0.5 * sizeMod; // Max size
    float border = uLineWidth * 0.5; // Thickness
    float edge = radius - border;
    
    // Feathering
    float feather = max(0.0001, uFeather * 0.5);
    float mask = 1.0 - smoothstep(edge - feather, edge, dist);
    
    // 6. Coloring Logic
    vec4 finalColor = uColor1; // Default
    
    // Calculate 3 pattern values
    // Stripes: Rows
    float stripe = mod(row, 2.0); // 0 or 1
    
    // Tricolor: (col + row) % 3 ? Need a tiling 
    // Standard hex 3-color: mod(col - row, 3.0)
    float tri = mod(col + ceil(row/2.0), 3.0); // Simple 3-color map
    
    // Sub-region angles (0 to 1)
    float angle = atan(gv.x, gv.y) + PI; // 0 to 2PI
    float nAngle = angle / (2.0 * PI); // 0 to 1
    
    // Modes
    // 0: Layer
    vec4 cLayer = layerColor;
    
    // 1: Solid
    vec4 cSolid = uColor1;
    
    // 2: Stripes (Color 1, Color 2)
    vec4 cStripes = mix(uColor1, uColor2, step(0.5, stripe));
    
    // 3: Tricolor
    // 0->C1, 1->C2, 2->C3
    vec4 cTri = mix(uColor1, uColor2, step(0.5, abs(tri - 1.0))); // if tri==1 use C2
    cTri = mix(cTri, uColor3, step(1.5, tri)); // if tri==2 use C3
    
    // 4: Cube (3 Rhombi)
    // Angles: 0-120 (0-0.33), 120-240 (0.33-0.66), 240-360 (0.66-1.0)
    float cubeReg = floor(nAngle * 3.0);
    vec4 cCube = mix(uColor1, uColor2, step(0.5, abs(cubeReg - 1.0)));
    cCube = mix(cCube, uColor3, step(1.5, cubeReg));
    
    // 5: Triangles (6 Triangles)
    float triReg = floor(nAngle * 6.0);
    // Sequence: 1, 2, 3, 1, 2, 3...
    float triMod = mod(triReg, 3.0);
    vec4 cTriangle = mix(uColor1, uColor2, step(0.5, abs(triMod - 1.0)));
    cTriangle = mix(cTriangle, uColor3, step(1.5, triMod));
    
    // 6: Pentagonal (Type 3 / 3-split offset)
    // Offset angle by 0.5/3.0 (half a segment)
    float pentaReg = floor(fract(nAngle + 0.1666) * 3.0);
    vec4 cPenta = mix(uColor1, uColor2, step(0.5, abs(pentaReg - 1.0)));
    cPenta = mix(cPenta, uColor3, step(1.5, pentaReg));

    // Selection
    finalColor = mix(finalColor, cLayer, when_between(uColoring, -0.1, 0.5));
    finalColor = mix(finalColor, cSolid, when_between(uColoring, 0.5, 1.5));
    finalColor = mix(finalColor, cStripes, when_between(uColoring, 1.5, 2.5));
    finalColor = mix(finalColor, cTri, when_between(uColoring, 2.5, 3.5));
    finalColor = mix(finalColor, cCube, when_between(uColoring, 3.5, 4.5));
    finalColor = mix(finalColor, cTriangle, when_between(uColoring, 4.5, 5.5));
    finalColor = mix(finalColor, cPenta, when_between(uColoring, 5.5, 6.5));

    // 7. Alpha & Blending Logic
    
    // Copy Layer Alpha
    float alphaMult = mix(1.0, layerAlpha, uCopyLayerAlpha);
    finalColor.a *= alphaMult;
    
    // Master Alpha
    finalColor.a *= uAlpha;
    
    // Apply Mask (Hex Shape)
    // If "Punch Out" (Mode 5), we invert logic: 
    // Transparent where hex is, Opaque where gap is.
    float isPunchOut = when_between(uBlendingMode, 4.5, 5.5);
    float finalMask = mix(mask, 1.0 - mask, isPunchOut);
    
    finalColor.a *= finalMask;

    // Apply Blending with Background (Original Layer)
    // 0=Normal, 1=Multiply, 2=Screen, 3=Overlay, 4=Overflow, 5=PunchOut
    
    // Normal / Overflow / PunchOut are compositing logic, others are color math.
    
    vec4 base = originalPixel;
    vec3 mixedColor = finalColor.rgb;
    
    // Multiply
    vec3 mult = blendMultiply(base.rgb, finalColor.rgb);
    // Screen
    vec3 scr = blendScreen(base.rgb, finalColor.rgb);
    // Overlay
    vec3 ovr = blendOverlay(base.rgb, finalColor.rgb);
    
    mixedColor = mix(mixedColor, mult, when_between(uBlendingMode, 0.5, 1.5));
    mixedColor = mix(mixedColor, scr, when_between(uBlendingMode, 1.5, 2.5));
    mixedColor = mix(mixedColor, ovr, when_between(uBlendingMode, 2.5, 3.5));
    
    // Compositing
    // Normal: Overly on top, strictly inside layer alpha? 
    // Description: "Normal... but only within layer's original opaque areas"
    // "Overflow": "Rendered fully" (ignore base alpha clip)
    
    float isNormal = when_between(uBlendingMode, -0.1, 0.5);
    float isOverflow = when_between(uBlendingMode, 3.5, 4.5);
    
    // Logic: 
    // If Normal: result = mix(base, hex, hex.a * base.a) ? 
    // Usually "only within opaque areas" means we clip by base.a.
    
    // Final composite logic
    vec4 result = base;
    
    // If pattern is effectively transparent (gaps), we see base.
    // mix(base, pattern, pattern.a)
    
    vec4 composite = vec4(mixedColor, finalColor.a);
    
    // Apply clipping for Normal mode
    float clip = mix(1.0, base.a, isNormal); // If normal, multiply alpha by base.a
    // Ensure Overflow ignores this clip (keeps 1.0)
    // PunchOut (Mode 5) clears alpha.
    
    composite.a *= clip;
    
    // Mix based on alpha
    // Result = base * (1 - composite.a) + composite * composite.a ?? (Standard premult blending)
    // Simplified mix:
    result.rgb = mix(result.rgb, composite.rgb, composite.a);
    
    // Handle Punch Out specifically
    // "Punch Out - Hexagon punch through... making layer transparent"
    // If punchout, alpha = base.a * (1.0 - hexMask).
    // We calculated finalMask as inverted earlier.
    if (isPunchOut > 0.5) {
       result = base;
       result.a *= finalMask; // Cuts hole
    } else {
        // Apply alpha update for normal cases
        // If Overflow, we might extend outside base geometry.
        // If Normal, we are clipped by base.a.
        float finalA = max(base.a, composite.a); // Keep max alpha?
        // Actually, if Normal, we shouldn't add alpha where base is 0.
        if (isNormal > 0.5) {
            result.a = base.a; // Preserve original alpha channel?
            // "Overlaid ... within layer's original opaque areas"
            // This implies we don't increase the alpha of the layer, just change color.
            result.rgb = mix(base.rgb, mixedColor, finalColor.a);
        } else if (isOverflow > 0.5) {
             // Add hex on top, extending alpha
             result = mix(base, composite, composite.a);
        } else {
             // Blend modes (Screen/Mult/Overlay) usually apply inside existing alpha too
             result.rgb = mix(base.rgb, mixedColor, finalColor.a);
             result.a = base.a;
        }
    }

    gl_FragColor = result;
}
