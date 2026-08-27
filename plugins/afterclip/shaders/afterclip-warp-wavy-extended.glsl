precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Time;
uniform float Amount;
uniform float Size;
uniform float Angle;
uniform float WarpAngle;
uniform int Repeat;

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


#define PI 3.14159265359

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
    vec2 uv = vUvScaled;
    
    vec2 warp_vector = vec2(cos(WarpAngle), sin(WarpAngle));
    
    vec2 centered_uv = uv - vec2(0.5);
    vec2 propagation_vector = vec2(cos(Angle), sin(Angle));
    float phase_offset = dot(centered_uv, propagation_vector);

    float wave_value = sin(phase_offset * Size + Time);
    
    vec2 offset = warp_vector * wave_value * Amount * 0.01;
    vec2 distorted_uv = uv + offset;
    
    if (Repeat == 3) {
        if (distorted_uv.x < 0.0 || distorted_uv.x > 1.0 ||
            distorted_uv.y < 0.0 || distorted_uv.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
    }
    
    vec2 wrapped_uv = wrap(distorted_uv, Repeat);
    
    vec4 texColor = texture2D(tDiffuse, wrapped_uv);
    gl_FragColor = premultiplyColor(texColor);
}
