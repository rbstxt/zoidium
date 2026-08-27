precision highp float;
precision highp int;
uniform sampler2D tDiffuse;


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
    vec2 centeredUv = vUvScaled - vec2(0.5);

    centeredUv.x /= 9.0 / 16.0;

    float r = length(centeredUv);
    float theta = atan(centeredUv.y, centeredUv.x);

    theta = theta / (2.0 * 3.14159265) + 0.5;

    vec2 polarUv = vec2(theta, r);

    vec4 texel = texture2D(tDiffuse, polarUv);

    gl_FragColor = premultiplyColor(texel);
}
