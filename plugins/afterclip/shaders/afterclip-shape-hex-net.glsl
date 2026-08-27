precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec2 Position;
uniform float GridSize;
uniform float HexScale;
uniform vec3 Color;
uniform vec2 Offset;
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

const float SQRT3 = 1.732050808;
const float DEG_TO_RAD = 3.14159265359 / 180.0;

mat2 rotate2D(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

vec4 getHexCell(vec2 p) {
    vec2 s = vec2(1.0, SQRT3);
    vec2 h = s * 0.5;
    
    vec2 a = mod(p, s) - h;
    vec2 b = mod(p - h, s) - h;
    
    vec2 gv = length(a) < length(b) ? a : b;
    vec2 id = p - gv;
    
    return vec4(gv, id);
}

float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, vec2(0.5, SQRT3 * 0.5)), p.x);
}

void main() {
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    vec4 originalTexel = texture2D(tDiffuse, vUvScaled);
    
    float aspectRatio = 16.0 / 9.0;
    
    vec2 uv = objectUv - vec2(0.5);
    uv.x *= aspectRatio;
    
    vec2 offsetUV = uv + Offset;
    
    float angleRad = PatternRotation * DEG_TO_RAD;
    mat2 rotMat = rotate2D(angleRad);
    vec2 rotatedUV = rotMat * offsetUV;
    
    vec2 hexUV = rotatedUV * GridSize;
    
    vec4 hex = getHexCell(hexUV);
    vec2 gv = hex.xy;
    vec2 id = hex.zw;
    
    vec2 samplePos = id;
    samplePos /= GridSize;
    
    mat2 invRotMat = rotate2D(-angleRad);
    samplePos = invRotMat * samplePos;
    
    samplePos -= Offset;
    samplePos.x /= aspectRatio;
    
    vec2 sampleUV = samplePos + vec2(0.5);
    sampleUV = clamp(sampleUV, 0.0, 1.0);
    
    vec4 texColor = texture2D(tDiffuse, sampleUV);
    
    float maxRadius = 0.5;
    float currentRadius = maxRadius * HexScale;
    
    if (hexDist(gv) > currentRadius) {
        gl_FragColor = sourceOverColor(sourceTexel, Color, Opacity);
    } else {
        gl_FragColor = premultiplyColor(sourceTexel);
    }
}
