precision highp float;
precision highp int;

// Built-in Panzoid variables
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Dynamic property
uniform float Time;

// Pseudo-random generator
float rand(vec2 co){
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// 2D Rotation matrix
mat2 rotate2d(float angle){
    return mat2(cos(angle), -sin(angle),
                sin(angle),  cos(angle));
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    float aspect = resolution.x / resolution.y;
    vec2 uv = vUv;
    
    float cols = 8.0;
    float rows = 5.0;
    
    float isBlack = 0.0;
    
    // Check all boxes
    for(float x = 0.0; x < 8.0; x++) {
        for(float y = 0.0; y < 5.0; y++) {
            
            vec2 targetUv = vec2((x + 0.5) / cols, (y + 0.5) / rows);
            bool isFirstBox = (x == 0.0 && y == 0.0); 
            
            float r1 = rand(vec2(x, y) + 1.0);
            float r2 = rand(vec2(x, y) + 5.0);
            
            float delay = 0.0;
            vec2 exitOffset = vec2(0.0);
            
            if (isFirstBox) {
                // 1. FIRST BOX: Leaves absolute last, rolls away horizontally to the right
                delay = 1.2; 
                exitOffset = vec2(1.5, 0.0); 
            } else {
                // 2. THE REST: Top-right boxes leave first, bottom-left leave last
                // We invert the X and Y delay logic from the forward animation
                delay = ((4.0 - y) * 0.15) + ((7.0 - x) * 0.08) + (r1 * 0.1);
                
                // They fly off to the right and slightly up
                exitOffset = vec2(1.3 + r1 * 0.4, r2 * 0.2); 
            }
            
            float t = clamp((Time * 1.5 - delay), 0.0, 1.0);
            
            // At t=0, the ease is 0 (box is on screen). 
            // We use pow(t, 3.0) for an ease-in curve so they start slow and accelerate away
            float ease = pow(t, 3.0);
            
            // Mix from the grid slot to the off-screen offset
            vec2 currentPos = mix(targetUv, targetUv + exitOffset, ease);
            
            vec2 diff = uv - currentPos;
            diff.x *= aspect; 
            
            // Spin rotation (negative spin so it looks like it's rewinding)
            float spinAmount = 3.14159 * 2.0 * ease;
            if (isFirstBox) {
                spinAmount *= -3.0; 
            } else {
                spinAmount *= -(1.0 + floor(r1 * 2.0));
            }
            
            diff = rotate2d(spinAmount) * diff;
            
            float boxHalfWidth = (0.55 / cols) * aspect;
            float boxHalfHeight = 0.55 / rows;
            
            vec2 d = abs(diff) - vec2(boxHalfWidth, boxHalfHeight);
            float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
            
            if (dist <= 0.0) {
                isBlack = 1.0;
            }
        }
    }
    
    // Output
    if (isBlack > 0.5) {
        // Transparent Alpha Hole (Change to vec4(0.0, 0.0, 0.0, 1.0) if you want solid black boxes)
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
        gl_FragColor = texel; // Original video layer is revealed
    }
}
