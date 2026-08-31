precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Properties
uniform vec2 Iris_Center;       // Position (0.0 - 1.0)
uniform float Iris_Points;      // Number of spikes/polygon sides
uniform float Outer_Radius;     // Size of the iris opening
uniform int Use_Inner_Radius;   // 0 = Disabled, 1 = Enabled
uniform float Inner_Radius;     // Star depth (spike length)
uniform float Rotation;         // Rotation in degrees
uniform float Feather;          // Soft edge

uniform vec2 resolution;

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    float angleOffset = radians(Rotation);
    vec2 uv = vUvScaled;
    vec2 center = Iris_Center;

    // Compute distance and angle
    vec2 diff = uv - center;
    float dist = length(diff);
    float angle = atan(diff.y, diff.x) + angleOffset;

    // Polygon/star effect
    float sides = max(Iris_Points, 3.0);
    float starFactor = 1.0;
    if (Use_Inner_Radius == 1) {
        starFactor += Inner_Radius * cos(angle * sides);
    }

    float polygonRadius = (cos(3.14159265359 / sides) /
                          cos(mod(angle, 2.0 * 3.14159265359 / sides) - 3.14159265359 / sides)) * starFactor;

    float normalizedDist = dist / polygonRadius;

    // Feather normalization
    float featherNorm = Feather / max(resolution.x, resolution.y);

    // Inverse logic: fully visible when Outer_Radius = 0, hide outside as radius grows
    float alpha = smoothstep(Outer_Radius, Outer_Radius + featherNorm, normalizedDist);

    gl_FragColor = texel * alpha;
}
