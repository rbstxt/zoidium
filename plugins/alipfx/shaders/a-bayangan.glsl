precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

uniform vec3 Color;
uniform float Opacity;           // 0..100
uniform float Softness;          // pixels
uniform float Distance;          // pixels
uniform float Angle;             // degrees
uniform float Unmult;            // 0/1
uniform float Invert;            // 0/1
uniform float Composite_Order;   // 0 = In Front, 1 = Behind
uniform float Colorize;          // 0/1
uniform float Master_Hue;        // degrees
uniform float Master_Saturation; // percent
uniform float Master_Lightness;  // percent

float hue2rgb(float p, float q, float t)
{
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0 / 2.0) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
}

vec3 rgb2hsl(vec3 c)
{
    float maxc = max(max(c.r, c.g), c.b);
    float minc = min(min(c.r, c.g), c.b);
    float h = 0.0;
    float s = 0.0;
    float l = 0.5 * (maxc + minc);
    float d = maxc - minc;

    if (d > 1e-6)
    {
        s = (l > 0.5) ? (d / (2.0 - maxc - minc)) : (d / (maxc + minc));

        if (maxc == c.r)
            h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        else if (maxc == c.g)
            h = (c.b - c.r) / d + 2.0;
        else
            h = (c.r - c.g) / d + 4.0;

        h /= 6.0;
    }

    return vec3(h, s, l);
}

vec3 hsl2rgb(vec3 hsl)
{
    float h = fract(hsl.x);
    float s = clamp(hsl.y, 0.0, 1.0);
    float l = clamp(hsl.z, 0.0, 1.0);

    if (s <= 1e-6)
    {
        return vec3(l);
    }

    float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
    float p = 2.0 * l - q;

    return vec3(
        hue2rgb(p, q, h + 1.0 / 3.0),
        hue2rgb(p, q, h),
        hue2rgb(p, q, h - 1.0 / 3.0)
    );
}

vec4 readTex(vec2 uv)
{
    vec4 c = texture2D(tDiffuse, uv);
    if (Unmult > 0.5 && c.a > 1e-6)
    {
        c.rgb /= c.a;
    }
    return c;
}

float alphaAt(vec2 uv)
{
    return readTex(uv).a;
}

float blurredAlpha(vec2 uv, float radiusPx)
{
    vec2 o = max(radiusPx, 0.0) / resolution;

    float sum = 0.0;
    float w = 0.0;

    sum += alphaAt(uv) * 0.18; w += 0.18;

    sum += alphaAt(uv + vec2( 1.0,  0.0) * o) * 0.08; w += 0.08;
    sum += alphaAt(uv + vec2(-1.0,  0.0) * o) * 0.08; w += 0.08;
    sum += alphaAt(uv + vec2( 0.0,  1.0) * o) * 0.08; w += 0.08;
    sum += alphaAt(uv + vec2( 0.0, -1.0) * o) * 0.08; w += 0.08;

    sum += alphaAt(uv + vec2( 1.0,  1.0) * o) * 0.07; w += 0.07;
    sum += alphaAt(uv + vec2(-1.0,  1.0) * o) * 0.07; w += 0.07;
    sum += alphaAt(uv + vec2( 1.0, -1.0) * o) * 0.07; w += 0.07;
    sum += alphaAt(uv + vec2(-1.0, -1.0) * o) * 0.07; w += 0.07;

    sum += alphaAt(uv + vec2( 2.0,  0.0) * o) * 0.05; w += 0.05;
    sum += alphaAt(uv + vec2(-2.0,  0.0) * o) * 0.05; w += 0.05;
    sum += alphaAt(uv + vec2( 0.0,  2.0) * o) * 0.05; w += 0.05;
    sum += alphaAt(uv + vec2( 0.0, -2.0) * o) * 0.05; w += 0.05;

    return sum / w;
}

vec3 applyColorize(vec3 base)
{
    if (Colorize < 0.5)
    {
        return base;
    }

    vec3 hsl = rgb2hsl(base);
    
    // -- AFTER EFFECTS COLORIZE LOGIC --
    hsl.x = fract(Master_Hue / 360.0);
    hsl.y = clamp(Master_Saturation / 100.0, 0.0, 1.0);
    hsl.z = clamp(hsl.z + (Master_Lightness / 100.0), 0.0, 1.0);

    return hsl2rgb(hsl);
}

vec4 overStraight(vec4 top, vec4 bottom)
{
    float outA = top.a + bottom.a * (1.0 - top.a);

    vec3 topP = top.rgb * top.a;
    vec3 bottomP = bottom.rgb * bottom.a;

    vec3 outP = topP + bottomP * (1.0 - top.a);
    vec3 outRGB = (outA > 1e-6) ? (outP / outA) : vec3(0.0);

    return vec4(outRGB, outA);
}

void main()
{
    vec2 uv = vUvScaled;

    vec4 src = readTex(uv);

    float ang = radians(Angle);
    vec2 dir = vec2(cos(ang), -sin(ang));
    vec2 shadowUV = uv - dir * (Distance / resolution);

    float op = clamp(Opacity / 100.0, 0.0, 1.0);

    float srcA   = src.a;
    float shMask = clamp(blurredAlpha(shadowUV, Softness), 0.0, 1.0);
    float shA    = shMask * op;

    vec3 srcBaseRGB = src.rgb;
    vec3 shBaseRGB  = readTex(shadowUV).rgb;

    vec3 srcColorRGB = applyColorize(srcBaseRGB);
    vec3 shColorRGB  = applyColorize(shBaseRGB);

    vec4 srcNormal    = vec4(srcBaseRGB, srcA);
    vec4 srcColorized = vec4(srcColorRGB, srcA);

    // back darkening uses opacity as 0 -> 100 color mix
    vec4 srcDark      = vec4(mix(srcBaseRGB, Color, op), srcA);

    vec4 shOriginal   = vec4(shBaseRGB, shA);
    vec4 shColorized  = vec4(shColorRGB, shA);
    vec4 shDark       = vec4(Color, shA);

    // special front for Invert ON + In Front:
    // stays colorized and does NOT fade with Opacity
    vec4 shFrontColor = vec4(shColorRGB, shMask);

    vec4 outCol;

    if (Composite_Order < 0.5)
    {
        // 0 = In Front
        //
        // Invert OFF:
        //   front = dark shadow
        //   back  = colorized source
        //
        // Invert ON:
        //   front = colorized shadow
        //   back  = dark source (affected by Opacity 0..100)

        if (Invert < 0.5)
        {
            outCol = overStraight(shDark, srcColorized);
        }
        else
        {
            outCol = overStraight(shFrontColor, srcDark);
        }
    }
    else
    {
        // 1 = Behind
        //
        // Invert OFF:
        //   front = normal source
        //   back  = colorized shadow
        //
        // Invert ON:
        //   front = colorized source
        //   back  = original / non-dark shadow

        if (Invert < 0.5)
        {
            outCol = overStraight(srcNormal, shColorized);
        }
        else
        {
            outCol = overStraight(srcColorized, shOriginal);
        }
    }

    gl_FragColor = outCol;
}
