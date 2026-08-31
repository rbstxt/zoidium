precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;
uniform vec2 uvScale;

// -- Core Parameters --
uniform float Inner_Mode;
uniform float Inner_Blur;
uniform vec3 Inner_Fill;
uniform vec3 Fill_Color;
uniform float Size;
uniform float Blend_Mode;
uniform float Softness;
uniform float Choker;
uniform float Opacity;
uniform float Distance;
uniform float Angle;

// -- Color Selections Settings --
uniform float View_All_Selection_Color;
uniform float Split_Touching_Colors;

// -- Selection 1 --
uniform float Enable;
uniform float View_Selection_Only;
uniform vec3 Target_Color;
uniform float Tolerance;
uniform float Use_Local_Transform;
uniform float Local_Distance;
uniform float Local_Angle;

// -- Selection 2 --
uniform float Enable_2;
uniform float View_Selection_Only_2;
uniform vec3 Target_Color_2;
uniform float Tolerance_2;
uniform float Use_Local_Transform_2;
uniform float Local_Distance_2;
uniform float Local_Angle_2;

// -- Selection 3 --
uniform float Enable_3;
uniform float View_Selection_Only_3;
uniform vec3 Target_Color_3;
uniform float Tolerance_3;
uniform float Use_Local_Transform_3;
uniform float Local_Distance_3;
uniform float Local_Angle_3;

// -- Selection 4 --
uniform float Enable_4;
uniform float View_Selection_Only_4;
uniform vec3 Target_Color_4;
uniform float Tolerance_4;
uniform float Use_Local_Transform_4;
uniform float Local_Distance_4;
uniform float Local_Angle_4;

// -- Selection 5 --
uniform float Enable_5;
uniform float View_Selection_Only_5;
uniform vec3 Target_Color_5;
uniform float Tolerance_5;
uniform float Use_Local_Transform_5;
uniform float Local_Distance_5;
uniform float Local_Angle_5;

// -- Selection 6 --
uniform float Enable_6;
uniform float View_Selection_Only_6;
uniform vec3 Target_Color_6;
uniform float Tolerance_6;
uniform float Use_Local_Transform_6;
uniform float Local_Distance_6;
uniform float Local_Angle_6;

// -- Selection 7 --
uniform float Enable_7;
uniform float View_Selection_Only_7;
uniform vec3 Target_Color_7;
uniform float Tolerance_7;
uniform float Use_Local_Transform_7;
uniform float Local_Distance_7;
uniform float Local_Angle_7;

// -- Selection 8 --
uniform float Enable_8;
uniform float View_Selection_Only_8;
uniform vec3 Target_Color_8;
uniform float Tolerance_8;
uniform float Use_Local_Transform_8;
uniform float Local_Distance_8;
uniform float Local_Angle_8;

// -- Selection 9 --
uniform float Enable_9;
uniform float View_Selection_Only_9;
uniform vec3 Target_Color_9;
uniform float Tolerance_9;
uniform float Use_Local_Transform_9;
uniform float Local_Distance_9;
uniform float Local_Angle_9;

// -- Selection 10 --
uniform float Enable_10;
uniform float View_Selection_Only_10;
uniform vec3 Target_Color_10;
uniform float Tolerance_10;
uniform float Use_Local_Transform_10;
uniform float Local_Distance_10;
uniform float Local_Angle_10;

// -- Helper: Photoshop/AE Blend Modes --
vec3 applyBlendMode(vec3 base, vec3 blend, float mode) {
    if (mode < 0.5) return blend; // 0: Normal
    if (mode < 1.5) return clamp(base + blend, 0.0, 1.0); // 1: Add
    if (mode < 2.5) return base * blend; // 2: Multiply
    if (mode < 3.5) return 1.0 - (1.0 - base) * (1.0 - blend); // 3: Screen
    
    // 4: Overlay
    if (mode < 4.5) {
        vec3 overlay;
        for(int i=0; i<3; i++) {
            overlay[i] = base[i] < 0.5 ? (2.0 * base[i] * blend[i]) : (1.0 - 2.0 * (1.0 - base[i]) * (1.0 - blend[i]));
        }
        return overlay;
    }
    
    if (mode < 5.5) return min(base, blend); // 5: Darken
    
    // 6: Hard Light
    vec3 hardLight;
    for(int i=0; i<3; i++) {
        hardLight[i] = blend[i] < 0.5 ? (2.0 * base[i] * blend[i]) : (1.0 - 2.0 * (1.0 - base[i]) * (1.0 - blend[i]));
    }
    return hardLight;
}

// -- Helper: Check which Selection Mask a pixel belongs to --
int getMaskId(vec4 c) {
    if (c.a < 0.01) return -1; // Transparent layer bounds
    
    if (Enable > 0.5 && distance(c.rgb, Target_Color) <= (Tolerance / 100.0)) return 1;
    if (Enable_2 > 0.5 && distance(c.rgb, Target_Color_2) <= (Tolerance_2 / 100.0)) return 2;
    if (Enable_3 > 0.5 && distance(c.rgb, Target_Color_3) <= (Tolerance_3 / 100.0)) return 3;
    if (Enable_4 > 0.5 && distance(c.rgb, Target_Color_4) <= (Tolerance_4 / 100.0)) return 4;
    if (Enable_5 > 0.5 && distance(c.rgb, Target_Color_5) <= (Tolerance_5 / 100.0)) return 5;
    if (Enable_6 > 0.5 && distance(c.rgb, Target_Color_6) <= (Tolerance_6 / 100.0)) return 6;
    if (Enable_7 > 0.5 && distance(c.rgb, Target_Color_7) <= (Tolerance_7 / 100.0)) return 7;
    if (Enable_8 > 0.5 && distance(c.rgb, Target_Color_8) <= (Tolerance_8 / 100.0)) return 8;
    if (Enable_9 > 0.5 && distance(c.rgb, Target_Color_9) <= (Tolerance_9 / 100.0)) return 9;
    if (Enable_10 > 0.5 && distance(c.rgb, Target_Color_10) <= (Tolerance_10 / 100.0)) return 10;
    
    return 0; // Global Layer Mask
}

// -- Helper: Check if sampled pixel is INSIDE the current Mask boundary --
bool isInsideMask(vec4 c, int maskId, vec4 centerColor, bool selectionsActive) {
    if (c.a < 0.01) return false;
    
    // Check Split Touching Colors FIRST. 
    // If active AND selections are enabled, any distinct color change generates a boundary.
    if (Split_Touching_Colors > 0.5 && selectionsActive) {
        if (distance(c.rgb, centerColor.rgb) > 0.015) return false; 
    }
    
    if (maskId == 1) return (distance(c.rgb, Target_Color) <= (Tolerance / 100.0));
    if (maskId == 2) return (distance(c.rgb, Target_Color_2) <= (Tolerance_2 / 100.0));
    if (maskId == 3) return (distance(c.rgb, Target_Color_3) <= (Tolerance_3 / 100.0));
    if (maskId == 4) return (distance(c.rgb, Target_Color_4) <= (Tolerance_4 / 100.0));
    if (maskId == 5) return (distance(c.rgb, Target_Color_5) <= (Tolerance_5 / 100.0));
    if (maskId == 6) return (distance(c.rgb, Target_Color_6) <= (Tolerance_6 / 100.0));
    if (maskId == 7) return (distance(c.rgb, Target_Color_7) <= (Tolerance_7 / 100.0));
    if (maskId == 8) return (distance(c.rgb, Target_Color_8) <= (Tolerance_8 / 100.0));
    if (maskId == 9) return (distance(c.rgb, Target_Color_9) <= (Tolerance_9 / 100.0));
    if (maskId == 10) return (distance(c.rgb, Target_Color_10) <= (Tolerance_10 / 100.0));
    
    return true; 
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    int mId = getMaskId(texel);
    
    bool selectionsActive = (Enable > 0.5 || Enable_2 > 0.5 || Enable_3 > 0.5 || Enable_4 > 0.5 || Enable_5 > 0.5 || 
                             Enable_6 > 0.5 || Enable_7 > 0.5 || Enable_8 > 0.5 || Enable_9 > 0.5 || Enable_10 > 0.5);
    
    // -- 1. Debug Views (View Masks / Selection Colors) --
    if (View_All_Selection_Color > 0.5) {
        if (mId == 1) { gl_FragColor = vec4(Target_Color, texel.a); return; }
        if (mId == 2) { gl_FragColor = vec4(Target_Color_2, texel.a); return; }
        if (mId == 3) { gl_FragColor = vec4(Target_Color_3, texel.a); return; }
        if (mId == 4) { gl_FragColor = vec4(Target_Color_4, texel.a); return; }
        if (mId == 5) { gl_FragColor = vec4(Target_Color_5, texel.a); return; }
        if (mId == 6) { gl_FragColor = vec4(Target_Color_6, texel.a); return; }
        if (mId == 7) { gl_FragColor = vec4(Target_Color_7, texel.a); return; }
        if (mId == 8) { gl_FragColor = vec4(Target_Color_8, texel.a); return; }
        if (mId == 9) { gl_FragColor = vec4(Target_Color_9, texel.a); return; }
        if (mId == 10) { gl_FragColor = vec4(Target_Color_10, texel.a); return; }
        
        // Render unselected areas as black with the original alpha bounds
        gl_FragColor = vec4(0.0, 0.0, 0.0, texel.a);
        return;
    }
    
    // Individual Mask Views (Now renders the Target Color instead of white)
    if (Enable > 0.5 && View_Selection_Only > 0.5) { gl_FragColor = vec4(mId == 1 ? Target_Color : vec3(0.0), texel.a); return; }
    if (Enable_2 > 0.5 && View_Selection_Only_2 > 0.5) { gl_FragColor = vec4(mId == 2 ? Target_Color_2 : vec3(0.0), texel.a); return; }
    if (Enable_3 > 0.5 && View_Selection_Only_3 > 0.5) { gl_FragColor = vec4(mId == 3 ? Target_Color_3 : vec3(0.0), texel.a); return; }
    if (Enable_4 > 0.5 && View_Selection_Only_4 > 0.5) { gl_FragColor = vec4(mId == 4 ? Target_Color_4 : vec3(0.0), texel.a); return; }
    if (Enable_5 > 0.5 && View_Selection_Only_5 > 0.5) { gl_FragColor = vec4(mId == 5 ? Target_Color_5 : vec3(0.0), texel.a); return; }
    if (Enable_6 > 0.5 && View_Selection_Only_6 > 0.5) { gl_FragColor = vec4(mId == 6 ? Target_Color_6 : vec3(0.0), texel.a); return; }
    if (Enable_7 > 0.5 && View_Selection_Only_7 > 0.5) { gl_FragColor = vec4(mId == 7 ? Target_Color_7 : vec3(0.0), texel.a); return; }
    if (Enable_8 > 0.5 && View_Selection_Only_8 > 0.5) { gl_FragColor = vec4(mId == 8 ? Target_Color_8 : vec3(0.0), texel.a); return; }
    if (Enable_9 > 0.5 && View_Selection_Only_9 > 0.5) { gl_FragColor = vec4(mId == 9 ? Target_Color_9 : vec3(0.0), texel.a); return; }
    if (Enable_10 > 0.5 && View_Selection_Only_10 > 0.5) { gl_FragColor = vec4(mId == 10 ? Target_Color_10 : vec3(0.0), texel.a); return; }

    // If completely outside all masks (transparent pixel), process Fill/Original logic and discard shadowing early
    if (mId == -1) {
        if (Inner_Mode > 1.5 && !selectionsActive) gl_FragColor = vec4(Fill_Color, 0.0);
        else if (Inner_Mode > 0.5) gl_FragColor = vec4(0.0);
        else gl_FragColor = texel;
        return;
    }

    // Flag to determine if we should process the effect on this specific pixel
    // If selections are active, we DO NOT process the global image border (mId == 0)
    bool processEffect = !(selectionsActive && mId == 0);

    // -- 2. Determine Transform Settings (Local vs Global) --
    float activeDist = Distance;
    float activeAngle = Angle;
    
    if (mId == 1 && Use_Local_Transform > 0.5) { activeDist = Local_Distance; activeAngle = Local_Angle; }
    else if (mId == 2 && Use_Local_Transform_2 > 0.5) { activeDist = Local_Distance_2; activeAngle = Local_Angle_2; }
    else if (mId == 3 && Use_Local_Transform_3 > 0.5) { activeDist = Local_Distance_3; activeAngle = Local_Angle_3; }
    else if (mId == 4 && Use_Local_Transform_4 > 0.5) { activeDist = Local_Distance_4; activeAngle = Local_Angle_4; }
    else if (mId == 5 && Use_Local_Transform_5 > 0.5) { activeDist = Local_Distance_5; activeAngle = Local_Angle_5; }
    else if (mId == 6 && Use_Local_Transform_6 > 0.5) { activeDist = Local_Distance_6; activeAngle = Local_Angle_6; }
    else if (mId == 7 && Use_Local_Transform_7 > 0.5) { activeDist = Local_Distance_7; activeAngle = Local_Angle_7; }
    else if (mId == 8 && Use_Local_Transform_8 > 0.5) { activeDist = Local_Distance_8; activeAngle = Local_Angle_8; }
    else if (mId == 9 && Use_Local_Transform_9 > 0.5) { activeDist = Local_Distance_9; activeAngle = Local_Angle_9; }
    else if (mId == 10 && Use_Local_Transform_10 > 0.5) { activeDist = Local_Distance_10; activeAngle = Local_Angle_10; }

    // Convert AE angle to Offset Vector
    float rad = radians(activeAngle);
    vec2 offsetDir = vec2(cos(rad), -sin(rad)) * activeDist / resolution * uvScale;

    // -- 3. Calculate Distance to Edge (Multi-tap Disc Sampling) --
    float minOutsideDist = Size + 1.0;
    
    if (Size > 0.0 && processEffect) {
        const int SAMPLES = 48; // Excellent balance of precision/performance for up to Size ~100
        for(int i = 0; i < SAMPLES; i++) {
            float fi = float(i);
            float r = sqrt(fi + 0.5) / sqrt(float(SAMPLES)) * Size;
            float theta = fi * 2.3999632; // Golden Angle constant
            
            vec2 sampUv = vUvScaled - offsetDir + vec2(cos(theta), sin(theta)) * (r / resolution * uvScale);
            vec4 sCol = texture2D(tDiffuse, sampUv);
            
            // Passed selectionsActive into the function here
            if (!isInsideMask(sCol, mId, texel, selectionsActive)) {
                minOutsideDist = min(minOutsideDist, r);
            }
        }
    } else if (!processEffect) {
        minOutsideDist = Size + 1.0; // Pushes it outside falloff range so shadowAlpha becomes 0
    } else {
        minOutsideDist = 0.0;
    }

    // -- 4. Compute Gradation Falloff --
    float currentEdge = max(0.0, Size - Choker);
    float shadowAlpha = 0.0;
    
    if (Size > 0.0 && processEffect) {
        if (Inner_Blur > 0.5) {
            // Soft Blur Style
            shadowAlpha = smoothstep(currentEdge, currentEdge - Softness, minOutsideDist);
        } else {
            // Default Blur Style (Linear)
            if (Softness > 0.0) {
                shadowAlpha = clamp(1.0 - (minOutsideDist - (currentEdge - Softness)) / Softness, 0.0, 1.0);
            } else {
                shadowAlpha = minOutsideDist <= currentEdge ? 1.0 : 0.0;
            }
        }
    }
    
    // Bind by Global Opacity and Pixel Alpha constraint
    shadowAlpha *= (Opacity / 100.0) * texel.a;

    // -- 5. Base Rendering & Inner Modes --
    vec4 baseColor = texel;
    
    // Fill Color Override Mode (Inactive when Selection is Enabled)
    if (Inner_Mode > 1.5 && !selectionsActive) {
        baseColor.rgb = Fill_Color;
    }
    
    vec3 blendedRGB = applyBlendMode(baseColor.rgb, Inner_Fill, Blend_Mode);
    vec4 finalColor;
    
    // Output Mode Composite
    if (Inner_Mode > 0.5 && Inner_Mode < 1.5) {
        // Transparent Mode
        if (!processEffect) {
            finalColor = vec4(0.0); // Keep non-targeted areas transparent in Transparent mode
        } else {
            finalColor = vec4(Inner_Fill, shadowAlpha);
        }
    } else {
        // Original Layer & Fill Modes
        finalColor.rgb = mix(baseColor.rgb, blendedRGB, shadowAlpha);
        finalColor.a = baseColor.a;
    }

    gl_FragColor = finalColor;
}
