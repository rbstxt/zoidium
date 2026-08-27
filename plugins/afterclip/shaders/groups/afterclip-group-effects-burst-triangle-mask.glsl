precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform vec2 P1;
uniform vec2 P2;
uniform vec2 P3;
uniform float GeometryScale;

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


bool isInTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
    vec2 v0 = p2 - p0;
    vec2 v1 = p1 - p0;
    vec2 v2 = p - p0;
    
    float d00 = dot(v0, v0);
    float d01 = dot(v0, v1);
    float d11 = dot(v1, v1);
    float d20 = dot(v2, v0);
    float d21 = dot(v2, v1);
    float denom = d00 * d11 - d01 * d01;
    float v = (d11 * d20 - d01 * d21) / denom;
    float w = (d00 * d21 - d01 * d20) / denom;
    float u = 1.0 - v - w;
    
    return (u >= 0.0) && (v >= 0.0) && (w >= 0.0);
}

void main()
{
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    vec2 p1Uv = vec2(P1[0]/1920.0+0.5, P1[1]/1080.0+0.5);
    vec2 p2Uv = vec2(P2[0]/1920.0+0.5, P2[1]/1080.0+0.5);
    vec2 p3Uv = vec2(P3[0]/1920.0+0.5, P3[1]/1080.0+0.5);
    
    vec2 centeredUV = vUvScaled - 0.5;
    vec2 scaledUV = centeredUV / GeometryScale + 0.5;
    
    if (isInTriangle(scaledUV, p1Uv, p2Uv, p3Uv)) {
        gl_FragColor = vec4(0.0);
    } else {
        vec4 texel = texture2D(tDiffuse, vUvScaled);
        gl_FragColor = premultiplyColor(texel);
    }
}
