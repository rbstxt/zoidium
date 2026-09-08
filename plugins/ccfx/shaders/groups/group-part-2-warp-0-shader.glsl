precision highp float;
// Avoiding integer precision as requested
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- UNIFORMS ---
// bend: Intensity of the warp (-100 to 100 in AE, mapped here roughly -1.0 to 1.0)
uniform float bend; 

// h_dist / v_dist: Horizontal and Vertical Distortion (-1.0 to 1.0)
uniform float h_dist; 
uniform float v_dist; 

// warp_axis: 0.0 = Horizontal, 1.0 = Vertical
uniform float warp_axis; 

// warp_style: Selects the math profile
// 0.0 = Arc
// 1.0 = Arc Lower
// 2.0 = Arc Upper
// 3.0 = Arch
// 4.0 = Bulge
// 5.0 = Shell Lower
// 6.0 = Shell Upper
// 7.0 = Flag
// 8.0 = Wave
// 9.0 = Fish
// 10.0 = Rise
// 11.0 = FishEye
// 12.0 = Inflate
// 13.0 = Twist
// 14.0 = Squeeze
uniform float warp_style;

// --- CONSTANTS ---
const float PI = 3.14159265359;

// Helper to rotate coordinates 90 degrees for Vertical Axis handling
vec2 rotate_coords(vec2 coord, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
}

void main()
{
    // 1. Convert UV [0.0, 1.0] to Signed Normalized Coordinates [-1.0, 1.0]
    // This places (0,0) in the center of the image, making math easier.
    vec2 coord = vUvScaled * 2.0 - 1.0;

    // 2. Apply Horizontal and Vertical Distortion (Perspective/Keystoning)
    // This happens independently of the warp style in the chain.
    // H Distortion: Skews X based on Y. V Distortion: Skews Y based on X.
    
    // Apply Vertical Distortion (Pinches top/bottom)
    float v_scale = 1.0 - (v_dist * coord.y);
    // Avoid division by zero
    if (abs(v_scale) < 0.001) v_scale = 0.001;
    coord.x /= v_scale;

    // Apply Horizontal Distortion (Pinches left/right)
    float h_scale = 1.0 - (h_dist * coord.x);
    if (abs(h_scale) < 0.001) h_scale = 0.001;
    coord.y /= h_scale;

    // 3. Handle Warp Axis
    // If Vertical (1.0), we rotate the coordinate system 90 degrees 
    // so we can use the same math formulas, then rotate back later.
    bool is_vertical = (warp_axis > 0.5);
    if (is_vertical) {
        coord = vec2(coord.y, coord.x);
    }

    // 4. Apply Warp Styles
    // We modify 'coord' based on the selected style index.
    
    vec2 warped = coord;
    float dist = length(coord); // Distance from center
    float influence_y = (coord.y + 1.0) * 0.5; // 0.0 at bottom, 1.0 at top
    float influence_x = (coord.x + 1.0) * 0.5; // 0.0 at left, 1.0 at right

    // STYLE: Arc (0.0)
    // Bends the grid into a curve.
    if (warp_style < 0.5) {
        // Offset Y based on Cosine of X to create a curve
        warped.y = coord.y + (bend * (cos(coord.x) - 1.0));
    }
    // STYLE: Arc Lower (1.0)
    // Bends the bottom edge, pins the top edge.
    else if (warp_style < 1.5) {
        // Influence is inverted Y (stronger at bottom -1.0)
        float factor = 1.0 - influence_y; 
        warped.y = coord.y + (bend * factor * (cos(coord.x) - 1.0));
    }
    // STYLE: Arc Upper (2.0)
    // Bends the top edge, pins the bottom edge.
    else if (warp_style < 2.5) {
        float factor = influence_y; 
        warped.y = coord.y + (bend * factor * (cos(coord.x) - 1.0));
    }
    // STYLE: Arch (3.0)
    // Vertical arching. 
    else if (warp_style < 3.5) {
        warped.y = coord.y + (bend * abs(coord.y) * (cos(coord.x) - 1.0));
    }
    // STYLE: Bulge (4.0)
    // Pushes center out.
    else if (warp_style < 4.5) {
        // Power function creates a smoother bulge falloff
        warped = coord * (1.0 - bend * (1.0 - dist));
    }
    // STYLE: Shell Lower (5.0)
    // Widens/Shrinks the bottom width.
    else if (warp_style < 5.5) {
        float width_factor = 1.0 + (bend * (1.0 - influence_y));
        warped.x = coord.x * width_factor;
        // Adjust Y slightly to maintain area curve
        warped.y = coord.y + (bend * 0.2 * (coord.x * coord.x)); 
    }
    // STYLE: Shell Upper (6.0)
    // Widens/Shrinks the top width.
    else if (warp_style < 6.5) {
        float width_factor = 1.0 + (bend * influence_y);
        warped.x = coord.x * width_factor;
        warped.y = coord.y - (bend * 0.2 * (coord.x * coord.x));
    }
    // STYLE: Flag (7.0)
    // Sine wave distortion.
    else if (warp_style < 7.5) {
        warped.y = coord.y + sin(coord.x * 3.0) * bend;
        // Flag usually compresses X slightly
        warped.x = coord.x; 
    }
    // STYLE: Wave (8.0)
    // Similar to flag but pins edges.
    else if (warp_style < 8.5) {
        // Window the sine wave with a parabola so edges are 0
        float window = 1.0 - coord.x * coord.x;
        warped.y = coord.y + sin(coord.x * 5.0) * bend * window;
    }
    // STYLE: Fish (9.0)
    // Expands one side, shrinks the other (Left/Right).
    else if (warp_style < 9.5) {
        float scale = 1.0 + bend * coord.x;
        warped.y = coord.y * scale;
        warped.x = coord.x * (1.0 + bend * 0.5 * abs(coord.y));
    }
    // STYLE: Rise (10.0)
    // Pins one side, lifts the other.
    else if (warp_style < 10.5) {
        warped.y = coord.y + (bend * influence_x);
    }
    // STYLE: FishEye (11.0)
    // Pure radial distortion, more aggressive than bulge.
    else if (warp_style < 11.5) {
        float f = 1.0 + bend * dist * dist;
        warped = coord * f;
    }
    // STYLE: Inflate (12.0)
    // Simulates a balloon.
    else if (warp_style < 12.5) {
        // Sine curve bump in the center
        float z = sqrt(1.0 - clamp(dist * dist, 0.0, 1.0));
        float factor = 1.0 + bend * z; 
        warped = coord / factor; 
    }
    // STYLE: Twist (13.0)
    // Rotates the UVs based on radius.
    else if (warp_style < 13.5) {
        float angle = bend * (1.0 - dist) * 2.0; 
        float s = sin(angle);
        float c = cos(angle);
        warped = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
    }
    // STYLE: Squeeze (14.0)
    // Pinches the middle horizontally or vertically.
    else {
        // Scale X based on Y position (hourglass shape)
        float squeeze_factor = 1.0 + bend * (1.0 - coord.y * coord.y);
        warped.x = coord.x / squeeze_factor;
        // Compensate Y to preserve area logic
        warped.y = coord.y * (1.0 + bend * 0.2); 
    }

    // 5. Restore Axis
    // If we swapped axes earlier, we must swap back now.
    if (is_vertical) {
        warped = vec2(warped.y, warped.x);
    }

    // 6. Convert back to Texture Space [0.0, 1.0]
    vec2 final_uv = warped * 0.5 + 0.5;

    // 7. Bounds check
    // If the distortion pulls pixels from outside the image, return transparent
    if (final_uv.x < 0.0 || final_uv.x > 1.0 || final_uv.y < 0.0 || final_uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
        vec4 texel = texture2D(tDiffuse, final_uv);
        gl_FragColor = texel;
    }
}
