precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform float Transition_Completion; // 0-100
uniform float Start_Angle;           // degrees
uniform vec2 Wipe_Center;            // normalized
uniform int Wipe;                    // 0=CW,1=CCW,2=Both
uniform float Feather;               // pixels
uniform vec2 resolution;

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    float completion = clamp(Transition_Completion / 100.0, 0.0, 1.0);
    float startAngle = radians(Start_Angle);
    vec2 uv = vUvScaled;
    vec2 center = Wipe_Center;

    vec2 diff = uv - center;
    float angle = atan(diff.y, diff.x);
    if (angle < 0.0) angle += 2.0 * 3.14159265359;

    float sweep = completion * 2.0 * 3.14159265359;

    // Compute angular difference from start
    float delta = angle - startAngle;
    if (delta < 0.0) delta += 2.0 * 3.14159265359;

    // Direction handling
    if (Wipe == 1) { // CCW
        delta = (startAngle - angle);
        if (delta < 0.0) delta += 2.0 * 3.14159265359;
    }

    // For Both directions
    if (Wipe == 2) {
        delta = abs(angle - startAngle);
        if (delta > 3.14159265359) delta = 2.0 * 3.14159265359 - delta;
        sweep *= 0.5;
    }

    // Feather
    float featherNorm = Feather / max(resolution.x, resolution.y);
    float alpha = smoothstep(sweep - featherNorm, sweep, delta);

    gl_FragColor = texel * alpha;
}
