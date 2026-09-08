precision highp float;
// precision highp int; // Avoided as requested

// --- UNIFORMS (Connect these to your host program) ---
uniform sampler2D tDiffuse;      // Background Image
uniform vec2 uResolution;        // Screen resolution (e.g., 1920.0, 1080.0)
uniform float uTime;             // Time in seconds
uniform vec2 uMouse;             // Mouse position (optional interaction)

// --- PLEXUS SETTINGS (Editable Variables) ---
uniform vec3 uColor;             // Color of the plexus (default: 0.2, 0.6, 1.0)
uniform float uGridScale;        // Size of the grid cells (default: 5.0 to 10.0)
uniform float uDotSize;          // Radius of the dots (default: 0.05)
uniform float uLineThickness;    // Thickness of lines (default: 0.002)
uniform float uConnectionDist;   // Max distance to connect dots (default: 0.35)
uniform float uGlowStrength;     // Intensity of the glow (default: 0.5)

varying vec2 vUvScaled;          // From your template

// --- HELPER FUNCTIONS ---

// random hash function (float based)
float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n));
}

// "Noise Effector": Calculate particle position for a grid ID
vec2 getParticlePos(vec2 id) {
    vec2 n = hash22(id);
    // Animate the point using sine waves (Lissajous-like movement)
    // We use uTime to drive the "Noise Effector"
    float t = uTime * 0.5;
    
    // Create organic movement
    float x = sin(t * n.x + n.y * 6.28) * 0.4; // Keep inside cell mostly
    float y = cos(t * n.y + n.x * 6.28) * 0.4;
    
    return vec2(x, y);
}

// Distance to a line segment (a to b)
float distToLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

// ... [Insert Shader 1: Common Logic here] ...

void main() {
    vec2 uv = vUvScaled;
    uv.x *= uResolution.x / uResolution.y;
    
    vec2 st = uv * uGridScale;
    vec2 id = floor(st);
    vec2 localUv = fract(st) - 0.5;
    
    vec3 linesColor = vec3(0.0);
    
    // Arrays to store neighbor positions to avoid recalculating
    // GLSL 1.0/ES doesn't support dynamic array sizing well, so we hardcode logic
    // But to keep it "float" based and loopable, we will just re-calculate on fly
    // or use a double loop strategy which is O(9*9) = 81 iterations max per pixel (acceptable for fragment)
    
    // Optimization: We only need to draw lines from the CURRENT cell's neighbors
    // to THEIR neighbors.
    
    float minDist = 100.0; // Track closest line for alpha blending
    float alphaAcc = 0.0;  // Accumulate line brightness
    
    // Loop 1: Find Neighbor A
    for(float j = -1.0; j <= 1.0; j += 1.0) {
        for(float i = -1.0; i <= 1.0; i += 1.0) {
            vec2 offsetA = vec2(i, j);
            vec2 posA = offsetA + getParticlePos(id + offsetA); // Position relative to current pixel
            
            // Loop 2: Find Neighbor B to connect to A
            // We only check neighbors of A that are also generally visible
            for(float l = -1.0; l <= 1.0; l += 1.0) {
                for(float k = -1.0; k <= 1.0; k += 1.0) {
                    vec2 offsetB = vec2(k, l);
                    
                    // Don't connect to self
                    if(abs(i-k) < 0.1 && abs(j-l) < 0.1) continue;
                    
                    // Optimization: Only check unique pairs to save performance? 
                    // In fragment shader, simple loops are often faster than complex logic.
                    
                    vec2 posB = offsetB + getParticlePos(id + offsetB);
                    
                    // Check physical distance between the two particles
                    vec2 distVector = posA - posB;
                    float particleDist = length(distVector);
                    
                    // If particles are close enough to connect
                    if(particleDist < uConnectionDist) {
                        // Calculate distance from PIXEL to the LINE SEGMENT
                        float d = distToLine(localUv, posA, posB);
                        
                        // Create the line visual
                        // Fade out based on particle distance (plexus behavior)
                        float connectionFade = 1.0 - smoothstep(uConnectionDist * 0.5, uConnectionDist, particleDist);
                        
                        // Draw line with thickness
                        float line = smoothstep(uLineThickness, uLineThickness * 0.5, d);
                        
                        alphaAcc += line * connectionFade;
                    }
                }
            }
        }
    }
    
    // Clamp opacity
    alphaAcc = clamp(alphaAcc, 0.0, 1.0);
    linesColor = uColor * alphaAcc;

    // Composite Additively
    vec4 bg = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = vec4(bg.rgb + linesColor, 1.0);
}
