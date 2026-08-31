precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUv;

// Parameters matching AE Mirror
uniform vec2 reflectionCenter; // Position in pixels
uniform float reflectionAngle; // Rotation in degrees

void main() {
    // Convert angle to radians
    float angle = radians(reflectionAngle);

    // Convert UV to pixel space
    vec2 uvPx = vUv * resolution;

    // Translate so reflectionCenter is origin
    vec2 centered = uvPx - reflectionCenter;

    // Rotate coordinates by -angle (mirror axis rotation)
    float cosA = cos(-angle);
    float sinA = sin(-angle);
    vec2 rotated = vec2(
        centered.x * cosA - centered.y * sinA,
        centered.x * sinA + centered.y * cosA
    );

    // Mirror horizontally across axis (flip X)
    rotated.x = abs(rotated.x);

    // Rotate back
    vec2 unrotated = vec2(
        rotated.x * cosA + rotated.y * sinA,
        -rotated.x * sinA + rotated.y * cosA
    );

    // Translate back to original space
    vec2 mirroredPx = unrotated + reflectionCenter;

    // Convert back to UV
    vec2 mirroredUV = mirroredPx / resolution;

    // Sample texture
    vec4 color = texture2D(tDiffuse, mirroredUV);
    gl_FragColor = color;
}
