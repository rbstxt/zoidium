precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom properties from Panzoid
uniform float Transition_Completion; // 0.0 to 100.0 (%)
uniform float Wipe_Angle;            // in degrees
uniform float Feather;               // in pixels

uniform vec2 resolution;

void main() {
    // Read the original texture
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    // Normalize transition completion to 0.0 - 1.0
    float completion = clamp(Transition_Completion / 100.0, 0.0, 1.0);

    // Convert angle to radians
    float angle = radians(Wipe_Angle);

    // Compute direction vector for wipe line
    vec2 dir = vec2(cos(angle), sin(angle));

    // Center UV coordinates
    vec2 uv = vUvScaled;

    // Project UV onto wipe direction
    float proj = dot(uv - 0.5, dir);

    // Compute threshold for transition
    float threshold = mix(-0.5, 0.5, completion);

    // Feather in normalized UV space
    float featherNorm = Feather / max(resolution.x, resolution.y);

    // Compute alpha based on feather
    float alpha = smoothstep(threshold - featherNorm, threshold + featherNorm, proj);

    // Output: reveal based on alpha
    gl_FragColor = texel * alpha;
}
