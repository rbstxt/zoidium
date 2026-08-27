precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Opacity;
uniform vec2 Scale;
uniform float Rotation;
uniform vec2 Position;
uniform float GridSize;
uniform float BoxScaleMin;
uniform float BoxScaleMax;
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

void main()
{
objectUv = standardObjectUv(vUvScaled);
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
if (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }
    float aspectRatio = 16.0 / 9.0;
    
    
    vec2 centeredCoord = objectUv - vec2(0.5);
    
    
    centeredCoord.x *= aspectRatio;
    
    
    vec2 cellUV = centeredCoord * GridSize;
    vec2 cellCoord = floor(cellUV + 0.5); 
    vec2 cellFract = fract(cellUV + 0.5);
    
    
    vec2 cellCenterCoord = cellCoord / GridSize;
    
    cellCenterCoord.x /= aspectRatio;
    vec2 originalUV = cellCenterCoord + vec2(0.5);
    
    vec3 centerColor = texture2D(tDiffuse, originalUV).rgb;
    float value = max(max(centerColor.r, centerColor.g), centerColor.b);
    float dynamicBoxScale = mix(BoxScaleMin, BoxScaleMax, value);
    
    vec2 centerStart = vec2(0.5) - dynamicBoxScale / 2.0;
    vec2 centerEnd   = vec2(0.5) + dynamicBoxScale / 2.0;
    
    bool inBox = all(greaterThanEqual(cellFract, centerStart)) &&
                 all(lessThanEqual(cellFract, centerEnd));
    
    if (inBox) {
        gl_FragColor = sourceOverColor(sourceTexel, Color, Opacity);
    } else {
        gl_FragColor = premultiplyColor(sourceTexel);
    }
}
