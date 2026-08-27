precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec2 Position;
uniform vec2 P1;
uniform vec2 P2;
uniform float Width;
uniform vec3 Color;
uniform int Stroke;
uniform float PatternRotation;
uniform float InDir;
uniform float OutDir;
uniform float Repeat;
uniform float Wide;

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
vec2 rotate(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
void main() {
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec2 p1 = vec2(P1.x / 1920.0, P1.y / 1080.0);
    vec2 p2 = vec2(P2.x / 1920.0, P2.y / 1080.0);
    vec2 uv = objectUv - 0.5;
    vec2 p1Corrected = vec2(p1.x, p1.y * ASPECT);
    vec2 p2Corrected = vec2(p2.x, p2.y * ASPECT);
    vec2 uvCorrected = vec2(uv.x, uv.y * ASPECT);
    float rad = PatternRotation * DEG2RAD;
    p1Corrected = rotate(p1Corrected, rad);
    p2Corrected = rotate(p2Corrected, rad);
    vec2 center = (p1Corrected + p2Corrected) * 0.5;
    float radius = length(p2Corrected - p1Corrected) * 0.5;
    vec2 baseDir = normalize(p1Corrected - center);
    float baseAngle = atan(baseDir.y, baseDir.x);
    vec2 toPixel = uvCorrected - center;
    float dist = length(toPixel);
    float pixelAngle = atan(toPixel.y, toPixel.x);
    float relativeAngle = baseAngle - pixelAngle;
    
    if (relativeAngle < 0.0) {
        relativeAngle += 2.0 * PI;
    }
    
    float relativeAngleDeg = relativeAngle / DEG2RAD;
    float w = Width / 100.0;
    bool draw = false;
    
    for (int i = 0; i < 360; i++) {
        if (float(i) >= Repeat) break;
        
        float offsetAngle = float(i) * Wide * DEG2RAD;
        
        vec2 rotatedP2 = rotate(p2Corrected - p1Corrected, offsetAngle) + p1Corrected;
        vec2 rotatedCenter = (p1Corrected + rotatedP2) * 0.5;
        float rotatedRadius = length(rotatedP2 - p1Corrected) * 0.5;
        
        vec2 rotatedBaseDir = normalize(p1Corrected - rotatedCenter);
        float rotatedBaseAngle = atan(rotatedBaseDir.y, rotatedBaseDir.x);
        
        vec2 toPixelRotated = uvCorrected - rotatedCenter;
        float distRotated = length(toPixelRotated);
        float pixelAngleRotated = atan(toPixelRotated.y, toPixelRotated.x);
        float relativeAngleRotated = rotatedBaseAngle - pixelAngleRotated;
        
        if (relativeAngleRotated < 0.0) {
            relativeAngleRotated += 2.0 * PI;
        }
        
        float relativeAngleDegRotated = relativeAngleRotated / DEG2RAD;
        
        bool inAngleRange = false;
        if (InDir <= OutDir) {
            inAngleRange = (relativeAngleDegRotated >= InDir && relativeAngleDegRotated <= OutDir);
        } else {
            inAngleRange = (relativeAngleDegRotated >= InDir || relativeAngleDegRotated <= OutDir);
        }
        
        if (Stroke == 0) {
            if (abs(distRotated - rotatedRadius) < w && inAngleRange) {
                draw = true;
                break;
            }
        } else if (Stroke == 1) {
            if (abs(distRotated - rotatedRadius) < w && inAngleRange) {
                draw = true;
                break;
            }
            float startRad = rotatedBaseAngle - InDir * DEG2RAD;
            vec2 startPoint = rotatedCenter + rotatedRadius * vec2(cos(startRad), sin(startRad));
            if (length(uvCorrected - startPoint) < w) {
                draw = true;
                break;
            }
            float endRad = rotatedBaseAngle - OutDir * DEG2RAD;
            vec2 endPoint = rotatedCenter + rotatedRadius * vec2(cos(endRad), sin(endRad));
            if (length(uvCorrected - endPoint) < w) {
                draw = true;
                break;
            }
        } else if (Stroke == 2) {
            if (abs(distRotated - rotatedRadius) < w * 1.5 && inAngleRange) {
                draw = true;
                break;
            }
        }
    }
    
    if (draw) {
        gl_FragColor = sourceOverColor(sourceTexel, Color, Opacity);
    } else {
        gl_FragColor = premultiplyColor(texel);
    }
}
