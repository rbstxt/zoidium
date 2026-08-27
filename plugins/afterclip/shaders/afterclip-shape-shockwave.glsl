precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec3 Color;
uniform int N;
uniform float InSize;
uniform float OutSize;
uniform vec2 Position;
uniform float PatternRotation;

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
vec2 objectUv;

vec2 standardObjectUv(vec2 uv) {
    vec2 p = uv * 2.0 - 1.0;
    p -= Position;
    p.x *= 16.0 / 9.0;
    
    float standardRotation = Rotation * 3.14159265359 / 180.0;
    p = vec2(
        cos(standardRotation) * p.x + sin(standardRotation) * p.y,
        -sin(standardRotation) * p.x + cos(standardRotation) * p.y
    );
    p /= max(abs(Scale), vec2(0.0001));
    p.x /= 16.0 / 9.0;
    return p * 0.5 + 0.5;
}

float polygonDistance(vec2 point, int sides, float radius) {
    float angle = (PatternRotation * 3.14159265359 / 180.0) + atan(point.y, point.x) + 3.14159265359 / float(sides);
    float segmentAngle = 2.0 * 3.14159265359 / float(sides);
    float distanceToEdge = radius * cos(segmentAngle / 2.0) / cos(mod(angle, segmentAngle) - segmentAngle / 2.0);
    return length(point) - distanceToEdge;
}

void main() {
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    vec2 uv = objectUv;

    vec2 adjustedUV = uv - vec2(0.5);
    adjustedUV.x *= 16.0 / 9.0;
    float distOuter = polygonDistance(adjustedUV, N, OutSize);
    float distInner = polygonDistance(adjustedUV, N, InSize);

    if (distOuter < 0.0 && distInner > 0.0) {
        gl_FragColor = sourceOverColor(sourceTexel, Color, Opacity);
    } else {
        gl_FragColor = premultiplyColor(sourceTexel);
    }
}
