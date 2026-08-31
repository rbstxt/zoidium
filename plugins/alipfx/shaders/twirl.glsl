precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUv;

// AE Twirl parameters
uniform float angle;          // Twirl amount in degrees
uniform float twirlRadius;    // Radius in pixels
uniform vec2 twirlCenter;     // Center in pixels

void main() {
    // Convert UV to pixel space
    vec2 uvPx = vUv * resolution;

    // Compute vector from center
    vec2 delta = uvPx - twirlCenter;
    float dist = length(delta);

    // If outside radius, no twirl
    if (dist > twirlRadius) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
    }

    // Normalize distance (0 at center, 1 at radius)
    float normDist = dist / twirlRadius;

    // Convert angle to radians
    float maxAngle = radians(angle);

    // Compute twist amount based on distance (AE uses smooth falloff)
    float twist = maxAngle * (1.0 - normDist);

    // Rotate delta by twist
    float cosT = cos(twist);
    float sinT = sin(twist);
    vec2 rotated = vec2(
        delta.x * cosT - delta.y * sinT,
        delta.x * sinT + delta.y * cosT
    );

    // Compute final pixel position
    vec2 finalPx = twirlCenter + rotated;

    // Convert back to UV
    vec2 finalUV = finalPx / resolution;

    // Sample texture
    gl_FragColor = texture2D(tDiffuse, finalUV);
}
