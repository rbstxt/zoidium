precision highp float;
precision highp int;

// Panzoid Built-ins
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform float time;

// Custom Effect Properties
uniform float Transition_Dir;
uniform float Auto_Trans;
uniform float Wipe_Percent;
uniform float Wipe_Direction;
uniform float Edge_Softness;
uniform float Angle;
uniform float Pointiness;
uniform float Border_Width;
uniform vec3 Border_Color;
uniform float Border_Opacity;
uniform float Border_Softness;
uniform float Border_Shift;

void main() {
    // 1. Fetch current layer and define transparent background
    vec4 texColor = texture2D(tDiffuse, vUvScaled);
    vec4 bgColor = vec4(0.0); // Transparent/None as requested

    // 2. Setup Time/Progress
    float progress;
    if (Auto_Trans == 1.0) {
        // Changed from fract to clamp so it plays once and stops at 1.0
        // time * 0.5 means it takes 2 seconds to complete.
        progress = clamp(time * 0.5, 0.0, 1.0); 
    } else {
        progress = clamp(Wipe_Percent / 100.0, 0.0, 1.0);
    }

    // 3. Setup Aspect-Corrected Coordinates (centered at 0,0)
    float aspect = resolution.x / max(resolution.y, 1.0);
    vec2 p = vUv - 0.5;
    p.x *= aspect;

    // 4. Handle Rotation (Counter-Clockwise)
    float rad = -Angle * 3.14159265359 / 180.0;
    float c = cos(rad);
    float s = sin(rad);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

    // 5. Compute the Double Wedge Distance Field
    float pt = max(Pointiness, 0.001); // Avoid division by zero
    // INVERTED FIX: Multiply by pt instead of dividing. 
    // This makes higher values carve out sharper wedges.
    float F = abs(rp.x) - abs(rp.y) * pt;

    // 6. Calculate Screen Boundaries to ensure the wipe perfectly reaches the corners
    // We unroll the corner evaluations for WebGL 1.0 compatibility
    float maxF = -999.0;
    float minF = 999.0;
    vec2 tp, rtp; float tF;

    // Top Right
    tp = vec2(0.5 * aspect, 0.5); rtp = vec2(tp.x * c - tp.y * s, tp.x * s + tp.y * c); tF = abs(rtp.x) - abs(rtp.y) * pt; maxF = max(maxF, tF); minF = min(minF, tF);
    // Bottom Right
    tp = vec2(0.5 * aspect, -0.5); rtp = vec2(tp.x * c - tp.y * s, tp.x * s + tp.y * c); tF = abs(rtp.x) - abs(rtp.y) * pt; maxF = max(maxF, tF); minF = min(minF, tF);
    // Top Left
    tp = vec2(-0.5 * aspect, 0.5); rtp = vec2(tp.x * c - tp.y * s, tp.x * s + tp.y * c); tF = abs(rtp.x) - abs(rtp.y) * pt; maxF = max(maxF, tF); minF = min(minF, tF);
    // Bottom Left
    tp = vec2(-0.5 * aspect, -0.5); rtp = vec2(tp.x * c - tp.y * s, tp.x * s + tp.y * c); tF = abs(rtp.x) - abs(rtp.y) * pt; maxF = max(maxF, tF); minF = min(minF, tF);
    // Right Mid
    tp = vec2(0.5 * aspect, 0.0); rtp = vec2(tp.x * c - tp.y * s, tp.x * s + tp.y * c); tF = abs(rtp.x) - abs(rtp.y) * pt; maxF = max(maxF, tF); minF = min(minF, tF);
    // Top Mid
    tp = vec2(0.0, 0.5); rtp = vec2(tp.x * c - tp.y * s, tp.x * s + tp.y * c); tF = abs(rtp.x) - abs(rtp.y) * pt; maxF = max(maxF, tF); minF = min(minF, tF);

    // 7. Calculate the Transition Threshold 'd'
    // At exactly 50% (progress = 0.5), d is 0.0, forming a perfect X in the center.
    float d;
    if (Wipe_Direction == 0.0) { // Wedge In
        if (progress < 0.5) d = mix(maxF, 0.0, progress * 2.0);
        else d = mix(0.0, minF, (progress - 0.5) * 2.0);
    } else { // Wedge Out
        if (progress < 0.5) d = mix(minF, 0.0, progress * 2.0);
        else d = mix(0.0, maxF, (progress - 0.5) * 2.0);
    }

    // 8. Calculate Signed Distance
    float signed_dist = (Wipe_Direction == 0.0) ? (F - d) : (d - F);
    
    // Normalize distance by gradient magnitude to keep uniform thickness/softness
    // INVERTED FIX: Adjusted gradient magnitude math to match the new multiplier
    float grad_mag = sqrt(1.0 + (pt * pt));
    float true_dist = signed_dist / grad_mag;

    // 9. Edge Blending / Softness
    float e_soft = max(Edge_Softness * 0.001, 0.001); // Scaled for UV space
    float mixFactor = smoothstep(-e_soft, e_soft, true_dist);

    // Assign Outgoing/Incoming layers based on Transition Dir
    vec4 colOutgoing = (Transition_Dir == 0.0) ? texColor : bgColor;
    vec4 colIncoming = (Transition_Dir == 0.0) ? bgColor : texColor;
    vec4 baseColor = mix(colOutgoing, colIncoming, mixFactor);

    // 10. Border Calculations
    float border_dist = true_dist + (Border_Shift * 0.001); 
    float bw = Border_Width * 0.001; 
    float b_soft = max(Border_Softness * 0.001, 0.0001);

    float dist_from_center = abs(border_dist);
    float half_width = bw / 2.0;
    
    float border_alpha = 0.0;
    if (Border_Width > 0.0) {
        border_alpha = smoothstep(half_width + b_soft, half_width - b_soft, dist_from_center);
        border_alpha *= Border_Opacity;
    }

    // 11. Final Composite (Alpha Blending over the transition)
    vec4 finalColor;
    finalColor.rgb = mix(baseColor.rgb, Border_Color, border_alpha);
    finalColor.a = baseColor.a + border_alpha * (1.0 - baseColor.a);

    gl_FragColor = finalColor;
}
