// OpenZoid Legacy — Datamosh (deterministic segment model).
//
// A real datamosh removes an I-frame, so the last clean picture keeps moving
// through the following P-frames. This effect reproduces that look without
// render history, so the same frame always renders the same pixels:
//
//   - Keyframe Interval splits the timeline into segments. The segment start S
//     (a multiple of the interval) is shown untouched.
//   - For a frame t inside a segment, up to Motion Samples earlier frames of
//     that segment are requested from the frame sampler at fixed offsets. Only
//     source frames in [anchor .. t] are read. The anchor is the earliest
//     sampled frame, which equals S whenever the segment fits the sample count.
//   - Each consecutive pair of sampled frames is block-matched on the GPU (one
//     pass per step). The per-block displacements are accumulated.
//   - The anchor is warped by the accumulated displacement and blended in where
//     it differs from the current source picture.
//
// The result depends only on the source frames, the properties and the frame
// index. It does not depend on playback direction, seeks, or earlier renders.
// Frame sampling needs an Adjustment layer. Elsewhere the frame passes through.
// The export-time byte-level renderer is gone, so preview and export match.
// The "Setup" row opens the Datamosh Setup floating window (datamosh-setup.js).

const DATAMOSH_MAX_STEPS = 15; // the host caps frame samples at 16
const DATAMOSH_SETUP_CONTROL = "openzoid-legacy.datamosh-setup";
const DATAMOSH_MOTION_ITEMS =
  "Identity;Scale;Vertical;Horizontal;Zoom;Shear;Wave;Swap;Random";
// The 80 donor entries share motion, mirror, sweep, taper and smear families.
// They use a sampled source anchor instead of a previous rendered output.
const DATAMOSH_ALGORITHM_ITEMS = "Motion matching;Default;Multiply;Add to x and y;Move vertical;Move horizontal;Zoom 1;Zoom 2;Zoom sin;Shear;Experimental;Swap;Random;Random Blocks 1;Random Blocks 2;Random Blocks 3;Random Blocks 4;Spatial;Multiply by X;Multiply by X no Y;Multiply by Y;Multiply by Y no X;Multiply by inverse X;Multiply by inverse X no Y;Multiply by inverse Y;Multiply by inverse Y no X;Multiply by X&Y;Multiply by inverse X&Y;Multiply by X & inverse Y;Multiply by Y & inverse X;Average;Average X and Y;Average previous 3;Average previous 5;Average previous 10;Average previous 15;Average 1 neighbors;Average 2 neighbors;Average 3 neighbors;Average 4 neighbors;Add previous 3;Add previous 5;Add previous 10;Mirror X;Mirror Y;Mirror left;Mirror right;Mirror top;Mirror bottom;Sweep;Sweep horizontal;Sweep horizontal opposite;Sweep vertical;Sweep vertical opposite;Sin and cos;Middle sin X;Middle sin X no Y;Middle sin Y;Middle sin Y no X;Outside sin X;Outside sin X no Y;Outside sin Y;Outside sin Y no X;Outside half sin X;Outside half sin X no Y;Outside half sin Y;Outside half sin Y no X;Oscillate sin X;Oscillate sin X no Y;Oscillate sin Y;Oscillate sin Y no X;Oscillate sin X&Y;Right horizontal sin tapered V1;Left horizontal sin tapered V1;Horizontal sin tapered V1;Right horizontal sin tapered V2;Left horizontal sin tapered V2;Horizontal sin tapered V2;Horizontal sin tapered V3;Cos X & sin Y;Sin X & cos Y";

const DATAMOSH_VERTEX_SHADER = `
uniform vec2 uvScale;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Shared GLSL. Motion vectors are stored in RGBA8 targets as two 16-bit
// fixed-point components (1/64 pixel, range -512..512): RG holds x, BA holds y.
const DATAMOSH_COMMON_GLSL = `
precision highp float;
uniform vec2 resolution;
uniform vec2 uvScale;
float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}
vec2 texCoord(vec2 p) {
    return (clamp(p, vec2(0.0), resolution - vec2(1.0)) + 0.5) / resolution * uvScale;
}
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float decodeComponent(vec2 c) {
    float hi = floor(c.x * 255.0 + 0.5);
    float lo = floor(c.y * 255.0 + 0.5);
    return (hi * 256.0 + lo) / 64.0 - 512.0;
}
vec2 decodeVector(vec4 c) {
    return vec2(decodeComponent(c.rg), decodeComponent(c.ba));
}
vec2 encodeComponent(float x) {
    float u = floor(clamp((x + 512.0) * 64.0, 0.0, 65535.0) + 0.5);
    float hi = floor(u / 256.0);
    return vec2(hi, u - hi * 256.0) / 255.0;
}
vec4 encodeVector(vec2 v) {
    return vec4(encodeComponent(v.x), encodeComponent(v.y));
}
`;

// One step of the chain: block-match the later frame (tCurrent) against the
// earlier frame (tEarlier) and add the best displacement to the running total.
const DATAMOSH_MOTION_SHADER = DATAMOSH_COMMON_GLSL + `
uniform sampler2D tCurrent;
uniform sampler2D tEarlier;
uniform sampler2D tAccumulated;
uniform float hasAccumulated;
uniform vec2 blocks;
uniform float blockSize;
uniform float spacing;

float blockCost(vec2 block, vec2 offset) {
    float sum = 0.0;
    for (int gy = 0; gy < 2; gy++) {
        for (int gx = 0; gx < 2; gx++) {
            vec2 p = block * blockSize + (vec2(float(gx), float(gy)) + 0.5) * (blockSize * 0.5);
            float a = luma(texture2D(tCurrent, texCoord(p)).rgb);
            float b = luma(texture2D(tEarlier, texCoord(p - offset)).rgb);
            sum += abs(a - b);
        }
    }
    return sum;
}

void main() {
    vec2 block = floor(gl_FragCoord.xy);
    vec2 total = vec2(0.0);
    if (hasAccumulated > 0.5) {
        total = decodeVector(texture2D(tAccumulated, (block + 0.5) / blocks));
    }
    float best = 1e9;
    vec2 bestOffset = vec2(0.0);
    for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
            vec2 offset = vec2(float(i), float(j)) * spacing;
            float cost = blockCost(block, offset) + 0.05 * length(offset);
            if (cost < best) {
                best = cost;
                bestOffset = offset;
            }
        }
    }
    gl_FragColor = encodeVector(total + bestOffset);
}
`;

// Final pass: warp the anchor through the accumulated motion, then blend it in
// where it differs from the current picture. Passes the source through when
// hasSamples is 0 (keyframe frames and frames without sampler support).
const DATAMOSH_WARP_SHADER = DATAMOSH_COMMON_GLSL + `
uniform sampler2D tOriginal;
uniform sampler2D tAnchor;
uniform sampler2D tAccumulated;
uniform vec2 blocks;
uniform float blockSize;
uniform float hasSamples;
uniform float searchBlockSize;
uniform float amount;
uniform float blend;
uniform float intensity;
uniform float acceleration;
uniform float threshold;
uniform float motionMode;
uniform float frameIndex;
uniform float segment;
uniform float seed;
uniform float algorithm;
uniform float hold;
uniform float speed;
uniform float time;
varying vec2 vUv;


// Donor look families evaluated against this render's sampled anchor.
// No previous-output texture or playback history is retained.
#ifdef DATAMOSH_LEGACY_LOOK
float dnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec4 legacyColor(vec4 orig) {
    float t = time;
    float sF = floor(t * max(speed, 0.01) * 6.0) + seed * 17.0;
    float bs = max(blockSize, 2.0);
    vec2 bid = floor(vUv * resolution / bs);
    vec2 bc = (bid * bs + bs * 0.5) / resolution;
    float bh1 = hash12(bid + vec2(sF * 0.37, sF * 0.11));
    float bh2 = hash12(bid * 1.71 + vec2(3.1, 7.7) + vec2(sF * 0.13, -sF * 0.07));
    float bh3 = hash12(bid * 0.37 + vec2(9.2, 1.3) + vec2(-sF * 0.21, sF * 0.31));

    vec3 cCurr = texture2D(tOriginal, clamp(bc, 0.0, 1.0) * uvScale).rgb;
    vec3 cPrevB = texture2D(tAnchor, (clamp(bc, 0.0, 1.0)) * uvScale).rgb;
    float lC = dot(cCurr, vec3(0.299, 0.587, 0.114));
    float lP = dot(cPrevB, vec3(0.299, 0.587, 0.114));
    float diff = abs(lC - lP);
    float act = smoothstep(threshold, threshold + 0.22, diff + (bh1 - 0.5) * 0.30 * intensity);

    // REMOVE FRAMES: randomly freeze history (deleted I-frame = stuck P-chain)
    float holdR = hash12(vec2(sF, 17.0));
    if (holdR < hold * 0.65) {
        vec3 frozen = texture2D(tAnchor, (vUv) * uvScale).rgb;
        vec3 fmix = mix(orig.rgb, frozen, clamp(amount, 0.0, 1.0));
        return vec4(fmix, orig.a);
    }

    float a = algorithm - 1.0;
    vec2 n = vUv - 0.5;
    float r = max(length(n), 1e-4);
    vec2 dir = n / r;
    float inten = intensity * (1.0 + acceleration * 1.5);
    vec2 v = vec2(0.0);

    // ---- motion-vector families (80 presets mapped to shared cores) ----
    if (a < 0.5) { // Default
        v = vec2(bh1 - 0.5, (bh2 - 0.5) * 0.45) * 2.0 * inten;
    } else if (a < 1.5) { // Multiply
        v = vec2(bh1 - 0.5, bh2 - 0.5) * 2.0 * inten * 3.0;
    } else if (a < 2.5) { // Add to x and y
        v = vec2(bh1 + bh2 - 1.0, bh2 + bh3 - 1.0) * inten * 2.0;
    } else if (a < 3.5) { // Move vertical
        v = vec2(0.0, (bh1 - 0.5) * 2.0 * inten * 2.0);
    } else if (a < 4.5) { // Move horizontal
        v = vec2((bh1 - 0.5) * 2.0 * inten * 2.0, 0.0);
    } else if (a < 7.5) { // Zoom 1 / Zoom 2 / Zoom sin
        float zm = (a < 5.5) ? 1.0 : (a < 6.5 ? 1.8 : (0.8 + 0.8 * sin(t * 3.0 + r * 20.0)));
        v = -dir * (0.15 + bh1 * 0.85) * inten * 2.2 * zm;
    } else if (a < 8.5) { // Shear
        v = vec2(n.y * 2.0 * inten * (bh1 - 0.5) * 4.0, 0.0);
    } else if (a < 9.5) { // Experimental (turbulent)
        float nz = dnoise(bid * 0.35 + vec2(t * 0.7, -t * 0.5)) - 0.5;
        float nz2 = dnoise(bid * 0.5 + vec2(-t * 0.6, t * 0.8) + 31.0) - 0.5;
        v = vec2(nz, nz2) * 2.0 * inten * 2.5;
    } else if (a < 10.5) { // Swap (steal motion: swap axes)
        v = vec2((bh2 - 0.5), (bh1 - 0.5)) * 2.0 * inten * 2.0;
    } else if (a < 11.5) { // Random
        v = vec2(bh1 - 0.5, bh3 - 0.5) * 2.0 * inten * 3.0;
    } else if (a < 15.5) { // Random Blocks 1-4 (coarser seeds)
        float scl = (a < 12.5) ? 1.0 : (a < 13.5 ? 2.0 : (a < 14.5 ? 0.5 : 3.0));
        vec2 cb = floor(vUv * resolution / (bs * scl));
        float rh1 = hash12(cb + vec2(sF * 0.43, 1.7));
        float rh2 = hash12(cb * 1.3 + vec2(5.0, sF * 0.29));
        v = vec2(rh1 - 0.5, rh2 - 0.5) * 2.0 * inten * 2.6;
    } else if (a < 16.5) { // Spatial (position-driven)
        v = vec2(sin(bid.y * 0.35 + t), cos(bid.x * 0.35 - t * 1.2)) * inten * 1.6;
    } else if (a < 28.5) { // Multiply by X/Y/inverse variants
        float mx = vUv.x;
        float my = vUv.y;
        float ix = 1.0 - mx;
        float iy = 1.0 - my;
        vec2 base = vec2(bh1 - 0.5, bh2 - 0.5) * 2.0;
        if (a < 17.5) v = base * vec2(mx * 2.0, 1.0) * inten * 2.0;
        else if (a < 18.5) v = vec2(base.x * mx * 2.0, 0.0) * inten * 2.0;
        else if (a < 19.5) v = base * vec2(1.0, my * 2.0) * inten * 2.0;
        else if (a < 20.5) v = vec2(0.0, base.y * my * 2.0) * inten * 2.0;
        else if (a < 21.5) v = base * vec2(ix * 2.0, 1.0) * inten * 2.0;
        else if (a < 22.5) v = vec2(base.x * ix * 2.0, 0.0) * inten * 2.0;
        else if (a < 23.5) v = base * vec2(1.0, iy * 2.0) * inten * 2.0;
        else if (a < 24.5) v = vec2(0.0, base.y * iy * 2.0) * inten * 2.0;
        else if (a < 25.5) v = base * vec2(mx * my * 4.0, mx * my * 4.0) * inten * 2.0;
        else if (a < 26.5) v = base * vec2(ix * iy * 4.0, ix * iy * 4.0) * inten * 2.0;
        else if (a < 27.5) v = base * vec2(mx * 2.0, iy * 2.0) * inten * 2.0;
        else v = base * vec2(ix * 2.0, my * 2.0) * inten * 2.0;
    } else if (a < 41.5) { // Average / Add previous (handled via taps below)
        v = vec2(bh1 - 0.5, (bh2 - 0.5) * 0.5) * 2.0 * inten * 1.4;
        if (a >= 29.5 && a < 30.5) v *= vec2(0.6, 1.4);
    } else if (a < 47.5) { // Mirror family
        vec2 m = vUv;
        if (a < 42.5) m = vec2(1.0 - vUv.x, vUv.y);
        else if (a < 43.5) m = vec2(vUv.x, 1.0 - vUv.y);
        else if (a < 44.5) m = vec2(vUv.x < 0.5 ? vUv.x : 1.0 - vUv.x, vUv.y);
        else if (a < 45.5) m = vec2(vUv.x < 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
        else if (a < 46.5) m = vec2(vUv.x, vUv.y < 0.5 ? vUv.y : 1.0 - vUv.y);
        else m = vec2(vUv.x, vUv.y < 0.5 ? 1.0 - vUv.y : vUv.y);
        vec3 mc = texture2D(tAnchor, (clamp(m, 0.0, 1.0)) * uvScale).rgb;
        float mm = act * clamp(amount, 0.0, 1.0) * clamp(blend * 1.5, 0.0, 1.0);
        vec3 mout = mix(orig.rgb, mc, mm);
        return vec4(mout, orig.a);
    } else if (a < 52.5) { // Sweep family
        float sp = fract(t * (0.1 + speed * 0.25));
        vec2 s = vUv;
        if (a < 48.5) s.x = fract(vUv.x + sp * inten * 2.0 + (bh1 - 0.5) * 0.1);
        else if (a < 49.5) s.x = fract(vUv.x + sp * inten * 2.0);
        else if (a < 50.5) s.x = fract(vUv.x - sp * inten * 2.0);
        else if (a < 51.5) s.y = fract(vUv.y + sp * inten * 2.0);
        else s.y = fract(vUv.y - sp * inten * 2.0);
        vec3 sc = texture2D(tAnchor, (clamp(s, 0.0, 1.0)) * uvScale).rgb;
        float sm = act * clamp(amount, 0.0, 1.0) * clamp(blend * 1.5, 0.0, 1.0);
        return vec4(mix(orig.rgb, sc, sm), orig.a);
    } else { // Sin / cos / oscillate / tapered families
        float midx = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float midy = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float outx = abs(vUv.x - 0.5) * 2.0;
        float outy = abs(vUv.y - 0.5) * 2.0;
        float sx = sin(bid.y * 0.45 + t * (2.0 + speed * 2.0));
        float sy = sin(bid.x * 0.45 - t * (2.0 + speed * 2.0));
        float cx = cos(bid.y * 0.4 - t * 2.5);
        float cy = cos(bid.x * 0.4 + t * 2.5);
        if (a < 53.5) v = vec2(sx, cy) * inten * 1.8;                        // Sin and cos
        else if (a < 54.5) v = vec2(sx * midx, 0.0) * inten * 2.4;            // Middle sin X
        else if (a < 55.5) v = vec2(sx * midx, (bh2 - 0.5) * inten) * inten;  // Middle sin X no Y
        else if (a < 56.5) v = vec2(0.0, sy * midy) * inten * 2.4;            // Middle sin Y
        else if (a < 57.5) v = vec2((bh1 - 0.5) * inten, sy * midy) * inten;  // Middle sin Y no X
        else if (a < 58.5) v = vec2(sx * outx, 0.0) * inten * 2.4;            // Outside sin X
        else if (a < 59.5) v = vec2(sx * outx, (bh2 - 0.5) * inten);
        else if (a < 60.5) v = vec2(0.0, sy * outy) * inten * 2.4;            // Outside sin Y
        else if (a < 61.5) v = vec2((bh1 - 0.5) * inten, sy * outy);
        else if (a < 62.5) v = vec2(sx * outx * 0.5, 0.0) * inten * 2.4;      // Outside half sin X
        else if (a < 63.5) v = vec2(sx * outx * 0.5, (bh2 - 0.5) * inten);
        else if (a < 64.5) v = vec2(0.0, sy * outy * 0.5) * inten * 2.4;      // Outside half sin Y
        else if (a < 65.5) v = vec2((bh1 - 0.5) * inten, sy * outy * 0.5);
        else if (a < 66.5) v = vec2(sin(t * 4.0 + bid.y * 0.3), 0.0) * inten * 2.2; // Oscillate sin X
        else if (a < 67.5) v = vec2(sin(t * 4.0 + bid.y * 0.3), (bh2 - 0.5)) * inten * 1.6;
        else if (a < 68.5) v = vec2(0.0, sin(t * 4.0 + bid.x * 0.3)) * inten * 2.2; // Oscillate sin Y
        else if (a < 69.5) v = vec2((bh1 - 0.5), sin(t * 4.0 + bid.x * 0.3)) * inten * 1.6;
        else if (a < 70.5) v = vec2(sin(t * 4.0 + bid.y * 0.3), sin(t * 4.0 + bid.x * 0.3)) * inten * 2.0;
        else if (a < 73.5) { // tapered V1 (right / left / horizontal)
            float taper = (a < 71.5) ? smoothstep(0.0, 1.0, vUv.x) : (a < 72.5 ? smoothstep(1.0, 0.0, vUv.x) : sin(vUv.x * 3.14159));
            v = vec2(sx * taper, 0.0) * inten * 2.6;
        } else if (a < 77.5) { // tapered V2 + V3
            float taper2 = (a < 74.5) ? smoothstep(0.0, 1.0, vUv.x) : (a < 75.5 ? smoothstep(1.0, 0.0, vUv.x) : (a < 76.5 ? (0.5 + 0.5 * sin(vUv.x * 6.2831)) : sin(vUv.x * 3.14159)));
            if (a > 76.5) taper2 = sin(vUv.x * 3.14159) * (0.6 + 0.4 * sin(t * 2.0));
            v = vec2(sx * taper2 * 1.4, cy * 0.25 * taper2) * inten * 2.4;
        } else if (a < 78.5) v = vec2(cx, sy) * inten * 1.8;                  // Cos X & sin Y
        else v = vec2(sx, cy) * inten * 1.8;                                  // Sin X & cos Y
    }

    // taps for Average / Add-previous families + neighbor blur width
    float taps = 1.0;
    float addMix = 0.0;
    float neigh = 0.0;
    if (a > 28.5 && a < 29.5) { taps = 2.0; }
    else if (a >= 29.5 && a < 30.5) { taps = 2.0; }
    else if (a >= 30.5 && a < 31.5) { taps = 3.0; }
    else if (a >= 31.5 && a < 32.5) { taps = 5.0; }
    else if (a >= 32.5 && a < 33.5) { taps = 10.0; }
    else if (a >= 33.5 && a < 34.5) { taps = 15.0; }
    else if (a >= 34.5 && a < 35.5) { neigh = 1.0; }
    else if (a >= 35.5 && a < 36.5) { neigh = 2.0; }
    else if (a >= 36.5 && a < 37.5) { neigh = 3.0; }
    else if (a >= 37.5 && a < 38.5) { neigh = 4.0; }
    else if (a >= 38.5 && a < 39.5) { taps = 3.0; addMix = 0.35; }
    else if (a >= 39.5 && a < 40.5) { taps = 5.0; addMix = 0.35; }
    else if (a >= 40.5 && a < 41.5) { taps = 10.0; addMix = 0.35; }

    vec2 suv = vUv - v * act * 0.05;
    suv = clamp(suv, 0.0, 1.0);
    // macroblock pixelation: quantize the history fetch (the blocky logo look)
    vec2 q = floor(suv * resolution / bs) * bs / resolution + (bs * 0.5) / resolution;
    vec3 mosh = texture2D(tAnchor, (clamp(q, 0.0, 1.0)) * uvScale).rgb;
    // multi-tap smear along the vector (average previous N)
    for (int i = 1; i < 15; i++) {
        if (float(i) >= taps) break;
        vec2 tp = suv - v * act * 0.05 * float(i) / max(taps - 1.0, 1.0);
        tp = clamp(tp, 0.0, 1.0);
        vec2 tq = floor(tp * resolution / bs) * bs / resolution + (bs * 0.5) / resolution;
        vec3 ts = texture2D(tAnchor, (clamp(tq, 0.0, 1.0)) * uvScale).rgb;
        mosh = mix(mosh, ts, 1.0 / (float(i) + 1.0));
    }
    if (addMix > 0.001) mosh = clamp(mosh + orig.rgb * addMix, 0.0, 1.0);
    if (neigh > 0.5) {
        vec2 npx = neigh / resolution;
        vec3 acc = mosh;
        acc += texture2D(tAnchor, (clamp(q + vec2(npx.x, 0.0), 0.0, 1.0)) * uvScale).rgb;
        acc += texture2D(tAnchor, (clamp(q - vec2(npx.x, 0.0), 0.0, 1.0)) * uvScale).rgb;
        acc += texture2D(tAnchor, (clamp(q + vec2(0.0, npx.y), 0.0, 1.0)) * uvScale).rgb;
        acc += texture2D(tAnchor, (clamp(q - vec2(0.0, npx.y), 0.0, 1.0)) * uvScale).rgb;
        mosh = acc / 5.0;
    }
    // acceleration stretch: drag extra history for soupier trails
    vec3 stretched = texture2D(tAnchor, (clamp(q - v * act * 0.05 * acceleration, 0.0, 1.0)) * uvScale).rgb;
    mosh = mix(mosh, stretched, clamp(acceleration * 0.45, 0.0, 0.8));

    float m = act * clamp(blend, 0.0, 1.0) * 1.4 * clamp(amount, 0.0, 1.0);
    m = clamp(m, 0.0, 1.0);
    vec3 col = mix(orig.rgb, mosh, m);
    // faint compression noise so flat areas still boil like bad P-frames
    col += (hash12(floor(vUv * resolution) + vec2(sF, sF * 1.7)) - 0.5) * 0.02 * m;
    return vec4(col, orig.a);
}

#endif

vec2 transformMotion(vec2 total, vec2 block, vec2 p) {
    vec2 v = total * intensity;
    vec2 n = p / resolution - 0.5;
    if (motionMode < 0.5) return v;
    if (motionMode < 1.5) return v * 2.0;
    if (motionMode < 2.5) return vec2(0.0, v.y);
    if (motionMode < 3.5) return vec2(v.x, 0.0);
    if (motionMode < 4.5) return -n * resolution.x * 0.04 * intensity;
    if (motionMode < 5.5) return vec2(v.x + n.y * resolution.x * 0.05 * intensity, v.y);
    if (motionMode < 6.5) {
        return v + vec2(sin(frameIndex * 0.2 + block.y * 0.35), cos(frameIndex * 0.25 + block.x * 0.35)) * 4.0 * intensity;
    }
    if (motionMode < 7.5) return v.yx;
    vec2 r = vec2(hash12(block + vec2(seed * 0.37, segment * 0.11)),
                  hash12(block * 1.7 + vec2(segment * 0.23 + 3.1, seed * 0.13)));
    return (r - 0.5) * 24.0 * intensity;
}

void main() {
    vec4 original = texture2D(tOriginal, vUv * uvScale);
    if (hasSamples < 0.5 || amount <= 0.001) {
        gl_FragColor = original;
        return;
    }
#ifdef DATAMOSH_LEGACY_LOOK
    gl_FragColor = legacyColor(original);
#else
    vec2 p = vUv * resolution;
    vec2 block = floor(p / searchBlockSize);
    vec2 total = decodeVector(texture2D(tAccumulated, (block + 0.5) / blocks));
    vec2 v = transformMotion(total, block, p);
    vec3 moshed = texture2D(tAnchor, texCoord(p - v)).rgb;
    vec3 stretched = texture2D(tAnchor, texCoord(p - v * acceleration * 0.5)).rgb;
    moshed = mix(moshed, stretched, clamp(acceleration * 0.45, 0.0, 0.8));
    float diff = abs(luma(original.rgb) - luma(moshed));
    float jitter = (hash12(block + vec2(seed, segment)) - 0.5) * 0.30 * intensity;
    float act = smoothstep(threshold, threshold + 0.22, diff + jitter);
    float m = clamp(act * clamp(blend, 0.0, 1.0) * 1.4 * clamp(amount, 0.0, 1.0), 0.0, 1.0);
    vec3 col = mix(original.rgb, moshed, m);
    col += (hash12(floor(p) + vec2(frameIndex, seed * 1.7)) - 0.5) * 0.02 * m;
    gl_FragColor = vec4(col, original.a);
#endif
}
`;

function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function clampInteger(v, min, max, fallback) {
    v = Number(v);
    if (!isFinite(v)) v = fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
}

function readNumber(property, frame, fallback) {
    try {
        const value = Number(property && property.get ? property.get(frame) : NaN);
        return Number.isFinite(value) ? value : fallback;
    } catch (_error) {
        return fallback;
    }
}

function frameIndexOf(frame) {
    const value = Math.floor(Number(frame));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function keyframeIntervalOf(effect, frame) {
    return clampInteger(readNumber(effect.properties.interval, frame, 30), 2, 240, 30);
}

// Frame-sampler request. Samples sit at fixed offsets -d, -2d, ... so the
// earliest one is the anchor. d is an integer, so requests are exact.
function datamoshRequest(effect, frame) {
    const f = frameIndexOf(frame);
    const interval = keyframeIntervalOf(effect, frame);
    const age = f - Math.floor(f / interval) * interval;
    const enabled = readNumber(effect.properties.enabled, frame, 1) === 1 &&
        readNumber(effect.properties.amount, frame, 1) > 0.001;
    const wanted = clampInteger(readNumber(effect.properties.samples, frame, 6), 1, DATAMOSH_MAX_STEPS, 6);
    const legacyLook = readNumber(effect.properties.algorithm, frame, 0) > 0;
    const steps = Math.min(legacyLook ? 1 : wanted, age);
    if (!enabled || steps < 1) {
        return { enabled: false, count: 0, offsetFrames: -1, startOpacity: 1, decay: 1 };
    }
    return {
        enabled: true,
        count: steps,
        offsetFrames: -Math.floor(age / steps),
        startOpacity: 1,
        decay: 1,
    };
}

// Maps an index from the retired 80-item Algorithm list to the nine motion
// modes. Families with no close equivalent use the nearest visual behavior.
function legacyAlgorithmToMotion(index) {
    const a = Math.round(Number(index));
    if (!(a > 0)) return 0;
    if (a <= 2) return 1;
    if (a === 3) return 2;
    if (a === 4) return 3;
    if (a <= 7) return 4;
    if (a === 8) return 5;
    if (a === 9 || a === 16) return 6;
    if (a === 10) return 7;
    if (a <= 15) return 8;
    if (a <= 28) return 1;
    if (a <= 41) return 0;
    if (a <= 52) return 3;
    return 6;
}

function savedNumber(entry) {
    if (typeof entry === "number") return entry;
    if (entry && typeof entry === "object") {
        if (typeof entry.value === "number") return entry.value;
        const first = Array.isArray(entry.keyframes) ? entry.keyframes[0] : null;
        if (first && typeof first.value === "number") return first.value;
    }
    return undefined;
}

// Returns saved properties in the current key layout, retaining donor controls.
function migrateSavedProperties(saved) {
    if (!saved || typeof saved !== "object") return saved;
    const next = Object.assign({}, saved);
    if (next.motion === undefined && next.algorithm !== undefined) {
        const legacy = savedNumber(next.algorithm);
        if (legacy !== undefined) next.motion = legacyAlgorithmToMotion(legacy);
    }
    // Older files have no segment settings and use zero-based look indices.
    // Keep animated metadata and map every keyframe, not just the first value.
    if (next.algorithm !== undefined && next.interval === undefined) {
        const entry = next.algorithm;
        const shift = (value) => clampInteger(value, 0, 79, 0) + 1;
        if (typeof entry === "number") next.algorithm = shift(entry);
        else if (entry && typeof entry === "object") {
            next.algorithm = Object.assign({}, entry);
            if (typeof entry.value === "number") next.algorithm.value = shift(entry.value);
            if (Array.isArray(entry.keyframes)) {
                next.algorithm.keyframes = entry.keyframes.map((keyframe) =>
                    Object.assign({}, keyframe, { value: shift(keyframe.value) }));
            }
        }
    }
    return next;
}

function dmoshNum(name, value, min, max, step, decimals) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: step,
        decimals: decimals,
    };
}

function dmoshStructural(name, value, min, max) {
    return {
        dynamic: false,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: 1,
        decimals: 0,
    };
}

const datamoshProperties = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    setup: {
        name: "Setup",
        type: PZ.property.type.TEXT,
        value: "",
        zoidiumControl: DATAMOSH_SETUP_CONTROL,
    },
    algorithm: {
        dynamic: false, name: "Look", type: PZ.property.type.OPTION,
        value: 0, items: DATAMOSH_ALGORITHM_ITEMS,
    },
    hold: dmoshNum("Remove Frames (Hold)", 0, 0, 1, 0.01, 2),
    speed: dmoshNum("Speed", 1, 0, 5, 0.1, 1),
    time: {
        dynamic: true, name: "Time", type: PZ.property.type.NUMBER, step: 0.01,
        value(property) {
            property.animated = true;
            property.expression = new PZ.expression("time");
        },
    },
    amount: dmoshNum("Amount", 1, 0, 1, 0.01, 2),
    interval: dmoshStructural("I-frame Interval", 30, 2, 240),
    samples: dmoshStructural("Motion Samples", 6, 1, DATAMOSH_MAX_STEPS),
    motion: {
        dynamic: false,
        name: "Motion",
        type: PZ.property.type.OPTION,
        value: 0,
        items: DATAMOSH_MOTION_ITEMS,
    },
    intensity: dmoshNum("Intensity", 0.6, 0, 2, 0.01, 2),
    acceleration: dmoshNum("Acceleration", 0.35, 0, 1, 0.01, 2),
    blend: dmoshNum("Blend", 0.8, 0, 1, 0.01, 2),
    threshold: dmoshNum("Threshold", 0.12, 0, 1, 0.01, 2),
    blockSize: dmoshStructural("Block Size", 12, 2, 64),
    seed: dmoshStructural("Seed", 0, 0, 9999),
};

// Pass object assigned to effect.pass. render() runs one motion pass per
// sampled step and then one warp pass into the output. It keeps no history.
function DatamoshPass(effect) {
    THREE.Pass.call(this);
    this.effect = effect;
    this.resolution = new THREE.Vector2(2, 2);
    this.uniforms = {
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    };
    this.blockSize = 12;
    this.motionUniforms = {
        tCurrent: { type: "t", value: null },
        tEarlier: { type: "t", value: null },
        tAccumulated: { type: "t", value: null },
        hasAccumulated: { type: "f", value: 0 },
        resolution: { type: "v2", value: this.resolution },
        uvScale: this.uniforms.uvScale,
        blocks: { type: "v2", value: new THREE.Vector2(1, 1) },
        blockSize: { type: "f", value: 12 },
        spacing: { type: "f", value: 4 },
    };
    this.warpUniforms = {
        tOriginal: { type: "t", value: null },
        tAnchor: { type: "t", value: null },
        tAccumulated: { type: "t", value: null },
        resolution: { type: "v2", value: this.resolution },
        uvScale: this.uniforms.uvScale,
        blocks: { type: "v2", value: new THREE.Vector2(1, 1) },
        blockSize: { type: "f", value: 12 },
        hasSamples: { type: "f", value: 0 },
        searchBlockSize: { type: "f", value: 12 },
        amount: { type: "f", value: 1 },
        blend: { type: "f", value: 0.8 },
        intensity: { type: "f", value: 0.6 },
        acceleration: { type: "f", value: 0.35 },
        threshold: { type: "f", value: 0.12 },
        motionMode: { type: "f", value: 0 },
        frameIndex: { type: "f", value: 0 },
        segment: { type: "f", value: 0 },
        seed: { type: "f", value: 0 },
        algorithm: { type: "f", value: 0 },
        hold: { type: "f", value: 0 },
        speed: { type: "f", value: 1 },
        time: { type: "f", value: 0 },
    };
    const blockOptions = {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
    };
    // Nearest filtering keeps the encoded vectors exact.
    this.blockTargets = [
        new THREE.WebGLRenderTarget(1, 1, blockOptions),
        new THREE.WebGLRenderTarget(1, 1, blockOptions),
    ];
    this.blockTargets.forEach(function (target) {
        target.texture.generateMipmaps = false;
    });
    this.materialMotion = new THREE.ShaderMaterial({
        uniforms: this.motionUniforms,
        vertexShader: DATAMOSH_VERTEX_SHADER,
        fragmentShader: DATAMOSH_MOTION_SHADER,
    });
    this.materialWarp = new THREE.ShaderMaterial({
        uniforms: this.warpUniforms,
        vertexShader: DATAMOSH_VERTEX_SHADER,
        fragmentShader: DATAMOSH_WARP_SHADER,
    });
    this.materialWarp.premultipliedAlpha = true;
    this.materialLegacy = new THREE.ShaderMaterial({
        uniforms: this.warpUniforms,
        vertexShader: DATAMOSH_VERTEX_SHADER,
        fragmentShader: DATAMOSH_WARP_SHADER,
        defines: { DATAMOSH_LEGACY_LOOK: 1 },
    });
    this.materialLegacy.premultipliedAlpha = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.enabled = true;
    this.needsSwap = true;
}

DatamoshPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: DatamoshPass,
    setSize: function (width, height) {
        this.resolution.set(Math.max(2, Math.round(width)), Math.max(2, Math.round(height)));
    },
    setMask: function () {},
    resolveSamples: function () {
        const temporal = PZ.zoidium && PZ.zoidium.temporal;
        const samples = temporal && temporal.resolveFrameSamples
            ? temporal.resolveFrameSamples(this.effect) || []
            : [];
        return samples.filter(function (sample) {
            return sample && sample.texture;
        }).slice(0, DATAMOSH_MAX_STEPS);
    },
    // Chain step k pairs frame F(k) with the earlier sample k (F(0) is the
    // current source). Targets alternate so every step reads the last result.
    accumulateMotion: function (renderer, readBuffer, samples) {
        // Bound search work even at 4K with a two-pixel Block Size. The warp
        // remains full resolution; only the motion field uses a coarse grid.
        const searchBlockSize = Math.max(this.blockSize,
            Math.ceil(this.resolution.x / 64), Math.ceil(this.resolution.y / 36));
        const cols = Math.max(1, Math.ceil(this.resolution.x / searchBlockSize));
        const rows = Math.max(1, Math.ceil(this.resolution.y / searchBlockSize));
        this.blockTargets.forEach(function (target) {
            if (target.width !== cols || target.height !== rows) target.setSize(cols, rows);
        });
        this.motionUniforms.blocks.value.set(cols, rows);
        this.warpUniforms.blocks.value.set(cols, rows);
        this.motionUniforms.blockSize.value = searchBlockSize;
        this.warpUniforms.searchBlockSize.value = searchBlockSize;
        this.warpUniforms.blockSize.value = this.blockSize;
        this.motionUniforms.spacing.value = Math.max(1, Math.floor(searchBlockSize / 3));
        this.quad.material = this.materialMotion;
        for (let k = 0; k < samples.length; k += 1) {
            const current = k === 0 ? readBuffer.texture : samples[k - 1].texture;
            const write = this.blockTargets[k % 2];
            const previous = this.blockTargets[(k + 1) % 2];
            this.motionUniforms.tCurrent.value = current;
            this.motionUniforms.tEarlier.value = samples[k].texture;
            this.motionUniforms.tAccumulated.value = k > 0 ? previous.texture : samples[k].texture;
            this.motionUniforms.hasAccumulated.value = k > 0 ? 1 : 0;
            renderer.render(this.scene, this.camera, write, true);
        }
    },
    render: function (renderer, writeBuffer, readBuffer) {
        if (readBuffer.width > 0 && readBuffer.height > 0) {
            this.resolution.set(readBuffer.width, readBuffer.height);
        }
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        const output = writeBuffer || readBuffer;
        const samples = this.resolveSamples();
        const steps = samples.length;
        // Analytic legacy looks need the anchor but no motion-search passes.
        const search = steps > 0 && this.warpUniforms.algorithm.value < 0.5;
        if (search) this.accumulateMotion(renderer, readBuffer, samples);
        const warp = this.warpUniforms;
        warp.tOriginal.value = readBuffer.texture;
        warp.tAnchor.value = steps > 0 ? samples[steps - 1].texture : readBuffer.texture;
        warp.tAccumulated.value = search ? this.blockTargets[(steps - 1) % 2].texture : readBuffer.texture;
        warp.hasSamples.value = steps > 0 ? 1 : 0;
        this.quad.material = warp.algorithm.value > 0.5 ? this.materialLegacy : this.materialWarp;
        renderer.render(this.scene, this.camera, output, true);
        renderer.autoClear = oldAutoClear;
    },
    dispose: function () {
        this.blockTargets.forEach(function (target) {
            target.dispose();
        });
        this.materialMotion.dispose();
        this.materialWarp.dispose();
        this.materialLegacy.dispose();
        this.quad.geometry.dispose();
    },
});

const datamoshEffect = this;

ZoidiumPluginApis.defineFrameSampler.call(datamoshEffect, {
    displayName: "Datamosh",
    properties: datamoshProperties,
    getRequest(effect, frame) {
        return datamoshRequest(effect, frame);
    },
    lifecycle: {
        load(data) {
            datamoshEffect.pass = new DatamoshPass(datamoshEffect);
            datamoshEffect.pass.setSize(2, 2);
            datamoshEffect.properties.load(migrateSavedProperties(data && data.properties));
        },
        update(e) {
            const pass = datamoshEffect.pass;
            if (!pass) return;
            const props = datamoshEffect.properties;
            const f = frameIndexOf(e);
            const interval = keyframeIntervalOf(datamoshEffect, e);
            const blockSize = clampInteger(readNumber(props.blockSize, e, 12), 2, 64, 12);
            const amount = clamp01(readNumber(props.amount, e, 1));
            pass.blockSize = blockSize;
            const w = pass.warpUniforms;
            w.algorithm.value = clampInteger(readNumber(props.algorithm, e, 0), 0, 80, 0);
            w.hold.value = clamp01(readNumber(props.hold, e, 0));
            w.speed.value = Math.min(5, Math.max(0, readNumber(props.speed, e, 1)));
            w.time.value = readNumber(props.time, e, f / 30);
            w.amount.value = amount;
            w.blend.value = clamp01(readNumber(props.blend, e, 0.8));
            w.intensity.value = Math.min(2, Math.max(0, readNumber(props.intensity, e, 0.6)));
            w.acceleration.value = clamp01(readNumber(props.acceleration, e, 0.35));
            w.threshold.value = clamp01(readNumber(props.threshold, e, 0.12));
            w.blockSize.value = blockSize;
            w.motionMode.value = clampInteger(readNumber(props.motion, e, 0), 0, 8, 0);
            w.frameIndex.value = f;
            w.segment.value = Math.floor(f / interval);
            w.seed.value = clampInteger(readNumber(props.seed, e, 0), 0, 9999, 0);
            pass.enabled = readNumber(props.enabled, e, 1) === 1 && amount !== 0;
        },
        unload() {
            if (datamoshEffect.pass) {
                datamoshEffect.pass.dispose();
            }
        },
        resize() {
            if (!datamoshEffect.pass || !datamoshEffect.parentLayer) {
                return;
            }
            const resolution = datamoshEffect.parentLayer.properties.resolution.get();
            datamoshEffect.pass.setSize(resolution[0], resolution[1]);
        },
    },
});

// CM3's layer prepare() does not forward its render context to effects.
// Lower-track media preparation still needs the sequence and project rate.
const prepareWithContext = this.prepare;
if (typeof prepareWithContext === "function") {
    this.prepare = function (frame, context) {
        if (!context || !context.sequence) {
            context = Object.assign({}, context, { sequence: this.parentProject.sequence });
        }
        return prepareWithContext.call(this, frame, context);
    };
}
