precision highp float;
precision highp int;

// ---- Panzoid built-ins ----
uniform sampler2D tDiffuse;
uniform vec2      resolution;
varying vec2      vUvScaled;

// ---- AE Transform-style uniforms (12 parameters) ----
uniform vec2  Anchor_Point;                    // pixels (layer space)
uniform vec2  Position;                        // pixels (comp space)
uniform float Uniform_Scale;                   // 0 or 1
uniform float Scale_Height;                    // percent
uniform float Scale_Width;                     // percent
uniform float Skew;                            // degrees
uniform float Skew_Axis;                       // degrees
uniform float Rotation;                        // degrees
uniform float Opacity;                         // percent
uniform float Use_Composition_Shutter_Angle;   // kept for UI compatibility (no-op here)
uniform float Shutter_Angle;                   // kept for UI compatibility (no-op here)
uniform float Sampling;                        // 0: bilinear, 1: bicubic

// ------------------------------
// Helpers
// ------------------------------
float pctToFactor(float pct) { return pct * 0.01; }

// Mitchell-Netravali weights (B=C=1/3) — high quality bicubic
float mnWeight(float x) {
    const float B = 1.0/3.0;
    const float C = 1.0/3.0;
    float ax = abs(x);
    float ax2 = ax * ax;
    float ax3 = ax2 * ax;
    if (ax < 1.0) {
        return ((12.0 - 9.0*B - 6.0*C) * ax3 +
                (-18.0 + 12.0*B + 6.0*C) * ax2 +
                (6.0 - 2.0*B)) * ax;
    } else if (ax < 2.0) {
        return ((-B - 6.0*C) * ax3 +
                (6.0*B + 30.0*C) * ax2 +
                (-12.0*B - 48.0*C) * ax +
                (8.0*B + 24.0*C));
    }
    return 0.0;
}

vec4 sampleTexBilinear(vec2 uv01) {
    if (uv01.x < 0.0 || uv01.x > 1.0 || uv01.y < 0.0 || uv01.y > 1.0) return vec4(0.0);
    return texture2D(tDiffuse, uv01);
}

// True bicubic 16-tap (Mitchell-Netravali)
vec4 sampleBicubic(sampler2D tex, vec2 uv, vec2 texSize) {
    vec2 xy  = uv * texSize - 0.5;
    vec2 ixy = floor(xy);
    vec2 fxy = xy - ixy;

    vec4 col = vec4(0.0);
    float wSum = 0.0;

    for (int j = -1; j <= 2; ++j) {
        float wy = mnWeight(float(j) - fxy.y);
        float y  = (ixy.y + float(j)) / texSize.y;

        for (int i = -1; i <= 2; ++i) {
            float wx = mnWeight(float(i) - fxy.x);
            float x  = (ixy.x + float(i)) / texSize.x;

            float w = wx * wy;
            col += texture2D(tex, vec2(x, y)) * w;
            wSum += w;
        }
    }
    return col / wSum;
}

vec4 sampleTexHQ(vec2 uv01) {
    if (uv01.x < 0.0 || uv01.x > 1.0 || uv01.y < 0.0 || uv01.y > 1.0) return vec4(0.0);
    return sampleBicubic(tDiffuse, uv01, resolution);
}

// -----------------------------------------
// AE Position fix is implemented here:
//
// Forward AE-style (effect):
//   P_out = Position + R * Sh * S * (P_in - Anchor)
//
// Inverse used for sampling:
//   P_in = Anchor + S^-1 * Sh^-1 * R^-1 * (P_out - Position)
// -----------------------------------------
vec2 inverseMapPixel_AE(
    vec2 P_out,
    vec2 anchor,
    vec2 position,
    float scaleH_pct,
    float scaleW_pct,
    float uniformScale,
    float skewDeg,
    float skewAxisDeg,
    float rotationDeg
) {
    // Scale factors
    float sY = pctToFactor(scaleH_pct);
    float sX = (uniformScale >= 0.5) ? sY : pctToFactor(scaleW_pct);

    // Common fast path: no scale/rot/skew
    bool noRot  = abs(rotationDeg) < 1e-6;
    bool noSkew = abs(skewDeg)     < 1e-6;
    bool unitScale = (abs(sX - 1.0) < 1e-6) && (abs(sY - 1.0) < 1e-6);

    if (noRot && noSkew && unitScale) {
        // With AE mapping:
        // P_in = P_out - Position + Anchor
        return P_out - position + anchor;
    }

    // AE FIX: subtract ONLY Position (not Position+Anchor)
    vec2 p = P_out - position;

    // Inverse rotation (R^-1 = R(-rot))
    float rr = radians(-rotationDeg);
    float cr = cos(rr), sr = sin(rr);
    p = vec2(cr*p.x - sr*p.y, sr*p.x + cr*p.y);

    // Inverse skew about axis: R(axis) * Shx(-k) * R(-axis)
    if (!noSkew) {
        float k  = -tan(radians(skewDeg));
        float aa = radians(skewAxisDeg);
        float ca = cos(aa), sa = sin(aa);

        // q = R(-axis) * p
        vec2 q = vec2( ca*p.x + sa*p.y,
                      -sa*p.x + ca*p.y );

        // shear in x
        q.x = q.x + k * q.y;

        // p = R(axis) * q
        p = vec2( ca*q.x - sa*q.y,
                  sa*q.x + ca*q.y );
    }

    // Inverse scale
    float inv_sX = (abs(sX) > 1e-6) ? (1.0 / sX) : 0.0;
    float inv_sY = (abs(sY) > 1e-6) ? (1.0 / sY) : 0.0;
    p *= vec2(inv_sX, inv_sY);

    // Add Anchor at the end (AE)
    return p + anchor;
}

void main() {
    // Opacity early-out
    float op = clamp(Opacity * 0.01, 0.0, 1.0);
    if (op <= 0.00001) {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Output pixel in comp/layer pixel space
    vec2 P_out = vUvScaled * resolution;

    // Inverse map to source pixel using AE-correct Position behavior
    vec2 P_in = inverseMapPixel_AE(
        P_out,
        Anchor_Point,
        Position,
        Scale_Height,
        Scale_Width,
        Uniform_Scale,
        Skew,
        Skew_Axis,
        Rotation
    );

    vec2 uv_src = P_in / resolution;

    // Sampling mode
    vec4 color = (Sampling >= 0.5) ? sampleTexHQ(uv_src) : sampleTexBilinear(uv_src);

    // Apply opacity AE-style
    color.rgb *= op;
    color.a   *= op;

    gl_FragColor = color;
}
