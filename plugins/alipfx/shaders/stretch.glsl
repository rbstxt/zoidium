precision highp float;
precision highp int;

// Built-in Panzoid Uniforms & Varyings
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUv;

// Custom Properties
uniform vec2 Anchor_Point;
uniform float Angle;
uniform float Shift_Amount;
uniform float Direction;

void main()
{
    // 1. Convert current UV to exact pixel coordinates
    vec2 p = vUv * resolution;

    // 2. Match After Effects Coordinate System
    // AE's origin (0,0) is Top-Left. Panzoid's origin is Bottom-Left.
    // We invert the Y coordinate of the Anchor Point to make your values 1:1 with AE.
    vec2 anchor = vec2(Anchor_Point.x, resolution.y - Anchor_Point.y);

    // 3. Calculate Angle Direction
    // In AE, 0 degrees stretches vertically, 90 degrees stretches horizontally.
    float rad = radians(Angle);
    vec2 dir = vec2(sin(rad), cos(rad)); // Clockwise rotation matching AE

    // 4. Calculate Distance from Anchor Line
    vec2 diff = p - anchor;
    float dist = dot(diff, dir); // Distance of current pixel along the stretch direction

    // 5. Apply Shift Cap (10000)
    float S = clamp(abs(Shift_Amount), 0.0, 10000.0);

    // 6. Shift Logic based on Direction parameter
    float dist_src = dist;

    if (Direction < 0.5) {
        // Mode 0: Both
        if (dist > S) {
            dist_src = dist - S;
        } else if (dist < -S) {
            dist_src = dist + S;
        } else {
            // Smeared pixel line in the center
            dist_src = 0.0;
        }
    } else if (Direction < 1.5) {
        // Mode 1: Forward
        if (dist > S) {
            dist_src = dist - S;
        } else if (dist > 0.0) {
            // Smeared forward gap
            dist_src = 0.0; 
        } else {
            // Backward half stays completely still
            dist_src = dist;
        }
    } else {
        // Mode 2: Backward
        if (dist < -S) {
            dist_src = dist + S;
        } else if (dist < 0.0) {
            // Smeared backward gap
            dist_src = 0.0;
        } else {
            // Forward half stays completely still
            dist_src = dist;
        }
    }

    // 7. Reconstruct the target pixel location
    // We displace the pixel backward along the direction vector to find the source pixel
    vec2 p_src = p + dir * (dist_src - dist);

    // 8. Convert back to UV space and render
    vec2 uv_src = p_src / resolution;
    
    // Crucial Panzoid rule: multiply by uvScale for correct buffer mapping
    vec4 texel = texture2D(tDiffuse, uv_src * uvScale);

    gl_FragColor = texel;
}
