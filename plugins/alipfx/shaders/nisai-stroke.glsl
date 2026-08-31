precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

// Built-in Panzoid Uniforms
uniform vec2 resolution;
uniform vec2 uvScale;

// 1. General Settings
uniform vec3 Stroke_Color;
uniform float Stroke_Width;
uniform float Stroke_Only; // float mode
uniform float Placement;   // float mode
uniform float Shape_Style; // float mode
uniform float Color_Source; // float mode
uniform float Source_Opacity;
uniform float Stroke_Opacity;
uniform float Blend_Mode; // float mode

// 2. Glow Settings
uniform float Softness;
uniform float Falloff;

// 3. Halftone Settings
uniform float Cell_Size;
uniform float Screen_Angle;
uniform vec2 Grid_Offset;

// 4. Gradient Settings
uniform vec3 Start_Color;
uniform vec3 End_Color;
uniform float Blend_Start;
uniform float Blend_End;
uniform float Angle;
uniform float Transition; // float mode
uniform float Halftone_Cell_Size;
uniform float Gradient_Screen_Angle; 
uniform vec2 Gradient_Grid_Offset;   
uniform float Halftone_Invert; // float mode

void main() {
    // Read base source layer
    vec4 src = texture2D(tDiffuse, vUvScaled);
    float srcAlpha = src.a;

    float maxA = 0.0;
    float avgA = 0.0;
    float aspect = resolution.x / resolution.y;
    vec2 pxSize = 1.0 / resolution;

    // 128-Tap Golden Spiral for High-Quality Single-Pass Stroke
    int SAMPLES = 128;
    float fSAMPLES = float(SAMPLES);
    float goldenAngle = 2.39996323;

    // Skip heavy sampling if it's just a Fill placement
    if (Placement == 3.0) { 
         maxA = 1.0;
         avgA = 1.0;
    } else {
         float rawAvgA = 0.0; // Used to track pure density for "Both" mode
         for(int i = 1; i <= 128; i++) {
             float r = sqrt(float(i) / fSAMPLES);
             float theta = float(i) * goldenAngle;
             vec2 offset = vec2(cos(theta), sin(theta)) * r * Stroke_Width * pxSize;
             float a = texture2D(tDiffuse, vUvScaled + (offset * uvScale)).a;
             
             rawAvgA += a;
             
             // [FIX]: Invert for Inside mode
             if (Placement == 1.0) {
                 a = 1.0 - a; 
             }
             
             maxA = max(maxA, a);
             avgA += a;
         }
         avgA /= fSAMPLES;
         rawAvgA /= fSAMPLES;

         // [FIX]: Special handling for "Both" placement to grow inwards and outwards
         if (Placement == 2.0) {
             float edgeIntensity = 1.0 - (abs(rawAvgA - 0.5) * 2.0);
             avgA = clamp(edgeIntensity, 0.0, 1.0);
             maxA = step(0.01, avgA); 
         }
    }

    // Process Shape Style (Comparing as floats)
    float strokeBaseAlpha = 0.0;
    if (Shape_Style == 0.0) { // Solid
        strokeBaseAlpha = step(0.01, maxA);
    } else if (Shape_Style == 1.0) { // Glow
        float sft = max(0.1, Softness / 10.0);
        float glowBase = avgA * sft;
        strokeBaseAlpha = clamp(pow(glowBase, max(0.1, Falloff)), 0.0, 1.0);
    } else if (Shape_Style == 2.0) { // Halftone
        float rad = Screen_Angle * 3.14159 / 180.0;
        mat2 rot = mat2(cos(rad), -sin(rad), sin(rad), cos(rad));
        vec2 gridUv = rot * ((vUv * resolution) - Grid_Offset) / max(1.0, Cell_Size);
        vec2 local = fract(gridUv) - 0.5;
        float dist = length(local);
        
        float radius = clamp(avgA * 1.5, 0.0, 1.0); 
        
        strokeBaseAlpha = step(dist, radius) * step(0.01, maxA);
    }

    // Process Placement
    float finalStrokeAlpha = 0.0;
    if (Placement == 0.0) finalStrokeAlpha = clamp(strokeBaseAlpha - srcAlpha, 0.0, 1.0); // Outside
    else if (Placement == 1.0) {
        // [FIX]: We inverted the mask generation, so strokeBaseAlpha is the INNER border.
        // We just need to constrain it to the original shape to be safe.
        finalStrokeAlpha = clamp(strokeBaseAlpha * srcAlpha, 0.0, 1.0); 
    }
    else if (Placement == 2.0) finalStrokeAlpha = strokeBaseAlpha; // Both
    else if (Placement == 3.0) finalStrokeAlpha = srcAlpha; // Fill

    // Process Color Source (Comparing as float)
    vec3 strokeRGB = Stroke_Color;
    if (Color_Source == 1.0) { // Gradient
        float rad = Angle * 3.14159 / 180.0;
        vec2 dir = vec2(cos(rad), sin(rad));
        vec2 cUv = vUv - 0.5;
        cUv.x *= aspect; 
        float proj = dot(cUv, dir);
        float t = proj + 0.5;

        float bs = Blend_Start / 100.0;
        float be = max(Blend_End / 100.0, bs + 0.001); 
        float gMix = smoothstep(bs, be, t);

        if (Transition == 1.0) { 
            float hrad = Gradient_Screen_Angle * 3.14159 / 180.0;
            mat2 hrot = mat2(cos(hrad), -sin(hrad), sin(hrad), cos(hrad));
            vec2 hgrid = hrot * ((vUv * resolution) - Gradient_Grid_Offset) / max(1.0, Halftone_Cell_Size);
            vec2 hlocal = fract(hgrid) - 0.5;
            float hdist = length(hlocal);
            float hradius = gMix * 0.707;
            float ht = step(hdist, hradius);
            if (Halftone_Invert == 1.0) ht = 1.0 - ht;
            gMix = ht;
        }
        strokeRGB = mix(Start_Color, End_Color, gMix);
    }

    finalStrokeAlpha *= clamp(Stroke_Opacity / 100.0, 0.0, 1.0);
    float finalSrcAlpha = srcAlpha * clamp(Source_Opacity / 100.0, 0.0, 1.0);

    vec4 sCol = vec4(strokeRGB, finalStrokeAlpha);
    vec4 baseCol = vec4(src.rgb, finalSrcAlpha);
    vec4 outCol = vec4(0.0);

    if (Stroke_Only == 1.0) {
        outCol = vec4(sCol.rgb * sCol.a, sCol.a);
    } else {
        vec4 botLayer = (Placement == 0.0) ? sCol : baseCol;
        vec4 topLayer = (Placement == 0.0) ? baseCol : sCol;

        // Apply Blend Modes (Comparing as floats)
        vec3 bRGB = topLayer.rgb;
        if (Blend_Mode == 1.0) bRGB = botLayer.rgb + topLayer.rgb; 
        else if (Blend_Mode == 2.0) bRGB = 1.0 - (1.0 - botLayer.rgb) * (1.0 - topLayer.rgb); 
        else if (Blend_Mode == 3.0) bRGB = botLayer.rgb * topLayer.rgb; 

        float outA = topLayer.a + botLayer.a * (1.0 - topLayer.a);
        vec3 outRGB = (bRGB * topLayer.a + botLayer.rgb * botLayer.a * (1.0 - topLayer.a)) / max(outA, 0.00001);

        outCol = vec4(outRGB * outA, outA); 
    }

    gl_FragColor = outCol;
}
