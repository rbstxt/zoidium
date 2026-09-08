precision highp float;
precision highp int;

// Inputs
uniform sampler2D tDiffuse; // The "From" input
uniform sampler2D tTo;      // The "To" input
varying vec2 vUvScaled;

// UI Variables
uniform float wipe_percent;     // Range: 0.0 to 1.0
uniform float checkers_mode;    // 0.0 = Shrink, 1.0 = Grow
uniform float edge_softness;    // Default: 0.0 (Now acts as Border Width)
uniform float angle;            // Default: 45.0
uniform float frequency;        // Default: 6.0
uniform float rel_width;        // Default: 1.0
uniform float rel_wid_pre_rot;  // Default: 1.0
uniform vec2  shift;            // Default: [0.0, 0.0]
uniform float grad_add;         // Default: 0.0
uniform float grad_angle;       // Default: 0.0
uniform vec3  trans_color;      // Default: [0.0, 0.0, 0.0]

// Helper: Rotate UV coordinates
vec2 rotate_uv(vec2 uv, float rotation) {
    float rad = radians(rotation);
    float c = cos(rad);
    float s = sin(rad);
    return vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
}

void main() {
    // 1. Prepare Base Coordinates
    vec2 p = vUvScaled - vec2(0.5);

    // 2. Apply Transformations
    p.x /= max(0.0001, rel_wid_pre_rot);
    p = rotate_uv(p, angle);
    p.x /= max(0.0001, rel_width);
    p -= shift;
    p *= frequency;

    // 3. Create Grid/Tile Logic
    vec2 tile_uv = fract(p);
    
    // Distance from center of tile (0.0 center -> 1.0 edge)
    float dist = max(abs(tile_uv.x - 0.5), abs(tile_uv.y - 0.5)) * 2.0;

    // 4. Calculate Thresholds (Timing)
    // Project UV onto gradient vector
    vec2 grad_dir = vec2(cos(radians(grad_angle)), sin(radians(grad_angle)));
    float grad_pos = dot(vUvScaled - vec2(0.5), grad_dir);
    float grad_offset = grad_pos * grad_add;

    // Border width is defined by edge_softness
    float border_width = max(0.0, edge_softness);

    // Calculate spread to ensure the animation clears the screen
    float spread = 1.0 + abs(grad_add) + border_width;
    
    // The "Main Edge" is the outer boundary of the transition
    float main_edge = (wipe_percent * spread) - (abs(grad_add) * 0.5) - grad_offset;
    
    // The "Inner Edge" is the Main Edge minus the border width
    float inner_edge = main_edge - border_width;

    // 5. Calculate Masks
    // Define a small smoothing factor for anti-aliasing (prevents jagged pixels)
    float smoothing = 0.02;

    // Mask 1: The "Hole" in the center (Inside the inner edge)
    // 1.0 if inside the inner hole, 0.0 if outside
    float inner_mask = 1.0 - smoothstep(inner_edge, inner_edge + smoothing, dist);

    // Mask 2: The "Total Shape" (Inside the outer edge)
    // 1.0 if inside the outer edge, 0.0 if outside
    float outer_mask = 1.0 - smoothstep(main_edge, main_edge + smoothing, dist);

    // The Border is the difference between the Total Shape and the Hole
    float border_mask = outer_mask - inner_mask;
    border_mask = clamp(border_mask, 0.0, 1.0);

    // 6. Composition
    vec4 from_col = texture2D(tDiffuse, vUvScaled);
    vec4 to_col = texture2D(tTo, vUvScaled);
    vec4 border_col = vec4(trans_color, 1.0);

    vec4 final_color;

    if (checkers_mode > 0.5) {
        // Grow Mode
        // Center (Inner Mask) = Destination Image (Revealing)
        // Outside (1.0 - Outer Mask) = Source Image (Hiding)
        
        // Start with background (From Image)
        final_color = from_col;
        
        // Mix in the border
        final_color = mix(final_color, border_col, border_mask);
        
        // Mix in the center (To Image) on top
        final_color = mix(final_color, to_col, inner_mask);
        
    } else {
        // Shrink Mode
        // Center (Inner Mask) = Source Image (Shrinking away)
        // Outside (1.0 - Outer Mask) = Destination Image (Revealing background)
        
        // Start with background (To Image)
        final_color = to_col;
        
        // Mix in the border
        final_color = mix(final_color, border_col, border_mask);
        
        // Mix in the center (From Image) on top
        final_color = mix(final_color, from_col, inner_mask);
    }

    gl_FragColor = final_color;
}
