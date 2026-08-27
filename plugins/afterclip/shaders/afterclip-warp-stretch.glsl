precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Angle;
uniform float Stretch;

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


void main()
{
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    
    const float DEG_TO_RAD = 3.14159265359 / 180.0;
    float angleRad = Angle * DEG_TO_RAD;

    
    vec2 localUv = vUvScaled - vec2(0.5);

    
    float c = cos(-angleRad); 
    float s = sin(-angleRad);
    
    vec2 rotatedUv;
    rotatedUv.x = localUv.x * c - localUv.y * s;
    rotatedUv.y = localUv.x * s + localUv.y * c;

    
    
    
    vec2 stretchedUv;
    stretchedUv.x = rotatedUv.x / Stretch; 
    stretchedUv.y = rotatedUv.y;           

    
    c = cos(angleRad); 
    s = sin(angleRad);
    
    vec2 reRotatedUv;
    reRotatedUv.x = stretchedUv.x * c - stretchedUv.y * s;
    reRotatedUv.y = stretchedUv.x * s + stretchedUv.y * c;

    
    vec2 finalUv = reRotatedUv + vec2(0.5);

    
    
    
    
    vec4 texel = texture2D(tDiffuse, finalUv);
    
    gl_FragColor = premultiplyColor(texel);
}
