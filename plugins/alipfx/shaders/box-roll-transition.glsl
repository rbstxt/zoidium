precision highp float;
precision highp int;

// Built-in Panzoid variables
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Dynamic property
uniform float Time;

// Pseudo-random generator for subtle trajectory variations
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
    
    // 8x5 grid matches the box proportion in the video
    float cols = 8.0;
    float rows = 5.0;
    
    float isBlack = 0.0;
    
    for(float x = 0.0; x < 8.0; x++) {
        for(float y = 0.0; y < 5.0; y++) {
            
            vec2 targetUv = vec2((x + 0.5) / cols, (y + 0.5) / rows);
            
            bool isFirstBox = (x == 0.0 && y == 0.0); 
            
            float delay = 0.0;
            vec2 startOffset = vec2(0.0);
            
            float r1 = rand(vec2(x, y) + 1.0);
            float r2 = rand(vec2(x, y) + 5.0);
            
            if (isFirstBox) {
                // 1. FIRST BOX: Rolls horizontally along the bottom from the far right
                delay = 0.0; 
                startOffset = vec2(1.5, 0.0); 
            } else {
                // 2. THE REST: Enter strictly from the right side, spanning lower-right to upper-right
                // Staggered delay fills bottom-up and right-to-left
                delay = 0.4 + (y * 0.15) + (x * 0.08) + (r1 * 0.1);
                
                // Spawn position is off-screen right (+X), with a slight vertical arc (+Y) relative to its row
                startOffset = vec2(1.3 + r1 * 0.4, r2 * 0.2); 
            }
            
            float t = clamp((Time * 1.5 - delay), 0.0, 1.0);
            
            if (t > 0.0) {
                // Smooth ease-out curve for tumbling into position
                float ease = 1.0 - pow(1.0 - t, 3.0);
                
                vec2 currentPos = mix(targetUv + startOffset, targetUv, ease);
                
                vec2 diff = uv - currentPos;
                diff.x *= aspect; // Maintain square proportion
                
                // Rotation spin effect
                float spinAmount = 3.14159 * 2.0 * (1.0 - ease);
                if (isFirstBox) {
                    spinAmount *= 3.0; // Extra turns for the long roll across the screen
                } else {
                    spinAmount *= (1.0 + floor(r1 * 2.0));
                }
                
                diff = rotate2d(spinAmount) * diff;
                
                // Box size (0.55 ensures slight overlap to hide seams)
                float boxHalfWidth = (0.55 / cols) * aspect;
                float boxHalfHeight = 0.55 / rows;
                
                vec2 d = abs(diff) - vec2(boxHalfWidth, boxHalfHeight);
                float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
                
                if (dist <= 0.0) {
                    isBlack = 1.0;
                }
            }
        }
    }
    
    // Output final color
    if (isBlack > 0.5) {
        // Outputs a fully transparent pixel (Alpha = 0.0)
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
        gl_FragColor = texel;
    }
}
