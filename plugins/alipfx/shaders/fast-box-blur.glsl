precision highp float;
precision highp int;

// Panzoid-provided
uniform sampler2D tDiffuse;
uniform vec2      resolution;
varying vec2      vUvScaled;

// Custom properties (dynamic Numbers)
uniform float Blur_Radius;         // in pixels
uniform float Iterations;          // 1..10+
uniform float Blur_Dimensions;     // 0=Both, 1=Horizontal, 2=Vertical
uniform float Repeat_Edge_Pixels;  // 0/1

// Compile-time caps
#define MAX_RADIUS 512
#define LOOP_MAX   64   // max taps per side considered by the loop

// ----------------------- Utilities -----------------------
int  toInt(float x) { return int(floor(x + 0.5)); }
bool repeatEdges()  { return Repeat_Edge_Pixels > 0.5; }

// GLSL ES 1.00 lacks min/max/clamp for int
int imin(int a, int b) { return (a < b) ? a : b; }
int imax(int a, int b) { return (a > b) ? a : b; }
int iclamp(int x, int lo, int hi) { return imin(imax(x, lo), hi); }

// Safe sampler that emulates AE's "Repeat Edge Pixels"
vec4 sampleSafe(vec2 uv) {
    if (repeatEdges()) {
        uv = clamp(uv, 0.0, 1.0);
        return texture2D(tDiffuse, uv);
    } else {
        if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
            return vec4(0.0);
        }
        return texture2D(tDiffuse, uv);
    }
}

// Premultiply helpers
vec4 premul(vec4 c)   { return vec4(c.rgb * c.a, c.a); }
vec4 unpremul(vec4 c) { float a = max(c.a, 1e-6); return vec4(c.rgb / a, c.a); }

// --------------------- Box 1D (Iterations = 1) -------------------
vec4 boxBlur1D(vec2 uv, vec2 dir, float radiusPx) {
    float r = max(radiusPx, 0.0);
    if (r < 0.5) return sampleSafe(uv);

    int  R     = imin(int(floor(r)), MAX_RADIUS);
    int  L     = imin(R, LOOP_MAX);
    vec2 texel = dir / resolution;

    vec4 accum = premul(sampleSafe(uv));
    float count = 1.0;

    for (int i = 1; i <= LOOP_MAX; ++i) {
        if (i > L) break;
        vec2 o = texel * float(i);
        vec4 c1 = premul(sampleSafe(uv + o));
        vec4 c2 = premul(sampleSafe(uv - o));
        accum += c1 + c2;
        count += 2.0;
    }

    return unpremul(accum / count);
}

// --------------- Gaussian 1D (Iterations >= 2) -------------------
// Optimized using a recurrence to avoid per-iteration exp():
//   w(i)      = exp(-i^2 * k), k = 0.5/(sigma^2)
//   w1        = exp(-1 * k)
//   ratio(1)  = exp(-3 * k)                  // takes w1 -> w2
//   rStep     = exp(-2 * k)                  // ratio(i+1) = ratio(i) * rStep
vec4 gaussianBlur1D(vec2 uv, vec2 dir, float sigma) {
    if (sigma < 0.5) return sampleSafe(uv);

    float support = max(1.0, floor(3.0 * sigma));        // 3σ support
    int   R       = imin(int(support), MAX_RADIUS);
    int   L       = imin(R, LOOP_MAX);
    vec2  texel   = dir / resolution;

    float k       = 0.5 / (sigma * sigma);
    float w0      = 1.0;                 // center
    float w       = exp(-k);             // weight at i = 1
    float ratio   = exp(-3.0 * k);       // multiplier to go w1 -> w2
    float rStep   = exp(-2.0 * k);       // update for ratio each step

    vec4 accum = premul(sampleSafe(uv)) * w0;
    float wsum = w0;

    for (int i = 1; i <= LOOP_MAX; ++i) {
        if (i > L) break;
        vec2 o = texel * float(i);
        vec4 c1 = premul(sampleSafe(uv + o));
        vec4 c2 = premul(sampleSafe(uv - o));
        accum += (c1 + c2) * w;
        wsum  += 2.0 * w;

        // advance to next i
        w     *= ratio;
        ratio *= rStep;
    }

    return unpremul(accum / max(wsum, 1e-6));
}

// Decide Box vs Gaussian from Iterations
vec4 blur1D(vec2 uv, vec2 dir, float radiusPx, int iters) {
    if (iters <= 1) {
        return boxBlur1D(uv, dir, radiusPx);
    } else {
        // n box passes ≈ Gaussian with sigma = r * sqrt(n/3)
        float sigma = max(0.0, radiusPx) * sqrt(float(iters) / 3.0);
        return gaussianBlur1D(uv, dir, sigma);
    }
}

// ------------------------------ main -----------------------------
void main() {
    int   iters = imax(1, toInt(Iterations));
    int   dims  = iclamp(toInt(Blur_Dimensions), 0, 2);
    float r     = max(0.0, Blur_Radius);

    // Early out
    if (r < 0.5) {
        gl_FragColor = sampleSafe(vUvScaled);
        return;
    }

    vec2 dirH = vec2(1.0, 0.0);
    vec2 dirV = vec2(0.0, 1.0);

    if (dims == 1) {
        gl_FragColor = blur1D(vUvScaled, dirH, r, iters); // Horizontal
    } else if (dims == 2) {
        gl_FragColor = blur1D(vUvScaled, dirV, r, iters); // Vertical
    } else {
        // Single-pass approximation of Both:
        // for exact AE separable H->V, stack two instances of this effect.
        vec4 h = blur1D(vUvScaled, dirH, r, iters);
        vec4 v = blur1D(vUvScaled, dirV, r, iters);
        gl_FragColor = 0.5 * (h + v);
    }
}
