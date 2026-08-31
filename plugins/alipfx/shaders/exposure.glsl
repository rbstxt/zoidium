precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// 1) Channels
// 0.0 = Master
// 1.0 = Individual Channels
uniform float Channels;

// 2-4) Master controls
uniform float Exposure;
uniform float Offset;
uniform float Gamma_Correction;

// 5-7) Red controls
uniform float Red_Exposure;
uniform float Red_Offset;
uniform float Red_Gamma_Correction;

// 8-10) Green controls
uniform float Green_Exposure;
uniform float Green_Offset;
uniform float Green_Gamma_Correction;

// 11-13) Blue controls
uniform float Blue_Exposure;
uniform float Blue_Offset;
uniform float Blue_Gamma_Correction;

// 14) Bypass Linear Light Conversion
// 0.0 = Disabled  (convert to linear -> process -> convert back)
// 1.0 = Enabled   (process raw/gamma-encoded pixels directly)
uniform float Bypass_Linear_Light_Conversion;

const float EPSILON = 1e-6;

// sRGB -> Linear
float srgbToLinear1(float x)
{
    if (x <= 0.04045) return x / 12.92;
    return pow((x + 0.055) / 1.055, 2.4);
}

vec3 srgbToLinear(vec3 c)
{
    return vec3(
        srgbToLinear1(c.r),
        srgbToLinear1(c.g),
        srgbToLinear1(c.b)
    );
}

// Linear -> sRGB
float linearToSrgb1(float x)
{
    if (x <= 0.0031308) return 12.92 * x;
    return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

vec3 linearToSrgb(vec3 c)
{
    return vec3(
        linearToSrgb1(c.r),
        linearToSrgb1(c.g),
        linearToSrgb1(c.b)
    );
}

// AE/PS-style float exposure model approximation:
// out = pow(max(in * 2^Exposure + Offset, 0), 1/Gamma)
float aeExposure(float x, float exposureStops, float offsetValue, float gammaValue)
{
    float g = max(gammaValue, EPSILON);
    float y = x * exp2(exposureStops) + offsetValue;
    y = max(y, 0.0);
    return pow(y, 1.0 / g);
}

vec3 applyMaster(vec3 c)
{
    return vec3(
        aeExposure(c.r, Exposure, Offset, Gamma_Correction),
        aeExposure(c.g, Exposure, Offset, Gamma_Correction),
        aeExposure(c.b, Exposure, Offset, Gamma_Correction)
    );
}

vec3 applyIndividual(vec3 c)
{
    return vec3(
        aeExposure(c.r, Red_Exposure,   Red_Offset,   Red_Gamma_Correction),
        aeExposure(c.g, Green_Exposure, Green_Offset, Green_Gamma_Correction),
        aeExposure(c.b, Blue_Exposure,  Blue_Offset,  Blue_Gamma_Correction)
    );
}

void main()
{
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 src = texel.rgb;
    vec3 work;
    vec3 dst;

    // Non-bypassed mode:
    // approximate AE linear-light processing using sRGB <-> linear conversion
    if (Bypass_Linear_Light_Conversion < 0.5)
    {
        // sRGB transfer functions are defined for non-negative SDR values,
        // so clamp before conversion for stable Panzoid behavior.
        work = srgbToLinear(max(src, 0.0));

        if (Channels < 0.5)
        {
            dst = applyMaster(work);
        }
        else
        {
            dst = applyIndividual(work);
        }

        dst = linearToSrgb(max(dst, 0.0));
    }
    else
    {
        // Bypassed mode:
        // apply directly to incoming/gamma-encoded pixels
        if (Channels < 0.5)
        {
            dst = applyMaster(src);
        }
        else
        {
            dst = applyIndividual(src);
        }
    }

    gl_FragColor = vec4(dst, texel.a);
}
