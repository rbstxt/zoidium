precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;

// Panzoid custom properties (dynamic numbers)
uniform float Warp_Style;               // 0..14 (integer-like)
uniform float Warp_Axis;                // 0..1  (0=Horizontal, 1=Vertical)
uniform float Bend;                     // -100..100
uniform float Horizontal_Distortion;    // -100..100
uniform float Vertical_Distortion;      // -100..100

const float PI = 3.14159265358979323846;

float sat(float x) { return clamp(x, 0.0, 1.0); }

vec2 applyAxis(vec2 p, int axis)   { return (axis == 1) ? p.yx : p; }
vec2 unapplyAxis(vec2 p, int axis) { return (axis == 1) ? p.yx : p; }

// ------------------------------------------------------------
// AE-like taper distortions (FORWARD mapping)
// - Horizontal Distortion +100 => left edge collapses to a point
// - Vertical Distortion +100   => top edge collapses to a point
// ------------------------------------------------------------
vec2 distortionForward(vec2 p, float hd, float vd)
{
    float x = p.x;
    float y = p.y;

    float hdPos = max(hd, 0.0);
    float hdNeg = max(-hd, 0.0);

    float yScaleLeft  = (1.0 + x) * 0.5; // x=-1 -> 0, x=+1 -> 1
    float yScaleRight = (1.0 - x) * 0.5; // x=+1 -> 0, x=-1 -> 1

    float yScale = 1.0;
    yScale = mix(yScale, max(yScaleLeft,  1e-4), hdPos);
    yScale = mix(yScale, max(yScaleRight, 1e-4), hdNeg);
    y *= yScale;

    float vdPos = max(vd, 0.0);
    float vdNeg = max(-vd, 0.0);

    float xScaleTop    = (1.0 - y) * 0.5; // y=+1 -> 0, y=-1 -> 1
    float xScaleBottom = (1.0 + y) * 0.5; // y=-1 -> 0, y=+1 -> 1

    float xScale = 1.0;
    xScale = mix(xScale, max(xScaleTop,    1e-4), vdPos);
    xScale = mix(xScale, max(xScaleBottom, 1e-4), vdNeg);
    x *= xScale;

    return vec2(x, y);
}

// ------------------------------------------------------------
// Radial styles forward: FishEye (11) / Inflate (12)
// FIXED: Style 11 edges pinned, Style 12 NOT pinned
// ------------------------------------------------------------
vec2 warpRadialForward(vec2 p, int style, float b, float aspect)
{
    // Aspect-corrected radial coordinates for circular behavior
    vec2 q = vec2(p.x * aspect, p.y);

    float r = length(q);
    float ang = atan(q.y, q.x);

    // AE-ish response curve strength
    float k = 1.0 + abs(b) * 1.25;
    float expn;

    if (style == 11) {
        // FishEye: lens-like (strong center), we'll pin edges
        expn = (b >= 0.0) ? (1.0 / max(k, 1e-4)) : max(k, 1e-4);
    } else {
        // Inflate: opposite curve (and NOT edge-pinned)
        expn = (b >= 0.0) ? max(k, 1e-4) : (1.0 / max(k, 1e-4));
    }

    float rr = pow(max(r, 1e-6), expn);
    vec2 qWarp = vec2(cos(ang), sin(ang)) * rr;

    // ---------- EDGE BEHAVIOR DIFFERENCE ----------
    float w = 1.0;

    if (style == 11) {
        float rEdge = max(abs(p.x), abs(p.y));
        w = pow(clamp(1.0 - rEdge, 0.0, 1.0), 2.8);
    }

    q = mix(q, qWarp, w);
    q.x /= aspect;

    return q;
}

// ------------------------------------------------------------
// AE quirk: some styles invert bend direction when Warp Axis = Vertical.
// Keep the behavior you observed: Arc family + Arch invert on Vertical axis.
// ------------------------------------------------------------
float bendEffective(int style, int axis, float b)
{
    if (axis != 1) return b;

    // Arc, Arc Lower, Arc Upper, Arch: invert on vertical axis
    if (style == 0 || style == 1 || style == 2 || style == 3) return -b;

    return b;
}

// ------------------------------------------------------------
// Forward warp per-style in axis space.
// IMPORTANT: axis already applied => u = p.x (along axis), v = p.y (perp)
// Styles implemented: 0..10, 13, 14 here. 11/12 are radial.
// NOTE: Signature updated to include axis (needed for Style 14 behavior).
// ------------------------------------------------------------
vec2 warpStyleForward(vec2 p, int style, int axis, float b)
{
    float u = p.x;
    float v = p.y;

    float uu = u*u;
    float vv = v*v;

    // 1 at center, 0 at edges
    float arcU = 1.0 - uu;
    float midV = 1.0 - vv;
    float radial = sat(1.0 - (uu + vv));

    // ---------- 0: ARC (FAN) FIXED: bottom bends more + fan flare ----------
    if (style == 0) {
        float a = abs(b);

        float thetaMax = max(a * (PI * 0.60), 1e-5);
        float theta = u * thetaMax;

        float edge = (1.0 - cos(theta));
        float edgeMax = max(1.0 - cos(thetaMax), 1e-5);
        float bulge = 1.0 - (edge / edgeMax);

        float t = (v + 1.0) * 0.5;
        float bottom = 1.0 - t;

        float wV = mix(0.30, 1.0, bottom);

        v += b * 0.95 * bulge * wV;

        float flare = 1.0 + a * 0.55 * bulge * bottom;
        u *= flare;

        return vec2(u, v);
    }

    // ---------- 1: ARC LOWER ----------
    if (style == 1) {
        float bottomMask = (1.0 - v) * 0.5;
        float m = bottomMask;
        v += b * 0.92 * arcU * m;
        return vec2(u, v);
    }

    // ---------- 2: ARC UPPER ----------
    if (style == 2) {
        float topMask = (1.0 + v) * 0.5;
        float m = topMask;
        v += b * 0.92 * arcU * m;
        return vec2(u, v);
    }

    // ---------- 3: ARCH ----------
    if (style == 3) {
        float a = abs(b);

        float thetaMax = max(a * (PI * 0.70), 1e-5);
        float theta = u * thetaMax;
        float edge = (1.0 - cos(theta));
        float edgeMax = max(1.0 - cos(thetaMax), 1e-5);
        float bulge = 1.0 - (edge / edgeMax);

        float h = 0.85 + 0.15 * (1.0 - abs(v));
        v += b * 1.10 * bulge * h;

        return vec2(u, v);
    }

    // ---------- 4: BULGE ----------
    if (style == 4) {
        float k = b * 0.60 * radial;
        u *= 1.0 + k;
        v *= 1.0 + k;
        return vec2(u, v);
    }

    // ---------- 5: SHELL LOWER ----------
    if (style == 5) {
        float a = abs(b);

        float m = (1.0 - v) * 0.5;
        m = pow(m, 1.65);

        float taper = (m * 2.0 - 1.0);
        float scaleU = 1.0 + a * 0.55 * taper;
        scaleU = max(scaleU, 0.15);
        u *= scaleU;

        float bulge = arcU;
        float bendAmt = b * 0.95 * bulge * (0.25 + 0.75 * m);
        v += bendAmt;

        return vec2(u, v);
    }

    // ---------- 6: SHELL UPPER ----------
    if (style == 6) {
        float a = abs(b);

        float m = (1.0 + v) * 0.5;
        m = pow(m, 1.65);

        float taper = (m * 2.0 - 1.0);
        float scaleU = 1.0 + a * 0.55 * taper;
        scaleU = max(scaleU, 0.15);
        u *= scaleU;

        float bulge = arcU;
        float bendAmt = b * 0.95 * bulge * (0.25 + 0.75 * m);
        v += bendAmt;

        return vec2(u, v);
    }

    // ---------- 7: FLAG ----------
    if (style == 7) {
        v += b * 0.55 * sin((u * 0.5 + 0.5) * PI);
        return vec2(u, v);
    }

    // ---------- 8: WAVE ----------
    if (style == 8) {
        v += b * 0.40 * sin((u * 0.5 + 0.5) * PI * 2.0);
        return vec2(u, v);
    }

    // ---------- 9: FISH (your current version) ----------
    // Bend > 0  => LEFT expands, RIGHT pinches
    // Bend < 0  => RIGHT expands, LEFT pinches
    if (style == 9) {
        float k = b;
        float a = abs(b);

        float uu2 = u * u;
        float vv2 = v * v;

        float midU2 = 1.0 - uu2;
        float midV2 = 1.0 - vv2;

        float belly = 1.0 + 0.45 * a * midU2 * (0.60 + 0.40 * midV2);
        u *= belly;

        float pinch = 1.0 - 0.50 * a * midU2;
        v *= pinch;

        float asym = 0.38 * k * midV2 * (-u);
        float s = 1.0 + asym;
        s = clamp(s, 0.15, 3.0);
        u *= s;

        v += 0.06 * k * (uu2 - 0.5) * midV2;

        return vec2(u, v);
    }

    // ---------- 10: RISE ----------

// ---------- 10: RISE (FIXED: AE-like curved ramp) ----------
if (style == 10) {
    // u in [-1..1] -> u01 in [0..1]
    float u01 = u * 0.5 + 0.5;

    // Curved/eased ramp (smoothstep). AE Rise feels more like this than a linear ramp.
    float ramp = u01 * u01 * (3.0 - 2.0 * u01);

    // Add a little extra curvature so the edge isn't a straight diagonal.
    // This makes Bend=50 resemble AE more closely.
    float ramp2 = ramp * ramp;

    // Final displacement
    // 1.55 is tuned so Bend=50 looks noticeably strong (like your AE screenshot)
    v += b * (1.05 * ramp + 0.50 * ramp2);

    return vec2(u, v);
}

    // ---------- 13: TWIST (FIXED: pinned edges, right/left twirl) ----------
    if (style == 13) {
        float maxTwist = 1.35 * PI;

        float r = max(abs(u), abs(v));
        float fall = 1.0 - r;
        fall = pow(max(fall, 0.0), 2.2);

        float ang = -b * maxTwist * fall;

        float cs = cos(ang);
        float sn = sin(ang);

        float u2 = cs * u - sn * v;
        float v2 = sn * u + cs * v;

        return vec2(u2, v2);
    }

    // ---------- 14: SQUEEZE (FIXED: sign chooses squeeze direction) ----------
    // Your request:
    // - Bend < 0 => squeeze horizontally (pinch left/right)
    // - Bend > 0 => squeeze vertically (pinch top/bottom)
    //
    // This works for both Warp_Axis = 0 and 1 by converting to comp-space axes.
    if (style == 14) {
        // Convert axis-space (possibly swapped) back to comp-space
        vec2 q = (axis == 1) ? vec2(v, u) : vec2(u, v); // q.x = compX, q.y = compY

        float amt = abs(b);
        float k = 0.92; // strength (tune if needed)

        float midX = 1.0 - (q.x * q.x); // 1 at center, 0 at left/right
        float midY = 1.0 - (q.y * q.y); // 1 at center, 0 at top/bottom

        if (b < 0.0) {
            // Negative => squeeze horizontally (scale X based on Y center)
            float sx = 1.0 - amt * k * midY;
            sx = max(sx, 0.08);
            q.x *= sx;
        } else if (b > 0.0) {
            // Positive => squeeze vertically (scale Y based on X center)
            float sy = 1.0 - amt * k * midX;
            sy = max(sy, 0.08);
            q.y *= sy;
        }

        // Convert back to axis-space
        vec2 outv = (axis == 1) ? vec2(q.y, q.x) : q;
        return outv;
    }

    return vec2(u, v);
}

// ------------------------------------------------------------
// Full FORWARD transform = warp then distortion (AE-like interaction)
// ------------------------------------------------------------
vec2 forwardTransform(vec2 p, int style, int axis, float b, float hd, float vd, float aspect)
{
    // FishEye & Inflate ignore axis
    if (style == 11 || style == 12) {
        p = warpRadialForward(p, style, b, aspect);
        p = distortionForward(p, hd, vd);
        return p;
    }

    float bEff = bendEffective(style, axis, b);

    vec2 pa = applyAxis(p, axis);
    pa = warpStyleForward(pa, style, axis, bEff);
    p  = unapplyAxis(pa, axis);

    // Apply distortion after warp
    p = distortionForward(p, hd, vd);
    return p;
}

// ------------------------------------------------------------
// INVERSE solve: find p_in such that forwardTransform(p_in)=p_out
// Fixed-point iteration with damping.
// ------------------------------------------------------------
vec2 inverseSolve(vec2 pOut, int style, int axis, float b, float hd, float vd, float aspect)
{
    vec2 p = pOut;

    for (int i = 0; i < 7; i++) {
        vec2 f = forwardTransform(p, style, axis, b, hd, vd, aspect);
        vec2 e = f - pOut;
        p -= e * 0.75;
    }
    return p;
}

void main()
{
    vec2 pOut = (vUv - 0.5) * 2.0;

    float aspect = resolution.x / max(resolution.y, 1.0);

    int style = int(floor(Warp_Style + 0.5));
    int axis  = int(floor(Warp_Axis  + 0.5));

    float b  = clamp(Bend / 100.0, -1.0, 1.0);
    float hd = clamp(Horizontal_Distortion / 100.0, -1.0, 1.0);
    float vd = clamp(Vertical_Distortion / 100.0, -1.0, 1.0);

    vec2 pIn = inverseSolve(pOut, style, axis, b, hd, vd, aspect);

    vec2 uvIn = pIn * 0.5 + 0.5;
    vec2 sampleUv = uvIn * uvScale;

    if (uvIn.x < 0.0 || uvIn.x > 1.0 || uvIn.y < 0.0 || uvIn.y > 1.0) {
        gl_FragColor = vec4(0.0);
    } else {
        gl_FragColor = texture2D(tDiffuse, sampleUv);
    }
}
