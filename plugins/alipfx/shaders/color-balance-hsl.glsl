precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform float Hue;
uniform float Lightness;
uniform float Saturation;

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
    float l = (maxc + minc) * 0.5;

    float d = maxc - minc;

    if (d > 0.000001)
    {
        s = d / (1.0 - abs(2.0 * l - 1.0));

        if (maxc == c.r)
        {
            h = mod((c.g - c.b) / d, 6.0);
        }
        else if (maxc == c.g)
        {
            h = ((c.b - c.r) / d) + 2.0;
        }
        else
        {
            h = ((c.r - c.g) / d) + 4.0;
        }

        h /= 6.0;

        if (h < 0.0) h += 1.0;
    }

    return vec3(h, l, s);
}

vec3 hsl2rgb(vec3 hsl)
{
    float h = hsl.x;
    float l = hsl.y;
    float s = hsl.z;

    float r, g, b;

    if (s <= 0.000001)
    {
        r = l;
        g = l;
        b = l;
    }
    else
    {
        float q = (l < 0.5) ? (l * (1.0 + s)) : (l + s - l * s);
        float p = 2.0 * l - q;

        r = hue2rgb(p, q, h + 1.0 / 3.0);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1.0 / 3.0);
    }

    return clamp(vec3(r, g, b), 0.0, 1.0);
}

void main()
{
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 rgb = clamp(texel.rgb, 0.0, 1.0);

    // Convert to HSL
    vec3 hsl = rgb2hsl(rgb);

    // 1) Hue: rotate around 360-degree wheel
    hsl.x = mod(hsl.x + Hue / 360.0, 1.0);
    if (hsl.x < 0.0) hsl.x += 1.0;

    // 2) Lightness: AE-style legacy HLS behavior is best approximated
    //    by directly offsetting HSL lightness in the range [-100, +100]
    hsl.y = clamp(hsl.y + Lightness / 100.0, 0.0, 1.0);

    // 3) Saturation: directly offset HSL saturation in the range [-100, +100]
    hsl.z = clamp(hsl.z + Saturation / 100.0, 0.0, 1.0);

    vec3 outRgb = hsl2rgb(hsl);

    gl_FragColor = vec4(outRgb, texel.a);
}
