precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

uniform float Bend;            // Bend intensity
uniform int Style;             // 1=Bend, 2=Marilyn, 3=Sharp, 4=Boxer
uniform int AdjustToDistance;  // 0=off, 1=on
uniform vec2 Top;              // Top position
uniform vec2 Base;             // Base position

#define PI 3.141592653589793

vec4 samplePix(vec2 uv) {
    return texture2D(tDiffuse, uv);
}

vec2 applyDistortion(vec2 uv) {
    vec2 pos = uv * resolution;

    if (pos.y < Base.y) return uv;

    float range = Top.y - Base.y;
    float t = (pos.y - Base.y) / max(range, 1.0);

    float bendFactor = Bend * 0.02; // Softer bend globally
    if (AdjustToDistance == 1) {
        bendFactor *= range / resolution.y;
    }

    float offset = 0.0;
    if (Style == 1) { // Bend
        offset = bendFactor * t;
    } else if (Style == 2) { // Marilyn (AE-like)
        offset = bendFactor * (sin(t * PI) * 1.2);
    } else if (Style == 3) { // Sharp (AE-like, sharper than Marilyn)
        float sharpCurve = sin((t - 0.5) * PI * 3.0);
        sharpCurve = clamp(sharpCurve, -1.0, 1.0);
        offset = bendFactor * sharpCurve * 1.5;
    } else if (Style == 4) { // Boxer (AE-like)
        offset = bendFactor * (pow(t, 1.5) * 0.8);
    }

    pos.x += offset * (resolution.x * 0.05);

    return pos / resolution;
}

void main() {
    vec2 uv = vUvScaled;
    vec2 distortedUV = applyDistortion(uv);
    gl_FragColor = samplePix(distortedUV);
}
