precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUvScaled;

uniform float Radius;
uniform float Operate_On_Alpha_Channel;

float getChannel(vec4 c, int channel)
{
    if (channel == 0) return c.r;
    if (channel == 1) return c.g;
    if (channel == 2) return c.b;
    return c.a;
}

void sort2(inout float a, inout float b)
{
    if (a > b)
    {
        float t = a;
        a = b;
        b = t;
    }
}

float median9vals(
    float a0, float a1, float a2,
    float a3, float a4, float a5,
    float a6, float a7, float a8
)
{
    sort2(a1, a2);
    sort2(a4, a5);
    sort2(a7, a8);

    sort2(a0, a1);
    sort2(a3, a4);
    sort2(a6, a7);

    sort2(a1, a2);
    sort2(a4, a5);
    sort2(a7, a8);

    sort2(a0, a3);
    sort2(a5, a8);
    sort2(a4, a7);

    sort2(a3, a6);
    sort2(a1, a4);
    sort2(a2, a5);

    sort2(a4, a7);
    sort2(a4, a2);
    sort2(a6, a4);
    sort2(a4, a2);

    return a4;
}

float exactMedian9(vec2 uv, vec2 pixel, vec2 maxUv, int channel)
{
    float v[9];

    for (int i = 0; i < 9; i++)
    {
        int y = i / 3;
        int x = i - y * 3;
        x = x - 1;
        y = y - 1;

        vec2 suv = uv + vec2(float(x), float(y)) * pixel;
        suv = clamp(suv, vec2(0.0), maxUv);

        vec4 s = texture2D(tDiffuse, suv);
        v[i] = getChannel(s, channel);
    }

    for (int a = 0; a < 8; a++)
    {
        for (int b = 0; b < 8; b++)
        {
            if (b < 8 - a)
            {
                if (v[b] > v[b + 1])
                {
                    float t = v[b];
                    v[b] = v[b + 1];
                    v[b + 1] = t;
                }
            }
        }
    }

    return v[4];
}

float exactMedian25(vec2 uv, vec2 pixel, vec2 maxUv, int channel)
{
    float v[25];

    for (int i = 0; i < 25; i++)
    {
        int y = i / 5;
        int x = i - y * 5;
        x = x - 2;
        y = y - 2;

        vec2 suv = uv + vec2(float(x), float(y)) * pixel;
        suv = clamp(suv, vec2(0.0), maxUv);

        vec4 s = texture2D(tDiffuse, suv);
        v[i] = getChannel(s, channel);
    }

    for (int a = 0; a < 24; a++)
    {
        for (int b = 0; b < 24; b++)
        {
            if (b < 24 - a)
            {
                if (v[b] > v[b + 1])
                {
                    float t = v[b];
                    v[b] = v[b + 1];
                    v[b + 1] = t;
                }
            }
        }
    }

    return v[12];
}

float regionValueSoft(vec2 uv, vec2 pixel, vec2 maxUv, vec2 offsetPx, float innerRadiusPx, int channel)
{
    vec2 base = uv + offsetPx * pixel;

    vec2 dx = vec2(innerRadiusPx, 0.0) * pixel;
    vec2 dy = vec2(0.0, innerRadiusPx) * pixel;

    vec2 uv0 = clamp(base,      vec2(0.0), maxUv);
    vec2 uv1 = clamp(base - dx, vec2(0.0), maxUv);
    vec2 uv2 = clamp(base + dx, vec2(0.0), maxUv);
    vec2 uv3 = clamp(base - dy, vec2(0.0), maxUv);
    vec2 uv4 = clamp(base + dy, vec2(0.0), maxUv);

    float v0 = getChannel(texture2D(tDiffuse, uv0), channel);
    float v1 = getChannel(texture2D(tDiffuse, uv1), channel);
    float v2 = getChannel(texture2D(tDiffuse, uv2), channel);
    float v3 = getChannel(texture2D(tDiffuse, uv3), channel);
    float v4 = getChannel(texture2D(tDiffuse, uv4), channel);

    return (v0 + v1 + v2 + v3 + v4) * 0.20;
}

float approxMedianChannel(vec2 uv, vec2 pixel, vec2 maxUv, float radiusPx, int channel)
{
    float r = max(radiusPx, 1.0);
    float innerR = max(floor(r * 0.70 + 0.5), 1.0);

    float s0 = regionValueSoft(uv, pixel, maxUv, vec2(-r, -r), innerR, channel);
    float s1 = regionValueSoft(uv, pixel, maxUv, vec2( 0.0, -r), innerR, channel);
    float s2 = regionValueSoft(uv, pixel, maxUv, vec2( r, -r), innerR, channel);

    float s3 = regionValueSoft(uv, pixel, maxUv, vec2(-r,  0.0), innerR, channel);
    float s4 = regionValueSoft(uv, pixel, maxUv, vec2( 0.0,  0.0), innerR, channel);
    float s5 = regionValueSoft(uv, pixel, maxUv, vec2( r,  0.0), innerR, channel);

    float s6 = regionValueSoft(uv, pixel, maxUv, vec2(-r,  r), innerR, channel);
    float s7 = regionValueSoft(uv, pixel, maxUv, vec2( 0.0,  r), innerR, channel);
    float s8 = regionValueSoft(uv, pixel, maxUv, vec2( r,  r), innerR, channel);

    float med = median9vals(s0, s1, s2, s3, s4, s5, s6, s7, s8);
    float avg9 = (s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8) / 9.0;
    float softness = 0.10 + 0.20 * smoothstep(4.0, 18.0, r);

    return mix(med, avg9, softness);
}

float hybridMedianChannel(vec2 uv, vec2 pixel, vec2 maxUv, float radiusPx, int channel)
{
    if (radiusPx <= 1.0)
    {
        return exactMedian9(uv, pixel, maxUv, channel);
    }
    else if (radiusPx <= 2.0)
    {
        return exactMedian25(uv, pixel, maxUv, channel);
    }
    else
    {
        return approxMedianChannel(uv, pixel, maxUv, radiusPx, channel);
    }
}

void main()
{
    vec4 center = texture2D(tDiffuse, vUvScaled);
    vec2 pixel = uvScale / resolution;
    vec2 maxUv = max(uvScale - pixel * 0.5, vec2(0.0));

    float radiusPx = floor(max(Radius, 0.0) + 0.5);

    if (radiusPx <= 0.0)
    {
        gl_FragColor = center;
        return;
    }

    float r = hybridMedianChannel(vUvScaled, pixel, maxUv, radiusPx, 0);
    float g = hybridMedianChannel(vUvScaled, pixel, maxUv, radiusPx, 1);
    float b = hybridMedianChannel(vUvScaled, pixel, maxUv, radiusPx, 2);

    float a = center.a;
    if (Operate_On_Alpha_Channel >= 0.5)
    {
        a = hybridMedianChannel(vUvScaled, pixel, maxUv, radiusPx, 3);
    }

    gl_FragColor = vec4(r, g, b, a);
}
