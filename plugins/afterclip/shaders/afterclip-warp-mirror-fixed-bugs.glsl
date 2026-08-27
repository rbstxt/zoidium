precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Segments;

vec4 premultiplyColor(vec4 colorValue) {
    float alpha = clamp(colorValue.a, 0.0, 1.0);
    return vec4(colorValue.rgb * alpha, alpha);
}

vec4 sourceOverColor(vec4 backgroundColor, vec3 effectColor, float effectAlpha) {
    float sourceAlpha = clamp(effectAlpha, 0.0, 1.0);
    float backgroundAlpha = clamp(backgroundColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = effectColor * sourceAlpha + backgroundColor.rgb * remainingBackground;
    return vec4(outputColor, outputAlpha);
}

varying vec2 vUvScaled;


const float pi = 3.14159265358979323846264;
const float two_pi = 2.0 * pi;

const float aspect = 16.0 / 9.0;

void main() {
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    vec2 p = vUvScaled - 0.5;
    
    p.x *= aspect;

    float angle = atan(p.y, p.x);
    float radius = length(p);
    float segmentAngle = two_pi / Segments;
    float adjustedAngle = angle + pi;
    float segmentId = floor(adjustedAngle / segmentAngle);
    float newAngle = mod(adjustedAngle, segmentAngle) - 0.5 * segmentAngle;
    vec2 newP = vec2(cos(newAngle), sin(newAngle)) * radius;

    newP.x /= aspect;

    vec2 newUV = newP + 0.5;
    vec4 texel = texture2D(tDiffuse, newUV);
    gl_FragColor = premultiplyColor(texel);
}
