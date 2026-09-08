precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform float u_time;

// --- User Defined Variables ---

uniform float amplitude; 
uniform float frequency; 
uniform float relHeight; 
uniform float rotatePuddle; 
uniform vec2 center; 
uniform float phaseStart; 
uniform float phaseSpeed; 
uniform float innerRadius; 
uniform float innerSoftness; 
uniform float outerRadius; 
uniform float outerSoftness; 

// New Uniform for Edge Handling
// 0: Clamp, 1: Repeat, 2: Mirror, 3: Transparent
uniform int edgeBehavior; 

// Helper function to rotate coordinates
vec2 rotate(vec2 v, float a) {
    float s = sin(radians(a));
    float c = cos(radians(a));
    mat2 m = mat2(c, -s, s, c);
    return m * v;
}

void main()
{
    // --- 1. Coordinate Setup ---
    vec2 p = vUvScaled - 0.5 - center;
    p = rotate(p, rotatePuddle);

    vec2 stretchedP = p;
    stretchedP.y /= max(relHeight, 0.001);

    float dist = length(stretchedP);

    // --- 2. Mask Calculation ---
    float inMask = smoothstep(innerRadius, innerRadius + innerSoftness, dist);
    float outMask = 1.0 - smoothstep(outerRadius, outerRadius + outerSoftness, dist);
    float finalMask = inMask * outMask;

    // --- 3. Wave & Offset Calculation ---
    float currentPhase = phaseStart + (u_time * phaseSpeed);
    float wave = sin((dist * frequency * 10.0) - currentPhase);
    
    vec2 dir = (dist > 0.0) ? (stretchedP / dist) : vec2(0.0);
    vec2 offset = dir * wave * amplitude * finalMask;

    // --- 4. Apply Offset ---
    vec2 finalUv = vUvScaled + offset;

    // --- 5. Edge Behavior Logic ---
    vec4 color;

    if (edgeBehavior == 1) {
        // Repeat (Wrap)
        finalUv = fract(finalUv);
        color = texture2D(tDiffuse, finalUv);
    } 
    else if (edgeBehavior == 2) {
        // Mirror (Triangle Wave)
        // This calculates a ping-pong effect for coordinates outside 0-1
        finalUv = 1.0 - abs(fract(finalUv * 0.5) * 2.0 - 1.0);
        color = texture2D(tDiffuse, finalUv);
    } 
    else if (edgeBehavior == 3) {
        // Transparent
        if (finalUv.x < 0.0 || finalUv.x > 1.0 || finalUv.y < 0.0 || finalUv.y > 1.0) {
            color = vec4(0.0);
        } else {
            color = texture2D(tDiffuse, finalUv);
        }
    } 
    else {
        // Clamp (Default)
        finalUv = clamp(finalUv, 0.0, 1.0);
        color = texture2D(tDiffuse, finalUv);
    }

    gl_FragColor = color;
}
