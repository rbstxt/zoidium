precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

// Built-in Panzoid Uniforms
uniform vec2 resolution;
uniform float time;

// Custom Sapphire Properties
uniform float Transition_Dir;
uniform float Auto_Trans;
uniform float Wipe_Percent;
uniform float Wipe_Direction;
uniform float Edge_Softness;
uniform float Angle;
uniform float Aspect_Scale;
uniform float Border_Width;
uniform vec3 Border_Color;
uniform float Border_Opacity;
uniform float Border_Softness;
uniform float Border_Shift;

void main() {
    // 1. Center the UV coordinates and fix aspect ratio
    vec2 p = vUv - 0.5;
    p.x *= resolution.x / resolution.y;

    // 2. Apply Aspect Scale (Avoid division by zero)
    float asp = Aspect_Scale;
    if (asp == 0.0) asp = 0.001; 
    p.x /= asp;

    // 3. Apply Angle Rotation
    float rad = radians(Angle);
    float s = sin(rad);
    float c = cos(rad);
    mat2 rot = mat2(c, -s, s, c);
    p = rot * p;

    // 4. Calculate Distance Field for the "X" shape
    float d = min(abs(p.x - p.y), abs(p.x + p.y)) / 1.41421356;

    // 5. Calculate the maximum possible distance to ensure a clean 100% wipe
    float max_d = 0.0;
    for (int i = 0; i <= 2; i++) {
        for (int j = 0; j <= 2; j++) {
            vec2 test_p = vec2(float(i) * 0.5 - 0.5, float(j) * 0.5 - 0.5);
            test_p.x *= resolution.x / resolution.y;
            test_p.x /= asp;
            vec2 rt = rot * test_p;
            float d_test = min(abs(rt.x - rt.y), abs(rt.x + rt.y)) / 1.41421356;
            max_d = max(max_d, d_test);
        }
    }
    max_d += 0.01; // Add slight padding to clear the very corners

    // 6. Handle Timing and Auto Trans
    float t = clamp(Wipe_Percent / 100.0, 0.0, 1.0);
    if (Auto_Trans > 0.5) {
        // Loops a full 0 to 100% transition every 2 seconds for preview purposes
        t = fract(time * 0.5); 
    }

    // 7. Calculate Threshold based on Wedge In vs Wedge Out
    float soft = max(Edge_Softness / 200.0, 0.0001); // Softness moved up to pad thresholds
    
    // Declare the thresholds BEFORE the if statement
    float start_thresh = -soft - 0.002;
    float end_thresh = max_d + soft + 0.002;

    float Thresh;
    if (Wipe_Direction < 0.5) {
        Thresh = mix(end_thresh, start_thresh, t); // Wedge In
    } else {
        Thresh = mix(start_thresh, end_thresh, t); // Wedge Out
    }

    // 8. Determine inversion based on Transition Dir + Wipe Dir combo
    bool flip_shape = ((Transition_Dir < 0.5) == (Wipe_Direction < 0.5));

    float sd; // Signed distance to the transition boundary
    if (flip_shape) {
        sd = Thresh - d;
    } else {
        sd = d - Thresh;
    }

    // 9. Foreground Alpha with Edge Softness
    float fg_alpha = smoothstep(-soft, soft, sd);

    // 10. Border Calculation
    float bw = Border_Width / 200.0;
    float bs = max(Border_Softness / 200.0, 0.0001);
    float shift = Border_Shift / 100.0;

    float bd = abs(sd - shift); // Distance to the actual border line
    float border_alpha = 0.0;
    
    if (Border_Width > 0.0) {
        border_alpha = smoothstep(bw + bs, bw, bd) * Border_Opacity;
    }

    // 11. Composite the Result
    vec4 fg_color = texture2D(tDiffuse, vUvScaled);
    vec4 bg_color = vec4(0.0); // Transparent Background (None)

    // Mix Background with Foreground
    vec4 final_color = mix(bg_color, fg_color, fg_alpha);

    // Overlay the colored border
    if (border_alpha > 0.0) {
        final_color.rgb = mix(final_color.rgb, Border_Color, border_alpha);
        final_color.a = max(final_color.a, border_alpha);
    }

    gl_FragColor = final_color;
}
