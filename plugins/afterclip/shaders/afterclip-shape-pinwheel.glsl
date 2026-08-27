precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec2 Position;
uniform float Radius;
uniform vec3 Color;
uniform float PatternRotation;
uniform float Dir;
uniform float Wide;
uniform float Repeat;
uniform float Wavy;
uniform float Frequency;

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

const float ASPECT = 9.0 / 16.0;
const float DEG2RAD = 3.14159265359 / 180.0;
const float PI = 3.14159265359;

void main() {
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    vec2 uv = objectUv - 0.5;
    vec2 center = vec2(0.0);

    vec2 centerCorrected = vec2(center.x, center.y * ASPECT);
    vec2 uvCorrected = vec2(uv.x, uv.y * ASPECT);

    float radius = Radius / 100.0;

    vec2 toPixel = uvCorrected - centerCorrected;
    float dist = length(toPixel);
    float pixelAngle = atan(toPixel.y, toPixel.x);

    bool draw = false;

    for (float i = 0.0; i < 100.0; i += 1.0) {
        if (i >= Repeat) break;

        float rotRad = (PatternRotation + i * Wide) * DEG2RAD;
        float relativeAngle = pixelAngle - rotRad;

        
        relativeAngle = mod(relativeAngle, 2.0 * PI);
        if (relativeAngle < 0.0) {
            relativeAngle += 2.0 * PI;
        }

        float angleDeg = relativeAngle / DEG2RAD;

        
        float waveOffset = 0.0;
        if (Wavy > 0.0) {
            waveOffset = sin(dist * Frequency * 50.0) * Wavy;
        }

        float minAngle = 0.0 - waveOffset;
        float maxAngle = Dir + waveOffset;

        if (dist <= radius && angleDeg >= minAngle && angleDeg <= maxAngle) {
            draw = true;
            break;
        }

        
        if (dist <= radius && minAngle < 0.0 && angleDeg >= (360.0 + minAngle)) {
            draw = true;
            break;
        }
    }

    gl_FragColor = draw ? sourceOverColor(sourceTexel, Color, Opacity) : premultiplyColor(texel);
}
