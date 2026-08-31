precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

// Built-in Panzoid Uniforms
uniform vec2 resolution;

// 1. Length & Width
uniform float Min_Length;
uniform float Length;
uniform float Min_Width;
uniform float Max_Width;

// 2. Range
uniform float Min_Range;
uniform float Max_Range;

// 3. Color
uniform vec3 A;
uniform vec3 B;

// 4. Transform
uniform float Rotation_Speed;
uniform float Speed_Random;
uniform float Opacity;
uniform float Opacity_Random;

// 5. Sharp Line
uniform float Start_Length;
uniform float End_Length;
uniform float Start_Width;
uniform float End_Width;

// 6. Stroke Dash
uniform float Dash;
uniform float Offset;

// 7. Core
uniform float Seed;
uniform float time;

#define NUM_TRAILS 150 // Adjust this to increase/decrease the amount of star trails
#define PI 3.14159265359
#define TWO_PI 6.28318530718

// Pseudo-random number generator
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    // Center the coordinates and calculate polar coordinates
    vec2 p = vUv * resolution - resolution * 0.5;
    float r = length(p);
    float a = atan(p.y, p.x); 
    
    vec4 bg = texture2D(tDiffuse, vUvScaled);
    vec4 overlay = vec4(0.0);

    // Normalize percentage-based properties (Panzoid numbers are pure floats, dividing by 100 aligns with AE's % UI)
    float minLenRad = (Min_Length / 100.0) * TWO_PI;
    float maxLenRad = (Length / 100.0) * TWO_PI;
    float baseOpac = Opacity / 100.0;
    float spdRandBase = Speed_Random / 100.0;
    float opRandBase = Opacity_Random / 100.0;
    float sLenBase = Start_Length / 100.0;
    float eLenBase = End_Length / 100.0;
    float sWidthBase = Start_Width / 100.0;
    float eWidthBase = End_Width / 100.0;

    for(int i = 0; i < NUM_TRAILS; i++) {
        float fi = float(i);
        
        // Generate random characteristics for this specific trail based on Seed
        float rndRadius = hash(vec2(fi, Seed));
        float rndWidth  = hash(vec2(fi, Seed + 1.0));
        float rndSpeed  = hash(vec2(fi, Seed + 2.0));
        float rndAngle  = hash(vec2(fi, Seed + 3.0));
        float rndLength = hash(vec2(fi, Seed + 4.0));
        float rndColor  = hash(vec2(fi, Seed + 5.0));
        float rndOpac   = hash(vec2(fi, Seed + 6.0));

        // Range
        float trailRadius = mix(Min_Range, Max_Range, rndRadius);
        
        // Optimization check: If the pixel is too far from this trail's radius, skip calculations
        float dist = abs(r - trailRadius);
        if(dist > Max_Width * 1.5) continue; 
        
        // Transform & Rotation
        float currentTrailSpeed = Rotation_Speed * mix(1.0, rndSpeed * 2.0 - 1.0, spdRandBase);
        float timeOffset = time * currentTrailSpeed * 0.1; // 0.1 scales the Panzoid speed nicely
        float baseAngle = rndAngle * TWO_PI;
        
        // Angle Calculation (Matches AE's clockwise positive rotation)
        float ang = a - baseAngle + timeOffset; 
        ang = mod(mod(ang, TWO_PI) + TWO_PI, TWO_PI); 
        
        // Line Length
        float trailLen = mix(minLenRad, maxLenRad, rndLength);
        if(ang > trailLen) continue; 
        
        // Sharp Line (Tapering)
        float trailWidth = mix(Min_Width, Max_Width, rndWidth);
        float widthMult = 1.0;
        float startTaperRad = sLenBase * trailLen;
        float endTaperRad = eLenBase * trailLen;
        
        if (startTaperRad > 0.0 && ang < startTaperRad) {
            widthMult = mix(sWidthBase, 1.0, ang / startTaperRad);
        } else if (endTaperRad > 0.0 && ang > trailLen - endTaperRad) {
            widthMult = mix(eWidthBase, 1.0, (trailLen - ang) / endTaperRad);
        }
        
        float currentWidth = trailWidth * widthMult;
        
        // Render Trail with Anti-aliasing
        float alpha = smoothstep(currentWidth * 0.5 + 0.75, currentWidth * 0.5 - 0.75, dist);
        
        if (alpha > 0.0) {
            // Stroke Dash
            if(Dash > 0.1) {
                float arcLengthPx = trailRadius * ang; 
                float dashPhase = mod(arcLengthPx - Offset, Dash * 2.0);
                if(dashPhase > Dash) alpha = 0.0;
            }
            
            if (alpha > 0.0) {
                // Color & Opacity Randomization
                vec3 color = mix(A, B, rndColor);
                float trailAlpha = baseOpac * mix(1.0, rndOpac, opRandBase);
                alpha *= trailAlpha;
                
                // Composite using pre-multiplied alpha (Front-to-Back accumulation)
                vec4 src = vec4(color * alpha, alpha);
                overlay = src + overlay * (1.0 - src.a);
            }
        }
    }

    // Final blend with the background layer
    gl_FragColor = overlay + bg * (1.0 - overlay.a);
}
