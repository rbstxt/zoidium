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
    // 1. Setup Coordinates
    // Scale UVs to create a grid. Aspect ratio correction is crucial.
    vec2 uv = vUvScaled;
    uv.x *= uResolution.x / uResolution.y; // Correct aspect ratio
    
    vec2 st = uv * uGridScale; 
    vec2 id = floor(st);      // The integer-like ID of the current grid cell
    vec2 localUv = fract(st) - 0.5; // Local coordinate inside the cell (-0.5 to 0.5)
    
    vec3 color = vec3(0.0);
    
    // 2. Neighbor Search Loop (3x3 Grid)
    // We check the current cell and its 8 neighbors
    for(float y = -1.0; y <= 1.0; y += 1.0) {
        for(float x = -1.0; x <= 1.0; x += 1.0) {
            vec2 offset = vec2(x, y);
            
            // Get the unique particle position for this neighbor cell
            vec2 pointPos = getParticlePos(id + offset);
            
            // Calculate distance from current pixel to that particle
            // We add 'offset' to move the particle into our local coordinate space
            float dist = length(localUv - (offset + pointPos));
            
            // 3. Render Dot with Glow (Spherical Effector style)
            // Use inverse square law for nice soft glow: 1.0 / (d*d)
            float intensity = uGlowStrength * (uDotSize * 0.1) / (dist * dist + 0.0001);
            
            // Hard center for the dot
            float circle = smoothstep(uDotSize, uDotSize * 0.8, dist);
            
            color += uColor * (circle + intensity);
        }
    }
    
    // 4. Composite over background without dimming
    vec4 bg = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = vec4(bg.rgb + color, 1.0);
}
