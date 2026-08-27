precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform vec2 Scale;
uniform float Rotation;
uniform vec3 Color;
uniform float Opacity;
uniform float Size;
uniform vec2 Position;
uniform vec2 EllipseScale;
uniform float PatternRotation;
uniform int N;

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

#define PI 3.14159265359

vec4 blendColors(vec4 baseColor, vec4 overlayColor) {
    float sourceAlpha = clamp(overlayColor.a, 0.0, 1.0);
    float backgroundAlpha = clamp(baseColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = overlayColor.rgb * sourceAlpha + baseColor.rgb * (1.0 - sourceAlpha);
    return vec4(outputColor, outputAlpha);
}

vec2 rotate(vec2 p, float angleRad) {
    float s = sin(angleRad);
    float c = cos(angleRad);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    vec2 uv = objectUv;
    vec4 texel = premultiplyColor(sourceTexel);
    vec2 adjustedUV = uv - vec2(0.5);
    adjustedUV.x *= 16.0 / 9.0;
    vec2 centerOffset = vec2(0.0);
    vec2 currentPos = adjustedUV - centerOffset;
    vec4 finalColor = texel;
    
    if (N <= 0) {
        gl_FragColor = finalColor;
        return;
    }
    
    for (int i = 0; i < 100; ++i) {
        if (i >= N) break;
        float uniformRotationAngle = 2.0 * PI / float(N) * float(i);
        float additionalRotationRad = PatternRotation * PI / 180.0;
        float totalRotationRad = uniformRotationAngle + additionalRotationRad;
        vec2 rotatedPos = rotate(currentPos, -totalRotationRad);
        
        if (rotatedPos.x < 0.0) {
            float effectiveSize = Size * 0.5;
            vec2 d = rotatedPos / (effectiveSize * EllipseScale);
            float dist = dot(d, d);
            if (dist < 1.0) {
                vec4 shapeColor = vec4(Color, Opacity);
                finalColor = blendColors(finalColor, shapeColor);
            }
        }
    }
    
    gl_FragColor = finalColor;
}
