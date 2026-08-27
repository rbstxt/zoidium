precision highp float;
precision highp int;
uniform sampler2D tDiffuse;
uniform float Amount;
uniform vec2 Displacement;
uniform vec2 DisplacementOffset;
uniform vec2 NoisePosition;
uniform vec2 NoiseScale;
uniform float Step;
uniform float Evolution;
uniform float Complexity;
uniform float Strength;
uniform float Angle;
uniform float AngleNoise;
uniform vec3 StartColor;
uniform vec3 EndColor;
uniform int RepeatType;

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


float rand(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);

    float a = rand(i);
    float b = rand(i + vec3(1.0, 0.0, 0.0));
    float c = rand(i + vec3(0.0, 1.0, 0.0));
    float d = rand(i + vec3(1.0, 1.0, 0.0));
    float e = rand(i + vec3(0.0, 0.0, 1.0));
    float f1 = rand(i + vec3(1.0, 0.0, 1.0));
    float g = rand(i + vec3(0.0, 1.0, 1.0));
    float h = rand(i + vec3(1.0, 1.0, 1.0));

    vec3 u = f * f * (3.0 - 2.0 * f);

    float x1 = mix(a, b, u.x);
    float x2 = mix(c, d, u.x);
    float x3 = mix(e, f1, u.x);
    float x4 = mix(g, h, u.x);

    float y1 = mix(x1, x2, u.y);
    float y2 = mix(x3, x4, u.y);

    return mix(y1, y2, u.z);
}

float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 2.0;
    float totalAmplitude = 0.0;

    int octaves = int(Complexity);
    if (octaves < 1) octaves = 1;
    if (octaves > 10) octaves = 10;

    for (int i = 0; i < 10; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p);
        totalAmplitude += amplitude;
        p *= frequency;
        amplitude *= 0.5;
    }
    return value / totalAmplitude;
}

vec2 warpDomain(vec2 uv) {
    float n = noise(vec3(uv + NoisePosition, Evolution));

    float angle;
    if (AngleNoise == 0.0) {
        angle = Angle;
    } else if (AngleNoise == 1.0) {
        angle = n * 3.14159 * 2.0;
    } else {
        angle = mix(Angle, n * 3.14159 * 2.0, AngleNoise);
    }

    vec2 warpDirection = vec2(cos(angle), sin(angle));
    vec2 warpedUv = uv + Strength * warpDirection;

    return warpedUv;
}

float getMixValue(vec2 uvRaw) {
    
    vec2 uv = (uvRaw - 0.5) * vec2(16.0 / 9.0, 1.0) + 0.5;
    uv = (uv - 0.5) * NoiseScale + 0.5;

    
    vec2 warpedUv = warpDomain(uv);
    vec3 pos = vec3(warpedUv + NoisePosition, Evolution);
    float rawValue = clamp(fbm(pos), 0.0, 1.0);

    
    if (Step == 0.0) {
        return rawValue;
    } else {
        float stepValue = floor(rawValue * float(Step)) / float(Step);
        return stepValue;
    }
}
vec4 reflectedTexture2d(sampler2D tex, vec2 uv, int Repeat) {
    if (Repeat == 0) {
        if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            return texture2D(tex, uv);
        } else {
            return vec4(0.0);
        }
    } else if (Repeat == 1) {
        return texture2D(tex, fract(uv));
    } else if (RepeatType == 2) {
        vec2 reflectedUV = abs(fract(uv * 0.5) * 2.0 - 1.0);
        return texture2D(tex, 1.0 - reflectedUV);
    }
    return texture2D(tex, uv);
}

void main() {
vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);
    float value = getMixValue(vUvScaled);
    vec4 texel = reflectedTexture2d(tDiffuse, vUvScaled + ( value - DisplacementOffset - 0.5 ) * Amount * Displacement / 10.0, RepeatType);
    gl_FragColor = premultiplyColor(texel);
}
