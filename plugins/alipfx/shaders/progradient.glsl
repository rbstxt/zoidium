precision highp float;
precision highp int;

// Built-in Panzoid variables — always declare as-is
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom properties — guarded so they work as static (#define) or dynamic (uniform)
#ifndef Gradient_Type
uniform float Gradient_Type;
#endif
#ifndef Magnet_Perpendicular
uniform float Magnet_Perpendicular;
#endif
#ifndef Transparent_After_Max_Length
uniform float Transparent_After_Max_Length;
#endif
#ifndef Max_Length
uniform float Max_Length;
#endif
#ifndef Gradient_Color_Space
uniform float Gradient_Color_Space;
#endif
#ifndef Gradient_Hue_Interpolation
uniform float Gradient_Hue_Interpolation;
#endif
#ifndef Color_1
uniform vec3 Color_1;
#endif
#ifndef Color_2
uniform vec3 Color_2;
#endif
#ifndef Gradient_Colors
uniform float Gradient_Colors;
#endif
#ifndef Color_3
uniform vec3 Color_3;
#endif
#ifndef Color_4
uniform vec3 Color_4;
#endif
#ifndef Color_5
uniform vec3 Color_5;
#endif
#ifndef Color_6
uniform vec3 Color_6;
#endif
#ifndef Color_7
uniform vec3 Color_7;
#endif
#ifndef Color_8
uniform vec3 Color_8;
#endif
#ifndef Gradient_Offset
uniform float Gradient_Offset;
#endif
#ifndef Gradient_Scale
uniform float Gradient_Scale;
#endif
#ifndef Gradient_Loop
uniform float Gradient_Loop;
#endif
#ifndef Gradient_Reflect
uniform float Gradient_Reflect;
#endif
#ifndef Gradient_Invert
uniform float Gradient_Invert;
#endif
#ifndef Scattering_Value
uniform float Scattering_Value;
#endif
#ifndef Scattering_Fix_Loop_Edge
uniform float Scattering_Fix_Loop_Edge;
#endif
#ifndef Scattering_Seed
uniform float Scattering_Seed;
#endif
#ifndef Stripes_Enabled
uniform float Stripes_Enabled;
#endif
#ifndef Stripes_Max_Offset
uniform float Stripes_Max_Offset;
#endif
#ifndef Stripes_Perpendicular_Offset
uniform float Stripes_Perpendicular_Offset;
#endif
#ifndef Stripes_Width
uniform float Stripes_Width;
#endif
#ifndef Stripes_Seed
uniform float Stripes_Seed;
#endif
#ifndef Opacity_Left
uniform float Opacity_Left;
#endif
#ifndef Opacity_Right
uniform float Opacity_Right;
#endif
#ifndef Opacity_Offset
uniform float Opacity_Offset;
#endif
#ifndef Opacity_Scale
uniform float Opacity_Scale;
#endif
#ifndef Opacity_Loop
uniform float Opacity_Loop;
#endif
#ifndef Definition_Mode
uniform float Definition_Mode;
#endif
#ifndef Start
uniform vec2 Start;
#endif
#ifndef End
uniform vec2 End;
#endif
#ifndef Orientation
uniform float Orientation;
#endif
#ifndef Start_Part
uniform float Start_Part;
#endif
#ifndef End_Part
uniform float End_Part;
#endif
#ifndef Angle
uniform float Angle;
#endif
#ifndef Center_X_Part
uniform float Center_X_Part;
#endif
#ifndef Center_Y_Part
uniform float Center_Y_Part;
#endif
#ifndef Radius_Part
uniform float Radius_Part;
#endif
#ifndef Start_Angle
uniform float Start_Angle;
#endif
#ifndef Color_Mode
uniform float Color_Mode;
#endif
#ifndef Opacity_Mode
uniform float Opacity_Mode;
#endif
#ifndef Anti_Aliasing
uniform float Anti_Aliasing;
#endif

const float PI = 3.14159265;

float hash11(float p, float s) {
    return fract(sin(p * 12.9898 + s * 78.233) * 43758.5);
}

float hash21(vec2 p, float s) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(sin(dot(p, vec2(12.99, 78.23)) + s) * 43758.5);
}

vec3 rgb2ok(vec3 c) {
    float l = 0.4122 * c.r + 0.5363 * c.g + 0.0514 * c.b;
    float m = 0.2119 * c.r + 0.6807 * c.g + 0.1074 * c.b;
    float s = 0.0883 * c.r + 0.2817 * c.g + 0.63 * c.b;
    l = pow(l, 0.333);
    m = pow(m, 0.333);
    s = pow(s, 0.333);
    return vec3(0.2104 * l + 0.7936 * m - 0.00407 * s,
                  1.978 * l - 2.4286 * m + 0.4506 * s,
                  0.0259 * l + 0.7828 * m - 0.8087 * s);
}

vec3 ok2rgb(vec3 c) {
    float l = c.x + 0.3963 * c.y + 0.2158 * c.z;
    float m = c.x - 0.1056 * c.y - 0.06385 * c.z;
    float s = c.x - 0.0895 * c.y - 1.2915 * c.z;
    l = l * l * l;
    m = m * m * m;
    s = s * s * s;
    return vec3(4.0767 * l - 3.3077 * m + 0.231 * s,
                -1.2684 * l + 2.6098 * m - 0.3413 * s,
                -0.0042 * l - 0.7034 * m + 1.7076 * s);
}

vec3 toLch(vec3 l) {
    return vec3(l.x, length(l.yz), atan(l.z, l.y));
}

vec3 fromLch(vec3 l) {
    return vec3(l.x, l.y * cos(l.z), l.y * sin(l.z));
}

float hueDiff(float a, float b, float m) {
    float d = b - a;
    d = mod(d + PI, 6.28318) - PI;
    if (m < 0.5) return d;
    if (m < 1.5) return d - sign(d) * 6.28318;
    if (m < 2.5) return d > 0.0 ? d - 6.28318 : d;
    return d < 0.0 ? d + 6.28318 : d;
}

vec3 mixColor(vec3 a, vec3 b, float t, float s, float h) {
    if (s < 0.5) return mix(a, b, t);
    vec3 l1 = rgb2ok(a), l2 = rgb2ok(b);
    if (s < 1.5) return clamp(ok2rgb(mix(l1, l2, t)), 0.0, 1.0);
    vec3 c1 = toLch(l1), c2 = toLch(l2);
    float hh = c1.z + hueDiff(c1.z, c2.z, h) * t;
    return clamp(ok2rgb(fromLch(vec3(mix(c1.x, c2.x, t), mix(c1.y, c2.y, t), hh))), 0.0, 1.0);
}

vec3 getGradientColor(float t, float s, float h) {
    int n = int(Gradient_Colors + 0.5);
    if (n <= 2) return mixColor(Color_1, Color_2, t, s, h);
    if (n == 3) {
        if (t < 0.5) return mixColor(Color_1, Color_2, t * 2.0, s, h);
        return mixColor(Color_2, Color_3, (t - 0.5) * 2.0, s, h);
    }
    if (n == 4) {
        if (t < 0.33333) return mixColor(Color_1, Color_2, t * 3.0, s, h);
        if (t < 0.66666) return mixColor(Color_2, Color_3, (t - 0.33333) * 3.0, s, h);
        return mixColor(Color_3, Color_4, (t - 0.66666) * 3.0, s, h);
    }
    if (n == 5) {
        if (t < 0.25) return mixColor(Color_1, Color_2, t * 4.0, s, h);
        if (t < 0.5) return mixColor(Color_2, Color_3, (t - 0.25) * 4.0, s, h);
        if (t < 0.75) return mixColor(Color_3, Color_4, (t - 0.5) * 4.0, s, h);
        return mixColor(Color_4, Color_5, (t - 0.75) * 4.0, s, h);
    }
    if (n == 6) {
        if (t < 0.2) return mixColor(Color_1, Color_2, t * 5.0, s, h);
        if (t < 0.4) return mixColor(Color_2, Color_3, (t - 0.2) * 5.0, s, h);
        if (t < 0.6) return mixColor(Color_3, Color_4, (t - 0.4) * 5.0, s, h);
        if (t < 0.8) return mixColor(Color_4, Color_5, (t - 0.6) * 5.0, s, h);
        return mixColor(Color_5, Color_6, (t - 0.8) * 5.0, s, h);
    }
    if (n == 7) {
        if (t < 0.16666) return mixColor(Color_1, Color_2, t * 6.0, s, h);
        if (t < 0.33333) return mixColor(Color_2, Color_3, (t - 0.16666) * 6.0, s, h);
        if (t < 0.5) return mixColor(Color_3, Color_4, (t - 0.33333) * 6.0, s, h);
        if (t < 0.66666) return mixColor(Color_4, Color_5, (t - 0.5) * 6.0, s, h);
        if (t < 0.83333) return mixColor(Color_5, Color_6, (t - 0.66666) * 6.0, s, h);
        return mixColor(Color_6, Color_7, (t - 0.83333) * 6.0, s, h);
    }
    if (t < 0.14285) return mixColor(Color_1, Color_2, t * 7.0, s, h);
    if (t < 0.28571) return mixColor(Color_2, Color_3, (t - 0.14285) * 7.0, s, h);
    if (t < 0.42857) return mixColor(Color_3, Color_4, (t - 0.28571) * 7.0, s, h);
    if (t < 0.57142) return mixColor(Color_4, Color_5, (t - 0.42857) * 7.0, s, h);
    if (t < 0.71428) return mixColor(Color_5, Color_6, (t - 0.57142) * 7.0, s, h);
    if (t < 0.85714) return mixColor(Color_6, Color_7, (t - 0.71428) * 7.0, s, h);
    return mixColor(Color_7, Color_8, (t - 0.85714) * 7.0, s, h);
}

float loopRef(float t) {
    if (Gradient_Reflect > 0.5) t = 1.0 - abs(mod(t, 2.0) - 1.0);
    if (Gradient_Loop > 0.5) t = fract(t);
    return t;
}

float loopRefOp(float t) {
    if (Opacity_Loop > 0.5) t = fract(t);
    return t;
}

void getDef(out vec2 p1, out vec2 p2, out vec2 c, out float r) {
    if (Definition_Mode < 0.5) {
        p1 = Start;
        p2 = End;
        c = (p1 + p2) * 0.5;
        r = distance(p1, p2) * 0.5;
    } else {
        float a = radians(Angle);
        vec2 d = vec2(cos(a), sin(a));
        if (Orientation > 0.5) d = vec2(-d.y, d.x);
        p1 = 0.5 + d * (Start_Part - 0.5);
        p2 = 0.5 + d * (End_Part - 0.5);
        c = vec2(Center_X_Part, Center_Y_Part);
        r = Radius_Part;
    }
}

float gT(vec2 uv, out float forceTransparent) {
    vec2 p1, p2, c;
    float r;
    getDef(p1, p2, c, r);
    int gt = int(Gradient_Type + 0.5);
    forceTransparent = 0.0;

    // Compute base gradient value first
    float t = 0.0;
    if (gt == 0) {
        vec2 d = p2 - p1;
        t = dot(uv - p1, d) / max(dot(d, d), 1e-6);
    } else if (gt == 1) {
        t = distance(uv, c) / max(r, 1e-5);
    } else if (gt == 2) {
        t = fract((atan(uv.y - c.y, uv.x - c.x) - radians(Start_Angle)) / 6.28318);
    } else if (gt == 3) {
        vec2 a = uv - p1, b = uv - p2;
        if (Magnet_Perpendicular < 0.5) {
            float d = atan(a.y, a.x) - atan(b.y, b.x);
            d = mod(d + PI, 6.28318) - PI;
            t = d / 6.28318 + 0.5;
        } else {
            t = log(max(length(a), 1e-5) / max(length(b), 1e-5)) / 4.0 + 0.5;
        }
    } else {
        // =====================================================================
        // CONTOUR MODE: auto-detects alpha boundary vs full-layer UV border
        // =====================================================================
        float myAlpha = texture2D(tDiffuse, vUvScaled).a;
        vec2 px = 1.0 / resolution;
        float maxR = max(Max_Length * min(resolution.x, resolution.y) * 0.5, 1.0);
        float bestDist = maxR;
        bool foundEdge = false;

        if (myAlpha < 0.01) {
            bestDist = 0.0;
            foundEdge = true;
        } else {
            vec2 dirs[8];
            dirs[0] = vec2(1.0, 0.0);
            dirs[1] = vec2(-1.0, 0.0);
            dirs[2] = vec2(0.0, 1.0);
            dirs[3] = vec2(0.0, -1.0);
            dirs[4] = normalize(vec2(1.0, 1.0));
            dirs[5] = normalize(vec2(-1.0, 1.0));
            dirs[6] = normalize(vec2(1.0, -1.0));
            dirs[7] = normalize(vec2(-1.0, -1.0));

            for (int i = 0; i < 8; i++) {
                for (int j = 1; j <= 8; j++) {
                    float dist = float(j) * maxR / 8.0;
                    vec2 off = dirs[i] * dist * px;
                    float sa = texture2D(tDiffuse, vUvScaled + off).a;
                    if (sa < 0.5) {
                        bestDist = min(bestDist, dist);
                        foundEdge = true;
                        break;
                    }
                }
            }
        }

        if (foundEdge) {
            // Shape / text / mask mode: distance from alpha boundary
            t = 1.0 - clamp(bestDist / maxR, 0.0, 1.0);
            if (Transparent_After_Max_Length > 0.5 && bestDist >= maxR)
                forceTransparent = 1.0;
        } else {
            // Full layer / adjustment layer mode: distance from UV border
            float uvDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * 2.0;
            t = 1.0 - clamp(uvDist / max(Max_Length, 1e-4), 0.0, 1.0);
            if (Transparent_After_Max_Length > 0.5 && uvDist > Max_Length)
                forceTransparent = 1.0;
        }
    }

    // --- STRIPES: slice into discrete stripes and offset along gradient direction ---
    if (Stripes_Enabled > 0.5 && gt != 4) {
        float px = 0.0;

        if (gt == 0) {
            vec2 dir = normalize(p2 - p1 + 1e-5);
            vec2 pr_px = normalize(vec2(-dir.y * resolution.y, dir.x * resolution.x));
            px = dot((uv - 0.5) * resolution, pr_px);
        } else if (gt == 1) {
            px = length((uv - c) * resolution);
        } else if (gt == 2) {
            px = length((uv - c) * resolution);
        } else if (gt == 3) {
            px = t * min(resolution.x, resolution.y);
        }

        px += Stripes_Perpendicular_Offset;
        float id = floor(px / max(Stripes_Width, 1.0));
        float so = (hash11(id, Stripes_Seed) - 0.5) * Stripes_Max_Offset;
        t += so;
    }

    t = (t - Gradient_Offset) / max(Gradient_Scale, 1e-4);

    if (Scattering_Value > 0.0) {
        float n = hash21(uv * 512.0, Scattering_Seed) - 0.5;
        if (Scattering_Fix_Loop_Edge > 0.5 && Gradient_Loop > 0.5)
            n *= smoothstep(0.0, 0.02, fract(t)) * smoothstep(0.0, 0.02, 1.0 - fract(t));
        t += n * Scattering_Value;
    }

    return loopRef(t) * (Gradient_Invert > 0.5 ? -1.0 : 1.0) + (Gradient_Invert > 0.5 ? 1.0 : 0.0);
}

void main() {
    vec2 uv = vUv;
    vec4 b = texture2D(tDiffuse, vUvScaled);
    float forceTransparent = 0.0;
    float t = gT(uv, forceTransparent);
    float tc = clamp(t, 0.0, 1.0);

    vec3 col = getGradientColor(tc, Gradient_Color_Space, Gradient_Hue_Interpolation);

    float ot = (t - Opacity_Offset) / max(Opacity_Scale, 1e-4);
    ot = loopRefOp(ot);
    float a = mix(Opacity_Left, Opacity_Right, clamp(ot, 0.0, 1.0));

    if (forceTransparent > 0.5) a = 0.0;

    vec3 o = col;
    if (Color_Mode > 0.5)
        o = (Color_Mode < 1.5) ? clamp(b.rgb + col * a, 0.0, 1.0) : b.rgb * mix(vec3(1.0), col, a);

    float oa = (Opacity_Mode < 0.5) ? a : b.a * a;
    if (Color_Mode < 0.5 && Opacity_Mode > 0.5) {
        o = mix(b.rgb, col, a);
        oa = mix(b.a, 1.0, a);
    }

    // Mask final output by input alpha so transparent pixels stay transparent
    gl_FragColor = vec4(o, oa * b.a);
}
