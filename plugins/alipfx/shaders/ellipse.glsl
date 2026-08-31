precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;

varying vec2 vUv;
varying vec2 vUvScaled;

// ---- Custom properties (spaces become underscores) ----
uniform vec2 Center;                 // pixels, AE-style (top-left origin, Y down)
uniform float Width;                 // pixels
uniform float Height;                // pixels
uniform float Thickness;             // pixels (stroke width centered on ellipse boundary)
uniform float Softness;              // percent 0..100
uniform vec3 Inside_Color;           // inner edge color of ring / fill color
uniform vec3 Outside_Color;          // OUTER edge (outline) color of ring
uniform float Composite_On_Original; // 0 or 1

float sdEllipseImplicit(vec2 p, vec2 r)
{
    r = max(r, vec2(1e-4));
    float a2 = r.x * r.x;
    float b2 = r.y * r.y;

    float F = (p.x * p.x) / a2 + (p.y * p.y) / b2 - 1.0;
    vec2 g = vec2(2.0 * p.x / a2, 2.0 * p.y / b2);

    return F / max(length(g), 1e-6);
}

float aaPx() { return 1.0; }

float maskRing(float sd, float halfThicknessPx, float featherPx)
{
    float f = max(featherPx, aaPx());
    float d = abs(sd);
    return 1.0 - smoothstep(halfThicknessPx, halfThicknessPx + f, d);
}

float maskFill(float sd, float featherPx)
{
    float f = max(featherPx, aaPx());
    return 1.0 - smoothstep(0.0, f, sd);
}

void main()
{
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    vec2 pixelPos = vUv * resolution;
    vec2 centerPx = vec2(Center.x, resolution.y - Center.y);

    vec2 radii = 0.5 * vec2(Width, Height);
    vec2 p = pixelPos - centerPx;

    float sd = sdEllipseImplicit(p, radii);

    float t = max(Thickness, 0.0);
    float halfT = 0.5 * t;

    // --- Softness as % of Thickness (0..100) ---
    float s01 = clamp(Softness * 0.01, 0.0, 1.0);
    float featherRingPx = s01 * Thickness; // <-- % of Thickness (A)

    // Fill softness can remain size-based (your original behavior)
    float featherFillPx = s01 * max(min(radii.x, radii.y), 1.0);

    vec3 shapeRGB = vec3(0.0);
    float shapeA = 0.0;

    if (t > 0.0)
    {
        shapeA = maskRing(sd, halfT, featherRingPx);

        float u = clamp((sd + halfT) / max(t, 1e-6), 0.0, 1.0);

        const float OUTLINE_BIAS = 3.0;
        float ub = pow(u, OUTLINE_BIAS);

        shapeRGB = mix(Inside_Color, Outside_Color, ub);
    }
    else
    {
        shapeA = maskFill(sd, featherFillPx);
        shapeRGB = Inside_Color;
    }

    vec3 outRGB;
    float outA;

    if (Composite_On_Original >= 0.5)
    {
        outRGB = mix(texel.rgb, shapeRGB, shapeA);
        outA = max(texel.a, shapeA);
    }
    else
    {
        outRGB = shapeRGB;
        outA = shapeA;
    }

    gl_FragColor = vec4(outRGB, outA);
}
