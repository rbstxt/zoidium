precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2      uvScale;
uniform vec2      resolution;
varying vec2      vUvScaled;

// ===== Dynamic properties =====
uniform float Blurriness;           // σ in pixels (AE-style)
uniform float Blur_Dimensions;      // 0=Both, 1=Horizontal, 2=Vertical
uniform float Repeat_Edge_Pixels;   // 0=Off, 1=On

// ===== Performance caps (tune to taste) =====
#define MAX_RADIUS_1D   128   // Max ±radius for 1D
#define MAX_RADIUS_BOTH  24   // Max ±radius for 2D (heavy)

// ---- int helpers ----
int imin_int(int a, int b) { return (a < b) ? a : b; }
int iabs_int(int x) { return (x < 0) ? -x : x; }

const float EPS = 1e-6;

// ---- robust decoder for Blur_Dimensions ----
int decodeDim(float v) {
    // [0, 0.5) => 0 (Both), [0.5, 1.5) => 1 (Horizontal), else 2 (Vertical)
    if (v < 0.5) return 0;
    else if (v < 1.5) return 1;
    else return 2;
}

// ============================ Sampling helpers ============================
vec4 sample_clamped(vec2 uv) {
    return texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));
}

bool inside01(vec2 uv) {
    return !(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))));
}
vec4 sample_if_inside(vec2 uv) {
    return inside01(uv) ? texture2D(tDiffuse, uv) : vec4(0.0);
}

// ============================ FULL 1D (H or V) ============================
// Uses **Gaussian recurrence** so we do only 2 exponentials total per fragment.
// w0 = 1
// r1 = exp(-(2*1-1)/(2σ^2)) = exp(-1/(2σ^2))
// step = exp(-1/σ^2)
// w_i = w_{i-1} * r_i ; r_{i+1} = r_i * step
vec4 blur1D_full(vec2 uv, vec2 stepUV, float sigma, bool repeatEdges) {
    int r = int(ceil(3.0 * sigma));
    r = imin_int(r, MAX_RADIUS_1D);

    // Precompute recurrence constants
    float invSigma2 = 1.0 / max(sigma * sigma, 1e-12);
    float r_i   = exp(-0.5 * invSigma2); // ratio for i=1
    float rStep = exp(-1.0 * invSigma2); // growth per step
    float w_i   = 1.0;                   // w_0

    // Center
    vec4  c0 = repeatEdges ? sample_clamped(uv) : sample_if_inside(uv);
    vec3  accPremul = c0.rgb * c0.a; // * w0 (w0=1)
    float accAlpha  = c0.a;          // * w0
    float wSum      = 1.0;

    // Symmetric pairs (±i)
    for (int i = 1; i <= MAX_RADIUS_1D; ++i) {
        if (i > r) break;

        // advance recurrence
        w_i *= r_i;     // now w_i = exp(-i^2/(2σ^2))
        r_i *= rStep;   // prepare ratio for next i (i+1)

        vec2 o = float(i) * stepUV;

        if (repeatEdges) {
            vec4 p = sample_clamped(uv + o);
            vec4 n = sample_clamped(uv - o);
            accPremul += (p.rgb * p.a + n.rgb * n.a) * w_i;
            accAlpha  += (p.a + n.a) * w_i;
        } else {
            vec2 up = uv + o, un = uv - o;
            if (inside01(up)) {
                vec4 p = texture2D(tDiffuse, up);
                accPremul += (p.rgb * p.a) * w_i;
                accAlpha  += p.a * w_i;
            }
            if (inside01(un)) {
                vec4 n = texture2D(tDiffuse, un);
                accPremul += (n.rgb * n.a) * w_i;
                accAlpha  += n.a * w_i;
            }
        }

        // IMPORTANT: keep kernel sum even if samples are OOB (AE darkening)
        wSum += 2.0 * w_i;
    }

    vec3 premul = accPremul / max(wSum, EPS);
    float a     = accAlpha  / max(wSum, EPS);
    vec3 rgb    = premul / max(a, EPS);
    return vec4(rgb, a);
}

// ============================ BOTH (H & V) ============================
// Exact 2D; still heavy. Uses symmetry + recurrence to reduce ALU work.
// NOTE: For speed, prefer two 1D passes with this same shader.
vec4 blurBoth_full(vec2 uv, vec2 texelSize, float sigma, bool repeatEdges) {
    int r = int(ceil(3.0 * sigma));
    r = imin_int(r, MAX_RADIUS_BOTH);

    float invSigma2 = 1.0 / max(sigma * sigma, 1e-12);

    // 1D sum for exact normalization in 2D: (sum1D)^2
    // Use recurrence to build sum1D fast.
    float sum1D = 1.0;
    float r_i   = exp(-0.5 * invSigma2); // ratio for i=1
    float rStep = exp(-1.0 * invSigma2);
    float w_i   = 1.0;
    for (int i = 1; i <= MAX_RADIUS_BOTH; ++i) {
        if (i > r) break;
        w_i *= r_i;
        r_i *= rStep;
        sum1D += 2.0 * w_i;
    }
    float norm2D = max(sum1D * sum1D, EPS);

    vec3 accPremul = vec3(0.0);
    float accAlpha = 0.0;

    // Y-direction recurrence
    float ry  = exp(-0.5 * invSigma2); // ratio for j=1
    float rys = rStep;
    float wy  = 1.0;

    // Row j = 0 (center row)
    {
        // X recurrence fresh for each row
        float rx  = exp(-0.5 * invSigma2);
        float rxs = rStep;
        float wx  = 1.0;

        // center
        vec4 c = repeatEdges ? sample_clamped(uv) : sample_if_inside(uv);
        float w0 = 1.0;
        accPremul += (c.rgb * c.a) * (w0 * wy); // wy=1
        accAlpha  += c.a * (w0 * wy);

        // ±x
        for (int ix = 1; ix <= MAX_RADIUS_BOTH; ++ix) {
            if (ix > r) break;
            wx *= rx; rx *= rxs;

            vec2 o = vec2(float(ix), 0.0) * texelSize;
            if (repeatEdges) {
                vec4 p = sample_clamped(uv + o);
                vec4 n = sample_clamped(uv - o);
                float w = wx * wy;
                accPremul += (p.rgb*p.a + n.rgb*n.a) * w;
                accAlpha  += (p.a + n.a) * w;
            } else {
                vec2 up = uv + o, un = uv - o;
                float w = wx * wy;
                if (inside01(up)) { vec4 s = texture2D(tDiffuse, up); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
                if (inside01(un)) { vec4 s = texture2D(tDiffuse, un); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
            }
        }
    }

    // Rows j = 1..r (handle ±j symmetrically)
    for (int jy = 1; jy <= MAX_RADIUS_BOTH; ++jy) {
        if (jy > r) break;
        wy *= ry; ry *= rys;

        vec2 oy = vec2(0.0, float(jy)) * texelSize;

        // X recurrence per row
        float rx  = exp(-0.5 * invSigma2);
        float rxs = rStep;
        float wx  = 1.0;

        // Axis points (ix = 0): (0, +j) and (0, -j)
        {
            float w = wx * wy; // wx=1
            if (repeatEdges) {
                vec4 p = sample_clamped(uv + oy);
                vec4 n = sample_clamped(uv - oy);
                accPremul += (p.rgb*p.a + n.rgb*n.a) * w;
                accAlpha  += (p.a + n.a) * w;
            } else {
                vec2 up = uv + oy, un = uv - oy;
                if (inside01(up)) { vec4 s = texture2D(tDiffuse, up); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
                if (inside01(un)) { vec4 s = texture2D(tDiffuse, un); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
            }
        }

        // Quadrants (±ix, ±jy), ix = 1..r
        for (int ix = 1; ix <= MAX_RADIUS_BOTH; ++ix) {
            if (ix > r) break;
            wx *= rx; rx *= rxs;

            float w = wx * wy;
            vec2 ox = vec2(float(ix), 0.0) * texelSize;

            // (+x, +y), (+x, -y), (-x, +y), (-x, -y)
            if (repeatEdges) {
                vec4 s1 = sample_clamped(uv + ox + oy);
                vec4 s2 = sample_clamped(uv + ox - oy);
                vec4 s3 = sample_clamped(uv - ox + oy);
                vec4 s4 = sample_clamped(uv - ox - oy);
                accPremul += (s1.rgb*s1.a + s2.rgb*s2.a + s3.rgb*s3.a + s4.rgb*s4.a) * w;
                accAlpha  += (s1.a + s2.a + s3.a + s4.a) * w;
            } else {
                vec2 u1 = uv + ox + oy, u2 = uv + ox - oy, u3 = uv - ox + oy, u4 = uv - ox - oy;
                if (inside01(u1)) { vec4 s = texture2D(tDiffuse, u1); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
                if (inside01(u2)) { vec4 s = texture2D(tDiffuse, u2); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
                if (inside01(u3)) { vec4 s = texture2D(tDiffuse, u3); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
                if (inside01(u4)) { vec4 s = texture2D(tDiffuse, u4); accPremul += (s.rgb*s.a) * w; accAlpha += s.a * w; }
            }
        }
    }

    vec3 premul = accPremul / norm2D;
    float a     = accAlpha  / norm2D;
    vec3 rgb    = premul / max(a, EPS);
    return vec4(rgb, a);
}

void main() {
    vec2 texelSize = 1.0 / max(resolution, vec2(1.0));
    vec2 uv        = vUvScaled;

    float sigma = max(Blurriness, 0.0);
    if (sigma <= 0.0) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
    }

    int  dim = decodeDim(Blur_Dimensions);
    bool rep = (Repeat_Edge_Pixels >= 0.5);

    // 1D step per pixel
    vec2 stepH = vec2(texelSize.x, 0.0);
    vec2 stepV = vec2(0.0, texelSize.y);

    vec4 color;
    if (dim == 1) {
        // Horizontal
        color = blur1D_full(uv, stepH, sigma, rep);
    } else if (dim == 2) {
        // Vertical
        color = blur1D_full(uv, stepV, sigma, rep);
    } else {
        // Both (still heavy; prefer two passes for speed)
        color = blurBoth_full(uv, texelSize, sigma, rep);
    }

    gl_FragColor = color;
}
