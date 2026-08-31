precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform vec2 uvScale;

// ==========================================
// 26 CUSTOM PARAMETER UNIFORMS
// ==========================================

// - Cloud Design
uniform float Cloud_Length;
uniform float Cloud_Scale;
uniform float Slant;
uniform float Vertical_Alignment;
uniform float End_Roundy;
uniform float Spacing;
uniform float Random_Seed;

// - Cloud Top Control
uniform float Top_Contrast;
uniform float Top_Variation;
uniform float Top_Correlation;
uniform float Taper_Left_Top;
uniform float Taper_Right_Top;

// - Cloud Bottom Control
uniform float Bottom_Scale;
uniform float Bottom_Contrast;
uniform float Bottom_Variation;
uniform float Bottom_Correlation;
uniform float Taper_Left_Bottom;
uniform float Taper_Right_Bottom;

// - Animation
uniform float Evolution;
uniform float Top_Evolution_Scale;
uniform float Reverse_Top_Direction;    // 0.0 for Disabled, 1.0 for Enabled
uniform float Bottom_Evolution_Scale;
uniform float Reverse_Bottom_Direction; // 0.0 for Disabled, 1.0 for Enabled

// - Secondary Animation
uniform float Secondary_Animation_Amount;
uniform float Secondary_Evolution;
uniform float Secondary_Evolution_Scale;

// ==========================================
// PROCEDURAL MATH & NOISE GENERATION
// ==========================================

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Single-octave noise with Quintic interpolation for perfectly round, smooth shapes
float smooth_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    
    // Quintic polynomial for ultra-smooth circular easing
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}

// ==========================================
// MAIN RENDER PASS
// ==========================================
void main()
{
    vec2 p = vUv - vec2(0.5);
    float aspect = resolution.x / resolution.y;
    p.x *= aspect;
    
    // Base Transformations
    p.x -= p.y * (Slant * 0.01);
    p.y -= Vertical_Alignment * 0.005;
    
    float L = (Cloud_Length / 100.0) * 0.5 * aspect;
    
    // Bounds Check Optimization
    if (p.x < -L || p.x > L) {
        gl_FragColor = texture2D(tDiffuse, vUvScaled);
        return;
    }
    
    // ------------------------------------------
    // EVOLUTION TIME MAPPING
    // ------------------------------------------
    float ev_cycles = Evolution / 360.0;
    float top_dir = (Reverse_Top_Direction > 0.5) ? -1.0 : 1.0;
    float bot_dir = (Reverse_Bottom_Direction > 0.5) ? -1.0 : 1.0;
    
    float top_roll = ev_cycles * Top_Evolution_Scale * top_dir * 6.0;
    float bot_roll = ev_cycles * Bottom_Evolution_Scale * bot_dir * 6.0;
    
    float sec_cycles = Secondary_Evolution / 360.0;
    float sec_morph = sec_cycles * Secondary_Evolution_Scale * 3.0;

    float cloud_thickness = (Cloud_Scale / 100.0) * 0.12;

    // ------------------------------------------
    // TOP EDGE PROFILE (Smooth Bubbly Circles)
    // ------------------------------------------
    float freq_top = 2.5 / (max(0.1, Top_Correlation) * 0.09);
    vec2 eval_pos_top = vec2(p.x * freq_top - top_roll + Random_Seed, sec_morph);
    
    // Use single-octave smooth noise to keep the shapes round and unified
    float n_top = smooth_noise(eval_pos_top) * 2.0 - 1.0;
    
    float contrast_top = Top_Contrast / 100.0;
    if (contrast_top > 0.0) {
        float p_pow = 1.0 + contrast_top * 4.0;
        n_top = sign(n_top) * pow(abs(n_top), 1.0 / p_pow);
    }
    
    // Using absolute value creates perfect, smooth rounded peaks and sharp crevices
    float hump_top = max(0.0, abs(n_top) - (Spacing / 100.0) * 0.4);
    float height_top = cloud_thickness * (1.0 + (Top_Variation / 100.0) * hump_top);

    // ------------------------------------------
    // BOTTOM EDGE PROFILE (Smooth Bubbly Circles)
    // ------------------------------------------
    float freq_bot = 2.5 / (max(0.1, Bottom_Correlation) * 0.09);
    vec2 eval_pos_bot = vec2(p.x * freq_bot - bot_roll + Random_Seed * 3.14, sec_morph);
    
    float n_bot = smooth_noise(eval_pos_bot) * 2.0 - 1.0;
    
    float contrast_bot = Bottom_Contrast / 100.0;
    if (contrast_bot > 0.0) {
        float p_pow_b = 1.0 + contrast_bot * 4.0;
        n_bot = sign(n_bot) * pow(abs(n_bot), 1.0 / p_pow_b);
    }
    float hump_bot = max(0.0, abs(n_bot) - (Spacing / 100.0) * 0.4);
    
    float base_bot_height = cloud_thickness * (Bottom_Scale / 100.0);
    float height_bottom = base_bot_height * (1.0 + (Bottom_Variation / 100.0) * hump_bot);

    // ------------------------------------------
    // SECONDARY EVOLUTION OVERLAYS
    // ------------------------------------------
    if (Secondary_Animation_Amount > 0.0) {
        float sec_amt = Secondary_Animation_Amount / 100.0;
        
        float n_sec_top = smooth_noise(vec2(p.x * freq_top * 1.5 - top_roll * 1.2, sec_morph + 10.0)) * 2.0 - 1.0;
        height_top += cloud_thickness * sec_amt * abs(n_sec_top) * 0.4;
        
        if (Bottom_Scale > 0.0) {
            float n_sec_bot = smooth_noise(vec2(p.x * freq_bot * 1.5 - bot_roll * 1.2, sec_morph + 10.0)) * 2.0 - 1.0;
            height_bottom += base_bot_height * sec_amt * abs(n_sec_bot) * 0.4;
        }
    }

    // ------------------------------------------
    // EDGE TAPERING
    // ------------------------------------------
    float t_l_t = clamp((p.x + L) / (L * max(0.01, Taper_Left_Top / 100.0)), 0.0, 1.0);
    float t_r_t = clamp((L - p.x) / (L * max(0.01, Taper_Right_Top / 100.0)), 0.0, 1.0);
    height_top *= pow(min(t_l_t, t_r_t), 1.0 / max(0.1, End_Roundy));
    
    float t_l_b = clamp((p.x + L) / (L * max(0.01, Taper_Left_Bottom / 100.0)), 0.0, 1.0);
    float t_r_b = clamp((L - p.x) / (L * max(0.01, Taper_Right_Bottom / 100.0)), 0.0, 1.0);
    height_bottom *= pow(min(t_l_b, t_r_b), 1.0 / max(0.1, End_Roundy));

    // ------------------------------------------
    // RENDER OUTPUT
    // ------------------------------------------
    float pixel_size = 1.5 / resolution.y;
    float mask_top = smoothstep(height_top + pixel_size, height_top - pixel_size, p.y);
    float mask_bottom = smoothstep(-height_bottom - pixel_size, -height_bottom + pixel_size, p.y);
    float cloud_mask = mask_top * mask_bottom;
    
    vec4 background = texture2D(tDiffuse, vUvScaled);
    vec4 cloud_color = vec4(1.0, 1.0, 1.0, 1.0); 
    
    gl_FragColor = mix(background, cloud_color, cloud_mask);
}
