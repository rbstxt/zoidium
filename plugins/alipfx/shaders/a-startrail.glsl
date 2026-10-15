precision highp float;
precision highp int;

// Built-in Panzoid Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform float time;

// --- Custom Parameters ---
uniform float Star_Type;        // 0 for Circular, 1 for Line
uniform float Star_Density;     // Number of lanes/rings
uniform float Trail_Size;       // Thickness of the tails
uniform float Star_Size;        // Radius of the leading stars
uniform float Trail_Length;     // Length of trails
uniform float Star_Points;      // 0 for circle, 3+ for star shapes

uniform vec3 Color_1;
uniform vec3 Color_2;
uniform vec3 Color_3;
uniform vec3 Color_4;
uniform vec3 Color_5;
uniform vec3 Color_6;
uniform vec3 Color_7;
uniform vec3 Color_8;
uniform float Gradient_Colors;  // Number of colors to blend in gradient
uniform float Color_Seed;       // Randomizer for colors

// New Head Color Parameters
uniform float Separate_Star_Color; // 1.0 to use independent star colors, 0.0 to match trail
uniform vec3 Star_Color_1;
uniform vec3 Star_Color_2;
uniform vec3 Star_Color_3;
uniform vec3 Star_Color_4;
uniform vec3 Star_Color_5;
uniform vec3 Star_Color_6;
uniform vec3 Star_Color_7;
uniform vec3 Star_Color_8;

// --- 3D & Transform Parameters ---
uniform float Render_Space;     // 0.0 for 2D, 1.0 for 3D
uniform float Position_Z;       // Depth in 3D space
uniform float Rotate_X;         // Pitch (Tilt forward/back)
uniform float Rotate_Y;         // Yaw (Swivel left/right)

uniform vec2 Position;          // Center coordinates
uniform vec2 Scale;             // X and Y scaling
uniform float Rotate;           // Angle in degrees (2D Z-Rotation)
uniform float Radius_In;        // Inner bound for circular mode
uniform float Radius_Out;       // Outer bound for circular mode
uniform float Speed;            // Base rotation/movement speed

uniform float Speed_Random;     // Speed variation
uniform float Size_Random;      // Thickness variation
uniform float Random_Seed;      // General seed for placement
uniform float Glow_Intensity;   // Brightness of the glow
uniform float Glow_Radius;      // Softness spread
uniform float Optic_Distortion; // Lens curving
uniform float Star_Seed;        // Additional seed modifier

// --- Helper Functions ---

float hash12(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Trail Gradient
vec3 getGradient(float t) {
    int maxColors = int(clamp(Gradient_Colors, 1.0, 8.0));
    if (maxColors <= 1) return Color_1;
    
    float safe_t = clamp(t, 0.0, 0.9999);
    float ft = safe_t * float(maxColors - 1);
    int idx = int(ft);
    float f = fract(ft);
    
    if (idx == 0) return mix(Color_1, Color_2, f);
    else if (idx == 1) return mix(Color_2, Color_3, f);
    else if (idx == 2) return mix(Color_3, Color_4, f);
    else if (idx == 3) return mix(Color_4, Color_5, f);
    else if (idx == 4) return mix(Color_5, Color_6, f);
    else if (idx == 5) return mix(Color_6, Color_7, f);
    else return mix(Color_7, Color_8, f);
}

// Independent Star Head Gradient
vec3 getStarGradient(float t) {
    int maxColors = int(clamp(Gradient_Colors, 1.0, 8.0));
    if (maxColors <= 1) return Star_Color_1;
    
    float safe_t = clamp(t, 0.0, 0.9999);
    float ft = safe_t * float(maxColors - 1);
    int idx = int(ft);
    float f = fract(ft);
    
    if (idx == 0) return mix(Star_Color_1, Star_Color_2, f);
    else if (idx == 1) return mix(Star_Color_2, Star_Color_3, f);
    else if (idx == 2) return mix(Star_Color_3, Star_Color_4, f);
    else if (idx == 3) return mix(Star_Color_4, Star_Color_5, f);
    else if (idx == 4) return mix(Star_Color_5, Star_Color_6, f);
    else if (idx == 5) return mix(Star_Color_6, Star_Color_7, f);
    else return mix(Star_Color_7, Star_Color_8, f);
}

void main() {
    vec2 px = vUv * resolution;
    vec2 uv = px - Position;
    
    vec2 eff_scale = Scale;
    if (abs(eff_scale.x) < 0.001) eff_scale.x = 1.0;
    if (abs(eff_scale.y) < 0.001) eff_scale.y = 1.0;
    uv /= eff_scale;
    
    // 2D Rotation (Z-Axis)
    float rad = Rotate * 3.14159265 / 180.0;
    float c = cos(rad);
    float s = sin(rad);
    uv = mat2(c, -s, s, c) * uv;
    
    // --- 3D Projection Logic ---
    if (Render_Space > 0.5) {
        float fov = max(resolution.x, resolution.y);
        float radX = Rotate_X * 3.14159265 / 180.0;
        float radY = -Rotate_Y * 3.14159265 / 180.0;

        float cx = cos(radX), sx = sin(radX);
        float cy = cos(radY), sy = sin(radY);

        // Plane basis (columns of R = Ry * Rx), R maps plane space -> view space
        vec3 bx = vec3( cy, 0.0, -sy);
        vec3 by = vec3( sy * sx,  cx, cy * sx);
        vec3 n  = vec3( sy * cx, -sx, cy * cx); // plane normal

        // Plane sits at distance d along the view axis
        float d = fov + Position_Z;
        if (d < 1.0) d = 1.0;

        // View ray through this pixel
        vec3 ray = vec3(uv, fov);

        float denom = dot(n, ray);
        if (abs(denom) < 1e-4) discard;          // plane edge-on
        float t = (n.z * d) / denom;
        if (t <= 0.0) discard;                   // behind the camera

        vec3 hit = ray * t - vec3(0.0, 0.0, d);

        // Plane's own axes. Scale is inherently d/fov, so z=0 (d==fov) matches 2D.
        uv = vec2(dot(hit, bx), dot(hit, by));
    }
    // ---------------------------
    
    float dist_norm = length(uv) / max(min(resolution.x, resolution.y), 1.0);
    uv *= 1.0 + Optic_Distortion * dist_norm * dist_norm;
    
    bool is_line = Star_Type > 0.5;
    vec3 col = vec3(0.0);
    
    float l_coord, a_coord, density_scale, lane_offset;
    
    if (is_line) {
        l_coord = uv.y;
        a_coord = uv.x;
        density_scale = max(1.0, Star_Density) / resolution.y;
        lane_offset = 0.0;
    } else {
        l_coord = length(uv);
        a_coord = atan(uv.y, uv.x);
        density_scale = max(1.0, Star_Density) / max(1.0, Radius_Out - Radius_In);
        lane_offset = Radius_In;
    }
    
    float l_float = (l_coord - lane_offset) * density_scale;
    float current_lane = floor(l_float);
    float global_speed = Speed;
    
    for (int i = -1; i <= 1; i++) {
        float lid = current_lane + float(i);
        
        if (!is_line) {
            float r_center = lane_offset + (lid + 0.5) / density_scale;
            if (r_center < Radius_In || r_center > Radius_Out) continue;
        }
        
        float h1 = hash12(vec2(lid, Random_Seed + 1.0));
        float h2 = hash12(vec2(lid, Random_Seed + 2.0));
        float h3 = hash12(vec2(lid, Random_Seed + 3.0));
        float h4 = hash12(vec2(lid, Random_Seed + 4.0));
        
        float lane_center_pixel = lane_offset + (lid + 0.5 + (h1 - 0.5) * 0.8) / density_scale;
        
        float raw_dist_l = l_coord - lane_center_pixel; 
        float dist_l = abs(raw_dist_l);
        
        float t_size = Trail_Size * (1.0 + Size_Random * (h2 - 0.5));
        float s_size = Star_Size * (1.0 + Size_Random * (h2 - 0.5));
        float max_sz = max(t_size, s_size);
        
        if (dist_l < max_sz + Glow_Radius) {
            float adjusted_speed = global_speed;
            if (!is_line) {
                adjusted_speed = global_speed / max(1.0, lane_center_pixel);
            }
            
            float star_speed = adjusted_speed * (1.0 + Speed_Random * (h3 - 0.5));
            float dir = sign(star_speed);
            if (dir == 0.0) dir = 1.0;
            
            if (is_line) {
                float cellSize = max(Trail_Length * 2.0, 300.0);
                float moving_coord = a_coord - time * star_speed;
                float current_cell = floor(moving_coord / cellSize);
                
                for (int j = -1; j <= 1; j++) {
                    float cid = current_cell + float(j);
                    float h_seg = hash12(vec2(lid, cid + Random_Seed * 11.51));
                    float h_len = hash12(vec2(cid, lid + 7.83));
                    
                    float trail_head = (cid + h_seg) * cellSize + time * star_speed;
                    float a_dist = (trail_head - a_coord) * dir;
                    float mixed_length = Trail_Length * (0.4 + 0.6 * h_len);
                    
                    if (a_dist > -(s_size + Glow_Radius) && a_dist < mixed_length && mixed_length > 0.0) {
                        float head_dist = length(vec2(raw_dist_l, a_dist));
                        float effective_dist = head_dist;
                        
                        // --- Sharp Star Shape Logic ---
                        if (Star_Points >= 2.5) {
                            float n = floor(Star_Points + 0.5);
                            float angle = atan(a_dist, raw_dist_l);
                            angle -= 1.5707963 * dir; // Face forward
                            // Triangle wave for sharp points instead of smooth cosine
                            float phase = abs(fract(angle * n / 6.2831853) * 2.0 - 1.0);
                            float star_mod = 0.3 + 0.7 * (1.0 - phase); 
                            effective_dist = head_dist / star_mod;
                        }
                        
                        float intensity = (a_dist >= 0.0) ? pow(clamp(1.0 - (a_dist / mixed_length), 0.0, 1.0), 1.5) : 0.0;
                        
                        float t_core = 1.0 - smoothstep(max(0.0, t_size - 1.5), max(0.001, t_size), dist_l);
                        float t_glow = (1.0 - smoothstep(max(0.001, t_size), max(0.002, t_size + Glow_Radius), dist_l)) * Glow_Intensity;
                        float t_val = (t_core + t_glow) * intensity;
                        
                        float s_core = 1.0 - smoothstep(max(0.0, s_size - 1.5), max(0.001, s_size), effective_dist);
                        float s_glow = (1.0 - smoothstep(max(0.001, s_size), max(0.002, s_size + Glow_Radius), effective_dist)) * Glow_Intensity;
                        float s_val = s_core + s_glow;
                        
                        float c_hash = hash12(vec2(lid, cid + Color_Seed + Star_Seed));
                        vec3 t_col = getGradient(c_hash);
                        vec3 s_col = mix(t_col, getStarGradient(c_hash), clamp(Separate_Star_Color, 0.0, 1.0));
                        
                        col += t_col * t_val + s_col * s_val;
                    }
                }
            } else {
                float phase = h4 * 1000.0 + time * star_speed;
                float diff_ang = (phase - a_coord) * dir;
                
                float wrapped_ang = mod(diff_ang + 3.14159, 6.2831853) - 3.14159;
                float a_dist = wrapped_ang * lane_center_pixel;
                
                if (a_dist > -(s_size + Glow_Radius) && a_dist < Trail_Length && Trail_Length > 0.0) {
                    float head_dist = length(vec2(raw_dist_l, a_dist));
                    float effective_dist = head_dist;
                    
                    // --- Sharp Star Shape Logic ---
                    if (Star_Points >= 2.5) {
                        float n = floor(Star_Points + 0.5);
                        float angle = atan(a_dist, raw_dist_l);
                        angle -= 1.5707963 * dir; // Face forward
                        // Triangle wave for sharp points
                        float phase_angle = abs(fract(angle * n / 6.2831853) * 2.0 - 1.0);
                        float star_mod = 0.3 + 0.7 * (1.0 - phase_angle); 
                        effective_dist = head_dist / star_mod;
                    }
                    
                    float intensity = (a_dist >= 0.0) ? pow(clamp(1.0 - (a_dist / Trail_Length), 0.0, 1.0), 1.5) : 0.0;
                    
                    float t_core = 1.0 - smoothstep(max(0.0, t_size - 1.5), max(0.001, t_size), dist_l);
                    float t_glow = (1.0 - smoothstep(max(0.001, t_size), max(0.002, t_size + Glow_Radius), dist_l)) * Glow_Intensity;
                    float t_val = (t_core + t_glow) * intensity;
                    
                    float s_core = 1.0 - smoothstep(max(0.0, s_size - 1.5), max(0.001, s_size), effective_dist);
                    float s_glow = (1.0 - smoothstep(max(0.001, s_size), max(0.002, s_size + Glow_Radius), effective_dist)) * Glow_Intensity;
                    float s_val = s_core + s_glow;
                    
                    float c_hash = hash12(vec2(lid, Color_Seed + Star_Seed));
                    vec3 t_col = getGradient(c_hash);
                    vec3 s_col = mix(t_col, getStarGradient(c_hash), clamp(Separate_Star_Color, 0.0, 1.0));
                    
                    col += t_col * t_val + s_col * s_val;
                }
            }
        }
    }
    
    vec4 bg = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = vec4(bg.rgb + col, bg.a);
}
