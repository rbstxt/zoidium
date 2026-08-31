precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// AE-like properties
uniform vec2 Start_of_Ramp;       // Default: vec2(0.5, 0.5)
uniform vec3 Start_Color;         // Default: vec3(1.0, 1.0, 1.0) (white)
uniform vec2 End_of_Ramp;         // Default: vec2(0.5, 1.0)
uniform vec3 End_Color;           // Default: vec3(0.0, 0.0, 0.0) (black)
uniform int Ramp_Shape;           // 0 = Linear, 1 = Radial
uniform float Ramp_Scatter;       // Default: 0.0
uniform float Blend_With_Original;// Default: 0.0 (gradient fully visible)
uniform int Swap_Colors;          // 0 = No, 1 = Yes

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec4 original = texture2D(tDiffuse, vUvScaled);

    // Swap colors if enabled
    vec3 colorA = (Swap_Colors == 1) ? End_Color : Start_Color;
    vec3 colorB = (Swap_Colors == 1) ? Start_Color : End_Color;

    // Compute gradient factor
    float t;
    if (Ramp_Shape == 0) {
        // Linear gradient
        vec2 dir = End_of_Ramp - Start_of_Ramp;
        float len = length(dir);
        t = dot(vUvScaled - Start_of_Ramp, normalize(dir)) / len;
    } else {
        // Radial gradient
        float distStart = distance(vUvScaled, Start_of_Ramp);
        float distEnd = distance(End_of_Ramp, Start_of_Ramp);
        t = distStart / distEnd;
    }

    // Clamp and apply scatter
    t = clamp(t, 0.0, 1.0);
    t += (hash(vUvScaled * 100.0) - 0.5) * Ramp_Scatter;
    t = clamp(t, 0.0, 1.0);

    // Interpolate colors
    vec3 gradientColor = mix(colorA, colorB, t);

    // Blend logic fixed: gradient shows at Blend_With_Original = 0
    vec3 finalColor = mix(gradientColor, original.rgb, Blend_With_Original);

    gl_FragColor = vec4(finalColor, original.a);
}
