precision highp float;
precision highp int;

uniform sampler2D tDiffuse; // The background texture (optional)
varying vec2 vUvScaled;     // Use this UV from your template

// --- EDITABLE UNIFORMS (Connect these to your host program) ---
// If you cannot set uniforms, change the "default" values here.
uniform float uTime;                // Time in seconds
uniform vec2 uResolution;           // Canvas resolution (pixels)
uniform float uGridSize;            // Default: 10.0 (Density of the grid)
uniform float uConnDist;            // Default: 0.15 (Max distance for lines)
uniform float uLineThickness;       // Default: 0.002 (Thickness of connections)
uniform float uPointScale;          // Default: 0.005 (Size of the dots)
uniform vec3 uColor1;               // Default: vec3(0.2, 0.6, 1.0) (Cyan)
uniform vec3 uColor2;               // Default: vec3(1.0, 0.2, 0.5) (Pink/Red)

// --- HELPER FUNCTIONS ---

// A pseudo-random function using only floats (No Integers)
// Returns a random vec2 between 0.0 and 1.0
vec2 N22(vec2 p) {
    vec3 a = fract(vec3(p.xyx) * vec3(123.34, 234.34, 345.65));
    a += dot(a, a.yzx + 34.45);
    return fract(vec2(a.x * a.y, a.y * a.z));
}

// Calculate the shortest distance from point P to line segment AB
float DistLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * t);
}

// Get the moving particle position for a specific grid ID
vec2 GetPoint(vec2 id) {
    vec2 n = N22(id); // Random seed for this cell
    
    // Animate the point using Sine/Cosine based on time and random offset
    // This creates the "organic" movement seen in the Plexus video
    float x = sin(uTime * 1.0 + n.x * 6.2831) * 0.4;
    float y = cos(uTime * 1.0 + n.y * 6.2831) * 0.4;
    
    return vec2(x, y);
}

void main() {
    // 1. Setup UVs
    // Use the vUvScaled from your template, adjusted for aspect ratio if needed
    vec2 uv = vUvScaled;
    // (Optional) Fix aspect ratio if vUvScaled is 0-1
    // uv.x *= uResolution.x / uResolution.y; 

    // 2. Setup Background (using tDiffuse from template)
    vec4 col = texture2D(tDiffuse, vUvScaled);
    // Darken background to make Plexus pop
    col.rgb *= 0.2; 

    // 3. Grid Logic
    // Scale UVs to create the grid cells
    vec2 gv = fract(uv * uGridSize) - 0.5; // Local UV inside the cell (-0.5 to 0.5)
    vec2 id = floor(uv * uGridSize);       // Unique ID for each cell
    
    vec3 plexusColor = vec3(0.0);
    
    // 4. Neighbor Loop (The core "Plexus" logic)
    // We check the 3x3 surrounding grid cells to find neighbors
    // Note: Using floats for loop counters to avoid Integers as requested
    for(float y = -1.0; y <= 1.0; y += 1.0) {
        for(float x = -1.0; x <= 1.0; x += 1.0) {
            
            // Offset for the neighbor cell
            vec2 offs = vec2(x, y);
            
            // Get the unique particle position for that neighbor cell
            // We add the offset to the ID to get the neighbor's ID
            vec2 p = GetPoint(id + offs); 
            
            // Adjust position: The point 'p' is local to its own cell.
            // We need to move it relative to the current pixel's cell (gv).
            // 'offs' moves us to the neighbor cell, 'p' is the point inside it.
            vec2 pos = offs + p; 
            
            // --- DRAW DOTS ---
            // Calculate distance from current pixel (gv) to the particle (pos)
            float d = length(gv - pos);
            // Create a soft glowy dot
            float spark = 1.0 / (d * d * 100.0 * (1.0/uPointScale)); // Inverse square falloff
            plexusColor += spark * uColor1;

            // --- DRAW LINES ---
            // To draw lines, we need to check connections between this neighbor 
            // and the OTHER neighbors.
            
            // We create a nested loop to check distances between points
            for(float j = -1.0; j <= 1.0; j += 1.0) {
                for(float i = -1.0; i <= 1.0; i += 1.0) {
                    vec2 offs2 = vec2(i, j);
                    vec2 p2 = GetPoint(id + offs2);
                    vec2 pos2 = offs2 + p2;
                    
                    // Calculate distance between the two particles
                    float distPoints = length(pos - pos2);
                    
                    // Only draw line if they are close enough (Editable via uConnDist)
                    if(distPoints < uConnDist) {
                        // Calculate distance from PIXEL to the LINE SEGMENT
                        float distToLine = DistLine(gv, pos, pos2);
                        
                        // Draw the line with smooth edges
                        float lineAlpha = smoothstep(uLineThickness, uLineThickness * 0.5, distToLine);
                        
                        // Fade line based on distance between particles (Plexus style)
                        float fade = 1.0 - smoothstep(0.0, uConnDist, distPoints);
                        
                        // Accumulate line color
                        plexusColor += lineAlpha * fade * uColor2 * 0.5;
                    }
                }
            }
        }
    }
    
    // 5. Composite
    // Add the plexus effect on top of the original texture
    col.rgb += plexusColor;
    
    gl_FragColor = col;
}
