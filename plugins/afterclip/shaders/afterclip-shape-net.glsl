precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec2 Position;
uniform float PaintedWidth;
uniform float UnpaintedWidth;
uniform float Angle;
uniform float Offset;
uniform vec3 Color;

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

void main() {
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    
    float angle_rad = (Angle - 45.0) * 3.14159265359 / 180.0;
    float cosAngle = cos(angle_rad);
    float sinAngle = sin(angle_rad);
    
    
    float angle_rad_90 = angle_rad + 3.14159265359 / 2.0;
    float cosAngle90 = cos(angle_rad_90);
    float sinAngle90 = sin(angle_rad_90);
    
    
    vec2 p = objectUv - vec2(0.5);
    p.y *= 9.0 / 16.0;
    
    
    vec2 rotatedP1 = vec2(
        p.x * cosAngle - p.y * sinAngle,
        p.x * sinAngle + p.y * cosAngle
    );
    
    
    vec2 rotatedP2 = vec2(
        p.x * cosAngle90 - p.y * sinAngle90,
        p.x * sinAngle90 + p.y * cosAngle90
    );
    
    
    float painted = PaintedWidth / 100.0;
    float unpainted = UnpaintedWidth / 100.0;
    
    float pattern_width = painted + unpainted;
    float half_unpainted = unpainted / 2.0;
    
    
    float sRotated1 = rotatedP1.x + rotatedP1.y + Offset;
    float blinds1 = mod(sRotated1, pattern_width);
    float alpha1 = step(half_unpainted, blinds1) * step(blinds1, pattern_width - half_unpainted);
    
    
    float sRotated2 = rotatedP2.x + rotatedP2.y + Offset;
    float blinds2 = mod(sRotated2, pattern_width);
    float alpha2 = step(half_unpainted, blinds2) * step(blinds2, pattern_width - half_unpainted);
    
    
    float alpha = alpha1 * alpha2;
    
    
    vec4 blindsColor = vec4(Color, 1.0) * alpha;
    gl_FragColor = sourceOverColor(sourceTexel, Color, alpha * Opacity);
}
