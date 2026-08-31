precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform vec2 Iris_Center;
uniform float Iris_Points;
uniform float Outer_Radius;
uniform int Use_Inner_Radius;
uniform float Inner_Radius;
uniform float Rotation;
uniform float Feather;

uniform vec2 resolution;

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    float angleOffset = radians(Rotation);
    vec2 uv = vUvScaled;
    vec2 center = Iris_Center;

    vec2 diff = uv - center;
    float dist = length(diff);
    float angle = atan(diff.y, diff.x) + angleOffset;

    float sides = max(Iris_Points, 3.0);

    // Sharp star distortion using sine wave
    float starFactor = 1.0;
    if (Use_Inner_Radius == 1) {
        starFactor = 1.0 - Inner_Radius * abs(sin(angle * sides));
    }

    // Apply star factor to polygon radius
    float polygonRadius = (cos(3.14159265359 / sides) /
                          cos(mod(angle, 2.0 * 3.14159265359 / sides) - 3.14159265359 / sides)) * starFactor;

    float normalizedDist = dist / polygonRadius;

    float featherNorm = Feather / max(resolution.x, resolution.y);

    // Inverse logic: fully visible at Outer_Radius = 0
    float alpha = smoothstep(Outer_Radius, Outer_Radius + featherNorm, normalizedDist);

    gl_FragColor = texel * alpha;
}
