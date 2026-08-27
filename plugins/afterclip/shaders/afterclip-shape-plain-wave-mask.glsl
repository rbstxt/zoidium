precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Time;
uniform float Delay;
uniform float Power;
uniform float Step;

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


float easeInOut(float t, float p) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.5) {
        return 0.5 * pow(2.0 * t, p);
    } else {
        return 1.0 - 0.5 * pow(2.0 * (1.0 - t), p);
    }
}

float pixelateY(float y, float steps) {
    if (steps <= 0.0) {
        return y;
    }
    return floor(y * steps) / steps;
}

vec3 lerp(vec3 a, vec3 b, float t) {
    return a + (b - a) * t;
}

void main()
{
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    float yUsed = pixelateY(vUvScaled.y, Step);

    float t = (Time*(Time+Delay)) - yUsed * Delay;

    float tNorm = clamp(t, 0.0, 1.0);
    float eased = easeInOut(tNorm, Power);

    if (vUvScaled.x < eased) {
        gl_FragColor = vec4(0.0);
    } else {
        gl_FragColor = premultiplyColor(texture2D(tDiffuse, vUvScaled));
    }
}
