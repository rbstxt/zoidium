precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform vec2 Offset;
uniform int RepeatMode;
uniform float Rotation;
uniform vec2 Multiplier;
uniform vec2 Anchor;

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


vec2 wrap(vec2 uv, int mode) {
    if (mode == 0) {
        return clamp(uv, 0.0, 1.0);
    } else if (mode == 1) {
        return mod(uv, 1.0); 
    } else if (mode == 2) {
        vec2 m = mod(uv, 2.0);
        return 1.0 - abs(m - 1.0);
    } else {
        return uv;
    }
}

void main()
{
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    const float ASPECT_RATIO = 16.0 / 9.0;
    const float DEG_TO_RAD = 3.14159265359 / 180.0;
    
    float rotationRad = Rotation * DEG_TO_RAD;
    
    vec2 anchorPoint = vec2(0.5) + Anchor;
    
    vec2 localUv = vUvScaled - anchorPoint; 

    vec2 scaledUv = localUv * Multiplier; 

    vec2 adjustedUv = scaledUv;
    adjustedUv.x *= ASPECT_RATIO;

    float c = cos(rotationRad);
    float s = sin(rotationRad);
    
    vec2 rotatedUv;
    rotatedUv.x = adjustedUv.x * c - adjustedUv.y * s;
    rotatedUv.y = adjustedUv.x * s + adjustedUv.y * c;

    vec2 finalRotatedUv = rotatedUv;
    finalRotatedUv.x /= ASPECT_RATIO;

    vec2 shiftedUv = finalRotatedUv + anchorPoint - Offset;

    if (RepeatMode == 3) {
        if (shiftedUv.x < 0.0 || shiftedUv.x > 1.0 || 
            shiftedUv.y < 0.0 || shiftedUv.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); 
            return;
        }
    }

    vec2 wrappedUv = wrap(shiftedUv, RepeatMode);
    
    vec4 texel = texture2D(tDiffuse, wrappedUv);
    
    if (RepeatMode != 3) {
        gl_FragColor = premultiplyColor(texel);
    }
}
