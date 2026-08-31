precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

uniform float Intensity;
uniform float Threshold;
uniform float SoftKnee;
uniform float Streaks;
uniform float Chromatic;
uniform float Saturation;
uniform float Vignette;

uniform float Gamma_Correction;
uniform float Scene_Gamma;

uniform float Aspect_Ratio;
uniform float Aspect_Angle;

uniform vec3 Color_Inner;
uniform vec3 Color_Outer;
uniform float Tint_Mode;
uniform float Tint_Blend_Mode;

float luma(vec3 c)
{
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float satf(float x)
{
    return clamp(x, 0.0, 1.0);
}

vec3 toLinear(vec3 c)
{
    float g = max(Scene_Gamma, 0.0001);
    return pow(max(c, 0.0), vec3(g));
}

vec3 toGamma(vec3 c)
{
    float g = max(Scene_Gamma, 0.0001);
    return pow(max(c, 0.0), vec3(1.0 / g));
}

vec3 sampleLinear(vec2 uv)
{
    vec3 c = texture2D(tDiffuse, uv).rgb;
    float gc = satf(Gamma_Correction / 100.0);
    return mix(c, toLinear(c), gc);
}

vec3 brightPass(vec3 c)
{
    float y = luma(c);
    float knee = max(SoftKnee, 0.0001);
    float m = smoothstep(Threshold - knee, Threshold + knee, y);
    return max(c - vec3(Threshold), 0.0) * m;
}

vec3 saturateColor(vec3 c, float s)
{
    float y = luma(c);
    return mix(vec3(y), c, s);
}

vec3 blendMultiply(vec3 base, vec3 blend)
{
    return base * blend;
}

vec3 blendOverlay(vec3 base, vec3 blend)
{
    vec3 low = 2.0 * base * blend;
    vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
    return mix(low, high, step(vec3(0.5), base));
}

vec3 blendSoftLight(vec3 base, vec3 blend)
{
    vec3 d = step(vec3(0.5), blend);
    vec3 low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
    vec3 high = base + (2.0 * blend - 1.0) * (sqrt(max(base, 0.0)) - base);
    return mix(low, high, d);
}

vec3 applyTintBlend(vec3 glow, vec3 tint)
{
    if (Tint_Blend_Mode < 0.5)
    {
        return blendMultiply(glow, tint);
    }
    else if (Tint_Blend_Mode < 1.5)
    {
        return blendOverlay(glow, tint);
    }
    return blendSoftLight(glow, tint);
}

vec3 getTintColor(float distNorm)
{
    if (Tint_Mode < 0.5)
    {
        return vec3(1.0);
    }
    else if (Tint_Mode < 1.5)
    {
        return clamp((Color_Inner + Color_Outer) * 0.5, 0.0, 1.0);
    }
    return mix(clamp(Color_Inner, 0.0, 1.0), clamp(Color_Outer, 0.0, 1.0), satf(distNorm));
}

vec2 rotateVec(vec2 d, float angleRad)
{
    float s = sin(angleRad);
    float c = cos(angleRad);
    return vec2(
        c * d.x - s * d.y,
        s * d.x + c * d.y
    );
}

// Stretch in local kernel space, then rotate in 2D (Z-style rotation)
vec2 orientOffset(vec2 d)
{
    float a = radians(Aspect_Angle);
    float ar = max(Aspect_Ratio, 0.0001);

    d.x *= ar;
    return rotateVec(d, a);
}

vec2 perp(vec2 v)
{
    return vec2(-v.y, v.x);
}

vec3 tintedGlow(vec3 glow, float distNorm)
{
    if (Tint_Mode < 0.5)
    {
        return glow;
    }

    vec3 tint = getTintColor(distNorm);
    return applyTintBlend(glow, tint);
}

vec2 safeDir(vec2 v)
{
    float lenV = length(v);
    if (lenV < 0.0001)
    {
        return vec2(1.0, 0.0);
    }
    return v / lenV;
}

vec3 chromaticBrightPass(vec2 uv, vec2 ca)
{
    vec3 normal = brightPass(sampleLinear(uv));

    float c = satf(Chromatic);
    if (c <= 0.0001)
    {
        return normal;
    }

    vec3 split;
    split.r = brightPass(sampleLinear(uv + ca)).r;
    split.g = normal.g;
    split.b = brightPass(sampleLinear(uv - ca)).b;

    return mix(normal, split, c);
}

void main()
{
    vec2 uv = vUvScaled;
    vec2 px = 1.0 / max(resolution, vec2(1.0));

    vec4 centerTex = texture2D(tDiffuse, uv);
    float gc = satf(Gamma_Correction / 100.0);
    vec3 center = mix(centerTex.rgb, toLinear(centerTex.rgb), gc);

    float spread = 2.5;

    vec2 o1 = orientOffset(px * spread * 1.0);
    vec2 o2 = orientOffset(px * spread * 2.0);
    vec2 o3 = orientOffset(px * spread * 3.5);

    vec2 p1 = perp(o1);
    vec2 p2 = perp(o2);
    vec2 p3 = perp(o3);

    vec3 bloom = vec3(0.0);
    vec3 streak = vec3(0.0);

    vec2 caDir = safeDir(uv - vec2(0.5));
    vec2 caBase = orientOffset(caDir * px * (2.0 + spread) * 2.5);

    // Rotated 4-direction bloom kernel
    bloom += chromaticBrightPass(uv + o1, caBase * 0.6) * 0.18;
    bloom += chromaticBrightPass(uv - o1, caBase * 0.6) * 0.18;
    bloom += chromaticBrightPass(uv + p1, caBase * 0.6) * 0.18;
    bloom += chromaticBrightPass(uv - p1, caBase * 0.6) * 0.18;

    bloom += chromaticBrightPass(uv + o2, caBase * 1.0) * 0.13;
    bloom += chromaticBrightPass(uv - o2, caBase * 1.0) * 0.13;
    bloom += chromaticBrightPass(uv + p2, caBase * 1.0) * 0.13;
    bloom += chromaticBrightPass(uv - p2, caBase * 1.0) * 0.13;

    bloom += chromaticBrightPass(uv + o3, caBase * 1.4) * 0.08;
    bloom += chromaticBrightPass(uv - o3, caBase * 1.4) * 0.08;
    bloom += chromaticBrightPass(uv + p3, caBase * 1.4) * 0.08;
    bloom += chromaticBrightPass(uv - p3, caBase * 1.4) * 0.08;

    float streakAmt = max(Streaks, 0.0);
    if (streakAmt > 0.0)
    {
        vec2 sx = orientOffset(px * spread * 6.0);
        vec2 sy = orientOffset(px * spread * 4.0);
        vec2 psx = perp(sx);
        vec2 psy = perp(sy);

        streak += chromaticBrightPass(uv + sx, caBase * 2.0) * 0.20;
        streak += chromaticBrightPass(uv - sx, caBase * 2.0) * 0.20;
        streak += chromaticBrightPass(uv + psx, caBase * 2.0) * 0.20;
        streak += chromaticBrightPass(uv - psx, caBase * 2.0) * 0.20;

        streak += chromaticBrightPass(uv + sy, caBase * 2.0) * 0.12;
        streak += chromaticBrightPass(uv - sy, caBase * 2.0) * 0.12;
        streak += chromaticBrightPass(uv + psy, caBase * 2.0) * 0.12;
        streak += chromaticBrightPass(uv - psy, caBase * 2.0) * 0.12;
    }

    vec3 glow = bloom + streak * streakAmt;
    glow = glow * max(Intensity, 0.0);

    float distNorm = 0.65;
    vec3 tinted = tintedGlow(glow, distNorm);

    tinted = tinted / (1.0 + tinted);

    vec3 outCol = center + tinted * 1.8;

    outCol = saturateColor(outCol, max(Saturation, 0.0));

    vec2 p = vUv - 0.5;
    float vig = 1.0 - max(Vignette, 0.0) * smoothstep(0.08, 0.80, dot(p, p));
    outCol *= vig;

    outCol = mix(outCol, toGamma(outCol), gc);
    outCol = clamp(outCol, 0.0, 1.0);

    gl_FragColor = vec4(outCol, centerTex.a);
}
