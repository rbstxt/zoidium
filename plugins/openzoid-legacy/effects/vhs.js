// OpenZoid Legacy — VHS.
// Ported from the OpenZoid effect/vhs.js signal chain. All shaders are inline.
//
// Determinism: the tape, noise, tracking and chroma distortions are pure
// functions of time, seed-like hashes and properties. Persistence (trails) is
// the only temporal part. It averages earlier SOURCE frames requested through
// the frame sampler, so it never reads this effect's previous output.
// Trails sample earlier clip content or the composite below an Adjustment.
// The "Setup" row opens the VHS Setup floating window (vhs-setup.js).

// ---------------------------------------------------------------------------
// VHS — Quality rebuild, screenshot-identical pass (Color + Image)
// ---------------------------------------------------------------------------
// Reference: 10 screenshots (MESECAM bars, WTTW Chicago 11 ident, pattern,
// streak strip, desat ident, B&W tears, blue blowout, pink Peoria, split).
// COLORS
//   signalStrength : color tears / chroma dots beside saturated colors (01)
//   colorStripes   : scrolling color-shift line bars, hue jumps (02)
//   chromaCrawl    : edge-locked crawling dot shift (02/03/04)
//   chromaLoss     : per-line mono dropouts + global desat (06)
//   flicker        : AGC wander + black/white diffusion flashes (08)
// IMAGE
//   vhsSharpen     : asymmetric transient — left-side sharpen, right smear (01/03)
//   interlace      : -1 frame offset only, no scanlines (04)
//   blinds           : tiny venetian slats, 0.5 opacity, own switch (off)
//   snowDots         : white boiling dashes, dense at bottom, fit displacement
//   speedDots        : fast horizontal dot streaks (motion streaks)
//   anisoSnow        : comet dots riding thin travelling lines
//   staticWarp     : 1px dropout streaks + band warp, denser as quality drops (05)
//   fastForward    : sine skew + rolling noise bars + specks (07)
//   tracking       : hard displaced band + black side fill + head switch (09)
//   anisotropyWarp : second band, other position + local color loss (10)
// MOTION: jitterX/jitterY per-line + global, roll/rollSpeed, persistence.
// YT FUNCTIONS (tutorials): rgbSplit tear humBar blueScreen skew crease ghost osd.
// Noise engine: evolving scrolling streak noise — noiseEvo (scroll+boil),
// noiseOpacity (band mix).
// Research grounding: AVAA head-switching/tracking error, vhs-decode RF
// dropout + dropout-compensator concealment, heterodyne color-under
// generation loss (bleed-then-loss), comb-filter failure on bad timebase
// (dot crawl bursts where lines jitter), rightward-only VHS smear.
// Hardware traits always on: per-line start jitter, chroma-under bleed,
// bottom head-switching wobble.
// ---------------------------------------------------------------------------

const VHS_VERTEX_SHADER = `
uniform vec2 uvScale;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VHS_SIGNAL_SHADER = `
uniform sampler2D tDiffuse;
uniform sampler2D tPrev;
uniform vec2 resolution;
uniform vec2 uvScale;
uniform float time;
uniform float amount;
uniform float hasHistory;
uniform float persistence;

uniform float signalStrength;
uniform float colorStripes;
uniform float chromaCrawl;
uniform float chromaLoss;
uniform float flicker;

uniform float vhsSharpen;
uniform float interlace;
uniform float staticWarp;
uniform float fastForward;
uniform float tracking;
uniform float anisotropyWarp;
uniform float rgbSplit;
uniform float tear;
uniform float humBar;
uniform float blueScreen;
uniform float skew;
uniform float crease;
uniform float ghost;
uniform float osd;
uniform float noiseEvo;
uniform float noiseOpacity;
uniform float blinds;
uniform float snowDots;
uniform float speedDots;
uniform float anisoSnow;

uniform float jitterX;
uniform float jitterY;
uniform float roll;
uniform float rollSpeed;

varying vec2 vUv;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 rot2(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

vec3 rgb2ycbcr(vec3 c) {
    return vec3(
        dot(c, vec3(0.299, 0.587, 0.114)),
        dot(c, vec3(-0.168736, -0.331264, 0.5)) + 0.5,
        dot(c, vec3(0.5, -0.418688, -0.081312)) + 0.5
    );
}

vec3 ycbcr2rgb(vec3 c) {
    vec3 ycc = c - vec3(0.0, 0.5, 0.5);
    return vec3(
        ycc.x + 1.402 * ycc.z,
        ycc.x - 0.344136 * ycc.y - 0.714136 * ycc.z,
        ycc.x + 1.772 * ycc.y
    );
}

// Identical 5x7 VHS OSD font. ids: 0 space, 1 P, 2 L, 3 A, 4 Y, 5 S,
// 6 -, 7 :, 8 solid play triangle, 9-18 digits 0-9. Bit 0 = left column.
float osdRow(float id, float row) {
    if (id < 0.5) return 0.0;
    if (id < 1.5) {
        if (row < 0.5) return 31.0;
        else if (row < 1.5) return 17.0;
        else if (row < 2.5) return 17.0;
        else if (row < 3.5) return 31.0;
        else if (row < 4.5) return 1.0;
        else if (row < 5.5) return 1.0;
        return 1.0;
    }
    if (id < 2.5) {
        if (row < 5.5) return 1.0;
        return 31.0;
    }
    if (id < 3.5) {
        if (row < 0.5) return 4.0;
        else if (row < 1.5) return 10.0;
        else if (row < 2.5) return 17.0;
        else if (row < 3.5) return 17.0;
        else if (row < 4.5) return 31.0;
        else if (row < 5.5) return 17.0;
        return 17.0;
    }
    if (id < 4.5) {
        if (row < 0.5) return 17.0;
        else if (row < 1.5) return 17.0;
        else if (row < 2.5) return 10.0;
        else if (row < 3.5) return 4.0;
        else if (row < 4.5) return 4.0;
        else if (row < 5.5) return 4.0;
        return 4.0;
    }
    if (id < 5.5) {
        if (row < 0.5) return 30.0;
        else if (row < 1.5) return 1.0;
        else if (row < 2.5) return 1.0;
        else if (row < 3.5) return 14.0;
        else if (row < 4.5) return 16.0;
        else if (row < 5.5) return 16.0;
        return 30.0;
    }
    if (id < 6.5) {
        if (row < 2.5) return 0.0;
        else if (row < 3.5) return 31.0;
        return 0.0;
    }
    if (id < 7.5) {
        if (row < 1.5) return 0.0;
        else if (row < 2.5) return 6.0;
        else if (row < 3.5) return 0.0;
        else if (row < 4.5) return 6.0;
        return 0.0;
    }
    if (id < 8.5) {
        if (row < 0.5) return 1.0;
        else if (row < 1.5) return 3.0;
        else if (row < 2.5) return 7.0;
        else if (row < 3.5) return 31.0;
        else if (row < 4.5) return 7.0;
        else if (row < 5.5) return 3.0;
        return 1.0;
    }
    if (id < 9.5) {
        if (row < 0.5) return 14.0;
        else if (row < 1.5) return 17.0;
        else if (row < 2.5) return 17.0;
        else if (row < 3.5) return 17.0;
        else if (row < 4.5) return 17.0;
        else if (row < 5.5) return 17.0;
        return 14.0;
    }
    if (id < 10.5) {
        if (row < 0.5) return 4.0;
        else if (row < 1.5) return 6.0;
        else if (row < 2.5) return 4.0;
        else if (row < 3.5) return 4.0;
        else if (row < 4.5) return 4.0;
        else if (row < 5.5) return 4.0;
        return 14.0;
    }
    if (id < 11.5) {
        if (row < 0.5) return 14.0;
        else if (row < 1.5) return 16.0;
        else if (row < 2.5) return 8.0;
        else if (row < 3.5) return 4.0;
        else if (row < 4.5) return 2.0;
        else if (row < 5.5) return 1.0;
        return 31.0;
    }
    if (id < 12.5) {
        if (row < 0.5) return 31.0;
        else if (row < 1.5) return 16.0;
        else if (row < 2.5) return 8.0;
        else if (row < 3.5) return 14.0;
        else if (row < 4.5) return 16.0;
        else if (row < 5.5) return 16.0;
        return 14.0;
    }
    if (id < 13.5) {
        if (row < 0.5) return 8.0;
        else if (row < 1.5) return 12.0;
        else if (row < 2.5) return 10.0;
        else if (row < 3.5) return 17.0;
        else if (row < 4.5) return 31.0;
        else if (row < 5.5) return 8.0;
        return 8.0;
    }
    if (id < 14.5) {
        if (row < 0.5) return 31.0;
        else if (row < 1.5) return 1.0;
        else if (row < 2.5) return 14.0;
        else if (row < 3.5) return 16.0;
        else if (row < 4.5) return 16.0;
        else if (row < 5.5) return 17.0;
        return 14.0;
    }
    if (id < 15.5) {
        if (row < 0.5) return 14.0;
        else if (row < 1.5) return 1.0;
        else if (row < 2.5) return 1.0;
        else if (row < 3.5) return 14.0;
        else if (row < 4.5) return 17.0;
        else if (row < 5.5) return 17.0;
        return 14.0;
    }
    if (id < 16.5) {
        if (row < 0.5) return 31.0;
        else if (row < 1.5) return 16.0;
        else if (row < 2.5) return 8.0;
        else if (row < 3.5) return 4.0;
        else if (row < 4.5) return 4.0;
        else if (row < 5.5) return 4.0;
        return 4.0;
    }
    if (id < 17.5) {
        if (row < 0.5) return 14.0;
        else if (row < 1.5) return 17.0;
        else if (row < 2.5) return 17.0;
        else if (row < 3.5) return 14.0;
        else if (row < 4.5) return 17.0;
        else if (row < 5.5) return 17.0;
        return 14.0;
    }
    if (row < 0.5) return 14.0;
    else if (row < 1.5) return 17.0;
    else if (row < 2.5) return 17.0;
    else if (row < 3.5) return 14.0;
    else if (row < 4.5) return 16.0;
    else if (row < 5.5) return 16.0;
    return 14.0;
}

void main() {
    float t = time;
    float frame = floor(t * 30.0);
    float fieldParity = mod(frame, 2.0);
    vec2 px = 1.0 / resolution;
    vec4 orig = texture2D(tDiffuse, vUv * uvScale);
    vec2 uv = vUv;
    float lineF = floor(vUv.y * resolution.y);

    // ---- 0. per-line start jitter (line timing error — visible in every shot)
    float lineR1 = hash12(vec2(lineF, frame));
    float lineJitAmt = jitterX * 0.004 + tracking * 0.020 + staticWarp * 0.006 + fastForward * 0.010;
    uv.x += (lineR1 - 0.5) * 2.0 * lineJitAmt;
    // flagwave: top of frame skews
    float topMask = smoothstep(0.28, 0.0, vUv.y);
    uv.x += topMask * (sin(t * 3.0 + vUv.y * 40.0) + 0.5 * sin(t * 7.7 + vUv.y * 13.0)) * 0.004 * (0.2 + skew * 2.2 + jitterX * 0.5 + tracking * 1.2);

    // ---- 1. global jitter X/Y (anti-stiffness micro offset)
    float jx = (hash12(vec2(frame, 17.0)) - 0.5) * 2.0;
    float jy = (hash12(vec2(frame, 91.0)) - 0.5) * 2.0;
    jx += (vnoise(vec2(t * 9.0, 3.0)) - 0.5);
    jy += (vnoise(vec2(7.0, t * 8.0)) - 0.5);
    uv.x += jx * jitterX * 0.006;
    uv.y += jy * jitterY * 0.006;

    // ---- 2. roll (vertical rewind offset with seam)
    float seam = 0.0;
    if (roll > 0.001) {
        float rollPos = roll * fract(t * rollSpeed);
        float tearPos = fract(1.0 - rollPos);
        float d = abs(fract(vUv.y - tearPos + 0.5) - 0.5);
        seam = (1.0 - smoothstep(0.0, 0.02 + 0.06 * roll, d)) * roll;
        uv.y = fract(uv.y + rollPos);
        uv.x += seam * (hash12(vec2(floor(uv.y * resolution.y), frame + 5.0)) - 0.5) * 0.6;
    }

    // ---- 2b. tear: random horizontal slice tears (YT tracking-lines)
    if (tear > 0.001) {
        float slice = floor(vUv.y * 36.0);
        float tseed = floor(t * 18.0);
        float tearOn = step(1.0 - tear * 0.55, hash12(vec2(slice, tseed)));
        float tearMag = (hash12(vec2(slice * 3.7, tseed + 5.0)) - 0.5) * 2.0;
        uv.x += tearOn * tearMag * tear * 0.25;
        uv.x = fract(uv.x);
    }

    // ---- 3. fastForward: strong sine skew + rolling noise bars
    float ffMask = 0.0;
    if (fastForward > 0.001) {
        float ffSine = sin(uv.y * 38.0 - t * 20.0) + 0.5 * sin(uv.y * 11.0 + t * 7.0);
        uv.x += ffSine * 0.045 * fastForward;
        float c1 = fract(t * 0.45);
        float c2 = fract(t * 0.45 + 0.5);
        float d1 = abs(fract(uv.y - c1 + 0.5) - 0.5);
        float d2 = abs(fract(uv.y - c2 + 0.5) - 0.5);
        float w = 0.03 + 0.10 * fastForward;
        ffMask = max((1.0 - smoothstep(0.0, w, d1)), (1.0 - smoothstep(0.0, w, d2))) * fastForward;
        uv.x += ffMask * (hash12(vec2(floor(uv.y * resolution.y), frame + 17.0)) - 0.5) * 0.35;
        uv.y += sin(uv.x * 20.0 + t * 17.0) * 0.006 * fastForward;
    }

    // ---- 4. tracking: hard displaced band + black side fill
    float trackMask = 0.0;
    float trackOutside = 0.0;
    if (tracking > 0.001) {
        float center = fract(t * 0.16);
        float dist = abs(fract(uv.y - center + 0.5) - 0.5);
        float edge0 = 0.004 + 0.20 * tracking;
        trackMask = (1.0 - smoothstep(0.0, edge0, dist)) * tracking;
        float wob = sin(uv.y * 60.0 + t * 8.0) * 0.5 + 0.5;
        float shift = (hash12(vec2(floor(uv.y * resolution.y), frame * 1.7)) - 0.5) * 0.8;
        shift += (wob - 0.5) * 0.30;
        float bandPos = clamp((uv.y - center) / max(edge0, 0.001), -1.0, 1.0);
        shift += bandPos * 0.12 * tracking;
        float shiftedX = uv.x + shift * trackMask;
        trackOutside = step(shiftedX, 0.0) + step(1.0, shiftedX);
        trackOutside = clamp(trackOutside, 0.0, 1.0);
        uv.x = clamp(shiftedX, 0.0, 1.0);
    }

    // ---- 4b. head switching: bottom ~6% wobbles (shots 09/10)
    float hsH = 0.05 + 0.22 * tracking + 0.06 * fastForward;
    float hsMask = smoothstep(hsH, 0.0, vUv.y);
    uv.x += hsMask * (hash12(vec2(lineF, frame + 3.0)) - 0.5) * (0.015 + 0.22 * tracking + 0.08 * fastForward);
    uv.x += hsMask * (hash12(vec2(lineF, frame + 43.0)) - 0.5) * staticWarp * 0.10;

    // ---- 5. staticWarp band vs anisotropyWarp band (other position)
    float staticBand = 0.0;
    float anisoBand = 0.0;
    if (staticWarp > 0.001) {
        float c = fract(t * 0.21);
        float d = abs(fract(uv.y - c + 0.5) - 0.5);
        staticBand = (1.0 - smoothstep(0.0, 0.02 + 0.20 * staticWarp, d)) * staticWarp;
        uv.x += staticBand * (hash12(vec2(floor(uv.y * resolution.y), frame + 37.0)) - 0.5) * 0.5;
    }
    if (anisotropyWarp > 0.001) {
        float c2 = fract(t * 0.13 + 0.5);
        float d2 = abs(fract(uv.y - c2 + 0.5) - 0.5);
        anisoBand = (1.0 - smoothstep(0.0, 0.02 + 0.20 * anisotropyWarp, d2)) * anisotropyWarp;
        uv.x += anisoBand * (hash12(vec2(floor(uv.y * resolution.y) + 61.0, frame + 53.0)) - 0.5) * 0.5;
        uv.y += anisoBand * (hash12(vec2(floor(uv.x * resolution.x), frame + 71.0)) - 0.5) * 0.02;
    }
    // ---- 5b. crease: diagonal tape-crease band (YT wrinkle)
    if (crease > 0.001) {
        float cdiag = vUv.x * 0.6 + vUv.y;
        float cc = fract(t * 0.10);
        float cdist = abs(fract(cdiag - cc + 0.5) - 0.5);
        float cmask = (1.0 - smoothstep(0.0, 0.01 + 0.08 * crease, cdist)) * crease;
        uv.x += cmask * (hash12(vec2(floor(cdiag * 90.0), frame + 29.0)) - 0.5) * 0.4;
        uv.y += cmask * 0.01;
    }
    uv.x = fract(uv.x);
    uv.y = clamp(uv.y, 0.0, 1.0);

    // ---- 5c. evolving streak-noise engine: sharp 1px lines whose brightness
    // morphs over time (time-slice interpolation), scrolling vertically.
    // Opacity (noiseOpacity) mixes it into the tracking / FF bands.
    float evoSnow = 0.0;
    if (noiseOpacity > 0.001 && max(trackMask, max(ffMask, staticBand)) > 0.001) {
        float evoScroll = t * (14.0 + noiseEvo * 90.0);
        float nyCell = floor(vUv.y * resolution.y - evoScroll);
        float tSlice = t * (6.0 + noiseEvo * 30.0);
        float t0 = floor(tSlice);
        float tS = fract(tSlice);
        tS = tS * tS * (3.0 - 2.0 * tS);
        float m0 = mod(t0, 997.0);
        float vA = hash12(vec2(nyCell, m0));
        float vB = hash12(vec2(nyCell, mod(m0 + 1.0, 997.0)));
        float lineEvo = mix(vA, vB, tS);
        float egrain = hash13(vec3(floor(vUv.x * resolution.x * 0.5), nyCell, floor(tSlice * 0.5)));
        evoSnow = clamp(lineEvo * 0.72 + egrain * 0.28, 0.0, 1.0);
        evoSnow = evoSnow * evoSnow * (3.0 - 2.0 * evoSnow);
    }

    // ---- 6. base sample + always-on chroma-under bleed (soft VHS color)
    vec3 base = texture2D(tDiffuse, uv * uvScale).rgb;
    // YT chromatic aberration: R/B split around green
    if (rgbSplit > 0.001) {
        float ab = rgbSplit * 0.008;
        base.r = texture2D(tDiffuse, clamp(uv + vec2(ab, 0.0), 0.0, 1.0) * uvScale).r;
        base.b = texture2D(tDiffuse, clamp(uv - vec2(ab, 0.0), 0.0, 1.0) * uvScale).b;
    }
    vec3 ycc0 = rgb2ycbcr(base);
    float y = ycc0.x;
    float bleedW = 1.0 + chromaLoss * 1.5;
    vec2 cA = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(-px.x * 3.5 * bleedW, 0.0), 0.0, 1.0) * uvScale).rgb).yz;
    vec2 cB = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(-px.x * 2.5 * bleedW, 0.0), 0.0, 1.0) * uvScale).rgb).yz;
    vec2 cC = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(-px.x * 1.5 * bleedW, 0.0), 0.0, 1.0) * uvScale).rgb).yz;
    vec2 cD = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(-px.x * 0.5 * bleedW, 0.0), 0.0, 1.0) * uvScale).rgb).yz;
    vec2 cE = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(px.x * 0.5 * bleedW, 0.0), 0.0, 1.0) * uvScale).rgb).yz;
    vec2 cbcr = cA * 0.10 + cB * 0.22 + cC * 0.30 + cD * 0.24 + cE * 0.14;
    // swimming color-under blotches
    float blotchAmp = 0.10 + 0.25 * signalStrength + 0.20 * tracking;
    vec2 blotch = vec2(vnoise(vec2(uv.x * 9.0, uv.y * 9.0) + t * 0.6) - 0.5,
                       vnoise(vec2(uv.x * 9.0 + 31.0, uv.y * 9.0 + 17.0) - t * 0.5) - 0.5);
    cbcr += blotch * blotchAmp * 0.35;

    // base VHS luma softness (~240 lines FM) — hardware trait, always on
    float yBsL = rgb2ycbcr(texture2D(tDiffuse, clamp(uv - vec2(px.x, 0.0), 0.0, 1.0) * uvScale).rgb).x;
    float yBsR = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(px.x, 0.0), 0.0, 1.0) * uvScale).rgb).x;
    y = mix(y, (yBsL + y * 2.0 + yBsR) * 0.25, 0.30);
    // fine grain boil — per-pixel, no scroll, no stretch (old streakN crawled)
    float darkW = 1.0 - smoothstep(0.0, 0.45, y);
    float gA = hash13(vec3(floor(vUv.x * resolution.x), lineF, frame));
    float gB = hash13(vec3(floor(vUv.x * resolution.x), lineF, frame + 7.0));
    y += ((gA * 0.65 + gB * 0.35) - 0.5) * (0.03 + 0.08 * staticWarp + 0.06 * tracking + 0.04 * signalStrength) * (1.0 + darkW * 0.9);

    // ---- 7. vhsSharpen: asymmetric transient, stronger on left half (shot 03)
    if (vhsSharpen > 0.001) {
        float yLL = rgb2ycbcr(texture2D(tDiffuse, clamp(uv - vec2(px.x * 2.0, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float yL = rgb2ycbcr(texture2D(tDiffuse, clamp(uv - vec2(px.x, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float yR = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(px.x, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float blurRef = yLL * 0.15 + yL * 0.35 + y * 0.30 + yR * 0.20;
        float detail = y - blurRef;
        float leftBoost = 1.0 - smoothstep(0.30, 0.70, vUv.x);
        float k = vhsSharpen * (0.6 + 0.9 * leftBoost);
        y += clamp(detail, -0.25, 0.25) * k * 2.0;
        float smear = yR * 0.6 + y * 0.4;
        float rightMask = smoothstep(0.60, 1.0, vUv.x);
        y = mix(y, smear, rightMask * vhsSharpen * 0.35);
    }

    // ---- 8. signalStrength: full-line hue tears + dot row (shot 01)
    if (signalStrength > 0.001) {
        float line = floor(vUv.y * resolution.y);
        float seedF = floor(t * 24.0);
        float tearOn = step(1.0 - signalStrength * 0.5, hash12(vec2(line, seedF)));
        float tearLen = 0.03 + 0.30 * hash12(vec2(line, seedF + 11.0));
        float tearStart = hash12(vec2(line, seedF + 23.0));
        float tearMask = tearOn * step(tearStart, vUv.x) * step(vUv.x, tearStart + tearLen);
        float tearPhase = (hash12(vec2(line, 7.0)) - 0.5) * 2.0;
        cbcr = mix(cbcr, rot2(cbcr - vec2(0.5), tearPhase * 0.9 * tearMask) + vec2(0.5), tearMask * 0.85);
        vec2 tearUv = clamp(uv - vec2(tearMask * 0.03, 0.0), 0.0, 1.0);
        vec2 tearCbCr = rgb2ycbcr(texture2D(tDiffuse, tearUv * uvScale).rgb).yz;
        cbcr = mix(cbcr, tearCbCr, tearMask * 0.55);
        float alt = step(1.0, mod(line, 2.0));
        float dotRow = step(0.55, fract(vUv.x * 300.0 + alt * 0.5)) * tearMask;
        vec2 dotCol = alt > 0.5 ? vec2(0.30, -0.30) : vec2(-0.30, 0.30);
        float combTear = 0.6 + 0.8 * abs(lineR1 - 0.5) * 2.0;
        cbcr += dotRow * dotCol * signalStrength * combTear;
    }

    // ---- 9. colorStripes: scrolling hue bands (shot 02 WTTW)
    if (colorStripes > 0.001) {
        float sy = fract(vUv.y * 2.5 - t * 0.22);
        float bandId = floor(sy * 6.0);
        float bandShift = (hash12(vec2(bandId, floor(t * 3.0))) - 0.5) * 2.0;
        cbcr = rot2(cbcr - vec2(0.5), bandShift * colorStripes * 0.8) + vec2(0.5);
        float slide = vnoise(vec2(0.0, t * 1.5)) - 0.5;
        vec2 stripeUv = clamp(uv + vec2(slide * 0.02 * colorStripes, 0.0), 0.0, 1.0);
        vec2 stripeCbCr = rgb2ycbcr(texture2D(tDiffuse, stripeUv * uvScale).rgb).yz;
        float bars = smoothstep(0.30, 0.95, sin(vUv.y * 160.0 + t * 5.4) * 0.5 + 0.5);
        cbcr = mix(cbcr, stripeCbCr, bars * colorStripes * 0.55);
        float rainbow = sin(vUv.y * 220.0 + t * 30.0) * 0.5 + 0.5;
        cbcr += vec2(rainbow - 0.5, 0.5 - rainbow) * bars * colorStripes * 0.22;
    }

    // ---- 10. chromaCrawl: edge-locked crawling shift (shots 02/03/04)
    if (chromaCrawl > 0.001) {
        float yl = rgb2ycbcr(texture2D(tDiffuse, clamp(uv - vec2(px.x, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float yr = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(px.x, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float yl2 = rgb2ycbcr(texture2D(tDiffuse, clamp(uv - vec2(px.x * 2.0, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float yr2 = rgb2ycbcr(texture2D(tDiffuse, clamp(uv + vec2(px.x * 2.0, 0.0), 0.0, 1.0) * uvScale).rgb).x;
        float edge = clamp(abs(y - yl) + abs(y - yr), 0.0, 1.0);
        float combFail = 0.45 + 1.1 * abs(lineR1 - 0.5) * 2.0 * (0.3 + jitterX + tracking);
        float crawl = sin(vUv.x * 420.0 + t * 28.0 + sin(vUv.y * 90.0 + t * 6.0));
        cbcr += vec2(crawl, -crawl) * edge * chromaCrawl * 0.45 * combFail;
        // checkerboard dot crawl, phase flips every field
        float checker = mod(floor(vUv.x * resolution.x) + lineF + fieldParity, 2.0) * 2.0 - 1.0;
        cbcr += vec2(checker, -checker) * edge * chromaCrawl * 0.12 * (0.5 + 0.5 * sin(t * 25.0)) * combFail;
        // cross-chroma rainbow boiling out of fine luma detail
        float hfDet = clamp(abs(yl2 - yr2) + abs(yl - yr) * 0.5 - 0.08, 0.0, 1.0);
        float rb = sin(vUv.x * 300.0 + t * 20.0 + vUv.y * 60.0);
        cbcr += vec2(rb, -rb) * hfDet * chromaCrawl * 0.55 * combFail;
        vec2 crawlUv = clamp(uv + vec2(crawl * 0.004 * chromaCrawl, 0.0), 0.0, 1.0);
        vec2 crawlCbCr = rgb2ycbcr(texture2D(tDiffuse, crawlUv * uvScale).rgb).yz;
        cbcr = mix(cbcr, crawlCbCr, chromaCrawl * 0.35);
    }

    if (trackMask > 0.001) {
        cbcr = mix(cbcr, vec2(0.5), trackMask * 0.45);
    }
    // mistracking pulls hue toward magenta and wanders
    if (tracking > 0.001) {
        float hueDrift = tracking * 0.35 * (0.5 + 0.5 * sin(t * 2.0 + vUv.y * 4.0));
        cbcr = rot2(cbcr - vec2(0.5), hueDrift) + vec2(0.5);
    }

    vec3 col = ycbcr2rgb(vec3(y, cbcr));

    // ---- 11. chromaLoss: per-line mono dropouts + global desat (shot 06)
    if (chromaLoss > 0.001) {
        float killSeed = hash12(vec2(lineF, floor(t * 12.0)));
        float kill = step(1.0 - chromaLoss * 0.60, killSeed);
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), kill);
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(luma), clamp(chromaLoss * 0.70, 0.0, 1.0));
    }

    // anisotropyWarp washes color locally (shot 10)
    if (anisoBand > 0.001) {
        float luma2 = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(luma2), anisoBand * anisotropyWarp * 0.55);
    }

    // ---- 12. dropout streaks: 1px white/black lines with smeared tail (shot 05)
    float qualityLoss = clamp(chromaLoss * 0.7 + tracking * 0.5 + signalStrength * 0.3, 0.0, 1.5);
    if (staticWarp > 0.001) {
        float spawnBase = staticWarp * (0.30 + 0.70 * clamp(qualityLoss, 0.0, 1.0));
        float rOn = hash12(vec2(lineF, frame * 1.7));
        float oddField = step(mod(lineF + fieldParity, 2.0), 1.0);
        float clog = 1.0 + staticWarp * tracking * (oddField * 0.9 - 0.3);
        float on = step(1.0 - spawnBase * 0.30 * clog, rOn);
        float st = hash12(vec2(lineF, frame * 1.7 + 11.0));
        float ln = 0.02 + 0.30 * hash12(vec2(lineF, frame * 1.7 + 23.0));
        float inStreak = on * step(st, vUv.x) * step(vUv.x, st + ln);
        float white = hash12(vec2(lineF, frame + 41.0)) > 0.25 ? 0.95 : 0.05;
        float tailFade = 1.0 - clamp((vUv.x - st) / max(ln, 0.001), 0.0, 1.0);
        float gate = clamp(staticBand + 0.35 * staticWarp, 0.0, 1.0);
        col = mix(col, vec3(white), inStreak * gate * (0.35 + 0.65 * tailFade));
        // dropout compensator halo: deck smears the line above around the hit
        vec3 lineAbove = texture2D(tDiffuse, clamp(vec2(uv.x, uv.y - px.y), 0.0, 1.0) * uvScale).rgb;
        col = mix(col, lineAbove, inStreak * gate * 0.18 * (1.0 - tailFade));
        // fine specks inside band
        vec2 cell = vec2(floor(vUv.x * resolution.x * 0.5), lineF);
        float r = hash13(vec3(cell, frame));
        float dot_ = step(1.0 - spawnBase * 0.10, r) * staticBand;
        col = mix(col, vec3(0.95), clamp(dot_, 0.0, 1.0));
    }
    if (fastForward > 0.001) {
        vec2 cell2 = vec2(floor(vUv.x * resolution.x * 0.35), floor(vUv.y * resolution.y * 0.75));
        float r3 = hash13(vec3(cell2, frame + 13.0));
        float sineGate = 0.5 + 0.5 * sin(vUv.y * 38.0 - t * 20.0);
        float dot2 = step(1.0 - fastForward * 0.10 * (0.4 + 0.6 * sineGate), r3);
        col = mix(col, vec3(0.92), clamp(dot2 * fastForward, 0.0, 1.0));
        col = mix(col, vec3(evoSnow), ffMask * noiseOpacity);
        col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), ffMask * 0.35);
    }
    if (anisotropyWarp > 0.001) {
        vec2 cell3 = vec2(floor(vUv.x * resolution.x * 0.20), lineF);
        float r4 = hash13(vec3(cell3, frame + 29.0));
        float dot3 = step(1.0 - anisotropyWarp * 0.10, r4) * max(anisoBand, 0.25 * anisotropyWarp);
        col = mix(col, vec3(0.93), clamp(dot3, 0.0, 1.0));
    }

    // ---- 13. tracking snow + black side fill (shot 09)
    if (trackMask > 0.001) {
        col = mix(col, vec3(evoSnow), trackMask * noiseOpacity);
        float edgeLine = (1.0 - smoothstep(0.0, 0.006, abs(fract(uv.y - fract(t * 0.16) + 0.5) - 0.5) - (0.004 + 0.20 * tracking))) * tracking;
        col = mix(col, vec3(0.85), clamp(edgeLine, 0.0, 1.0) * 0.5);
        col = mix(col, vec3(0.0), clamp(trackOutside + trackMask * trackMask * 0.35, 0.0, 1.0));
    }

    // snowDots: chunky white boiling dots + comet streaks, dense at bottom.
    // SPAWN behavior: raising snowDots births more dots, never fades them.
    if (snowDots > 0.001) {
        float dens = mix(1.0, 0.10, vUv.y);
        float dFrame = floor(t * 12.0);
        vec2 dcell = vec2(floor(uv.x * resolution.x * 0.015625), floor(uv.y * resolution.y * 0.0625));
        float rD = hash13(vec3(dcell, dFrame));
        float onD = step(1.0 - snowDots * dens * 0.35, rD);
        float dx = fract(uv.x * resolution.x * 0.015625);
        float dlen = 0.25 + 0.70 * hash12(vec2(dcell.x, dFrame + 3.0));
        float dscl = 0.45 + 0.55 * hash12(vec2(dcell.x + 51.0, dFrame + 13.0));
        float head = 1.0 - clamp(dx / max(dlen * dscl, 0.001), 0.0, 1.0);
        head = head * head;
        float dl = dot(col, vec3(0.299, 0.587, 0.114));
        float vis = 0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.6, dl));
        col = mix(col, vec3(0.96), clamp(onD * head, 0.0, 1.0) * vis);
        vec2 lcell = vec2(floor(uv.x * resolution.x * 0.015625), floor(uv.y * resolution.y));
        float rL = hash13(vec3(lcell, dFrame + 9.0));
        float lon = step(1.0 - snowDots * dens * 0.07, rL);
        float lx = fract(uv.x * resolution.x * 0.015625);
        float ltail = 1.0 - lx;
        col = mix(col, vec3(0.90), lon * ltail * ltail * vis * 0.85);
    }

    // speedDots: fast horizontal dot streaks (motion streaks)
    if (speedDots > 0.001) {
        float sdrift = t * (30.0 + 60.0 * speedDots);
        vec2 scell = vec2(floor((uv.x * resolution.x - sdrift) * 0.08), floor(uv.y * resolution.y * 0.5));
        float rS = hash13(vec3(scell, floor(t * 20.0)));
        float onS = step(1.0 - speedDots * 0.18, rS);
        float sx = fract((uv.x * resolution.x - sdrift) * 0.08);
        float slen = 0.3 + 0.6 * hash12(vec2(scell.x, floor(t * 20.0) + 5.0));
        float sdash = step(sx, slen);
        float sdl = dot(col, vec3(0.299, 0.587, 0.114));
        float svis = 0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.6, sdl));
        col = mix(col, vec3(0.96), clamp(onS * sdash, 0.0, 1.0) * svis);
    }

    // anisoSnow: comet dots riding on thin travelling lines
    if (anisoSnow > 0.001) {
        float L1 = fract(t * 0.07);
        float L2 = fract(t * 0.07 + 0.5);
        float ld1 = abs(fract(uv.y - L1 + 0.5) - 0.5);
        float ld2 = abs(fract(uv.y - L2 + 0.5) - 0.5);
        float lw = 0.004 + 0.012 * anisoSnow;
        float lmask = max(1.0 - smoothstep(0.0, lw, ld1), 1.0 - smoothstep(0.0, lw, ld2)) * anisoSnow;
        float adrift = t * 6.0;
        vec2 acell = vec2(floor((uv.x * resolution.x - adrift) * 0.0104167), floor(uv.y * resolution.y * 0.0416667));
        float aFrame = floor(t * 14.0);
        float rA = hash13(vec3(acell, aFrame));
        float onA = step(1.0 - lmask * 0.85, rA);
        float ax = fract((uv.x * resolution.x - adrift) * 0.0104167);
        float alen = 0.2 + 0.75 * hash12(vec2(acell.x, aFrame + 4.0));
        float ahead = 1.0 - clamp(ax / max(alen, 0.001), 0.0, 1.0);
        ahead = ahead * ahead;
        float adl = dot(col, vec3(0.299, 0.587, 0.114));
        float avis = 0.4 + 0.6 * (1.0 - smoothstep(0.0, 0.6, adl));
        col = mix(col, vec3(0.97), clamp(onA * ahead, 0.0, 1.0) * avis * lmask);
    }

    // ghost: displaced RGB echo (YT ghosting)
    if (ghost > 0.001) {
        vec3 gecho = texture2D(tDiffuse, clamp(uv - vec2(0.02 + 0.05 * ghost, 0.0), 0.0, 1.0) * uvScale).rgb;
        col = mix(col, max(col, gecho * 0.85), ghost * 0.55);
    }

    // ---- 14. flicker: slow AGC wander + diffusion flashes (shot 08)
    if (flicker > 0.001) {
        float agc = (vnoise(vec2(t * 0.7, 0.0)) - 0.5) * 2.0;
        col *= 1.0 + agc * flicker * 0.25;
        float fr = hash12(vec2(frame, 5.0)) - 0.5;
        col *= 1.0 + fr * flicker * 0.30;
        float flashW = step(1.0 - flicker * 0.06, hash12(vec2(floor(t * 8.0), 3.0)));
        float flashB = step(1.0 - flicker * 0.06, hash12(vec2(floor(t * 8.0), 9.0)));
        float vgrad = 0.5 + 0.5 * sin(vUv.y * 3.14159 + t * 2.0);
        col = mix(col, vec3(1.0, 0.96, 1.0), clamp(flashW * flicker * (0.35 + 0.65 * vgrad), 0.0, 1.0) * 0.85);
        col = mix(col, vec3(0.0), clamp(flashB * flicker * (0.35 + 0.65 * (1.0 - vgrad)), 0.0, 1.0) * 0.85);
    }

    // blueScreen: signal-loss blue field over a ghost of picture
    if (blueScreen > 0.001) {
        float bsn = hash13(vec3(floor(vUv * resolution * 0.5), frame + 51.0));
        vec3 blue = vec3(0.02, 0.05, 0.65) * (0.85 + 0.30 * bsn);
        blue += col * 0.12 * (1.0 - blueScreen * 0.7);
        col = mix(col, blue, clamp(blueScreen, 0.0, 1.0));
    }
    // humBar: slow AC hum brightness band (YT hum-bar tutorials)
    if (humBar > 0.001) {
        float hbPos = fract(t * 0.12);
        float hbDist = abs(fract(vUv.y - hbPos + 0.5) - 0.5);
        float hb = (1.0 - smoothstep(0.0, 0.10 + 0.25 * humBar, hbDist)) * humBar;
        col *= 1.0 + hb * 0.18;
    }

    // ---- 15. interlace: -1 frame offset only — no scanlines (shot 04)
    // blinds are a separate param below (default off)
    if (blinds > 0.001) {
        float blind = step(0.5, fract(vUv.y * resolution.y * 0.5));
        col *= 1.0 - blinds * blind * 0.5;
    }
    // tPrev is the weighted average of sampled earlier source frames (or the
    // current source when hasHistory is 0), never this effect's output.
    vec3 prev = texture2D(tPrev, clamp(vUv + vec2(0.0, 0.004 * roll), 0.0, 1.0) * uvScale).rgb;
    float frameMix = clamp((0.25 + persistence) * interlace * hasHistory * amount, 0.0, 0.85);
    col = mix(col, prev, frameMix);

    // seam / roll noise line
    if (seam > 0.001) {
        float sn = hash13(vec3(floor(vUv * resolution), frame + 61.0));
        col = mix(col, vec3(0.72 + 0.28 * sn), clamp(seam, 0.0, 1.0) * 0.55);
    }

    // tiny dither against banding
    col += (hash13(vec3(floor(vUv * resolution) + 5.0, frame + 83.0)) - 0.5) * 0.028;

    // OSD: camcorder PLAY + SP timecode blocky overlay (YT date-stamp)
    if (osd > 0.001) {
        vec2 opx = vec2(vUv.x * resolution.x, (1.0 - vUv.y) * resolution.y);
        float fS = max(2.0, resolution.y / 240.0);
        vec2 oOrg = vec2(resolution.x * 0.035, resolution.y * 0.045);
        vec2 ocell = vec2(6.0 * fS, 9.0 * fS);
        vec2 rel = (opx - oOrg) / ocell;
        float oLine = floor(rel.y);
        float oRow = fract(rel.y) * 9.0;
        float oIdx = floor(rel.x);
        float oCol = fract(rel.x) * 6.0;
        float oLen = oLine < 0.5 ? 5.0 : 10.0;
        float inText = step(oLine, 1.5) * step(0.0, oLine) * step(oIdx, oLen - 0.001) * step(0.0, oIdx) * step(oRow, 6.999) * step(oCol, 4.999);
        float tt = max(t, 0.0);
        float dh = floor(tt / 3600.0);
        float dm = floor(mod(tt, 3600.0) / 60.0);
        float ds = floor(mod(tt, 60.0));
        float blink = step(0.5, fract(t * 1.0));
        float chId = 0.0;
        if (oLine < 0.5) {
            if (oIdx < 0.5) chId = 1.0;
            else if (oIdx < 1.5) chId = 2.0;
            else if (oIdx < 2.5) chId = 3.0;
            else if (oIdx < 3.5) chId = 4.0;
            else chId = 8.0;
        } else {
            if (oIdx < 0.5) chId = 5.0;
            else if (oIdx < 1.5) chId = 1.0;
            else if (oIdx < 2.5) chId = 0.0;
            else if (oIdx < 3.5) chId = 9.0 + dh;
            else if (oIdx < 4.5) chId = 7.0;
            else if (oIdx < 5.5) chId = 9.0 + floor(dm / 10.0);
            else if (oIdx < 6.5) chId = 9.0 + mod(dm, 10.0);
            else if (oIdx < 7.5) chId = 7.0;
            else if (oIdx < 8.5) chId = 9.0 + floor(ds / 10.0);
            else chId = 9.0 + mod(ds, 10.0);
        }
        if (chId > 6.5 && chId < 7.5) { if (blink < 0.5) chId = 0.0; }
        float obit = mod(floor(osdRow(chId, floor(oRow)) / exp2(floor(oCol))), 2.0);
        col = mix(col, vec3(0.95), inText * obit * clamp(osd, 0.0, 1.0) * 0.92);
    }

    col = mix(orig.rgb, col, clamp(amount, 0.0, 1.0));
    gl_FragColor = vec4(col, orig.a);
}
`;

const VHS_TUBE_SHADER = `
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform float time;
uniform float amount;
varying vec2 vUv;
void main() {
    vec4 texel = texture2D(tDiffuse, vUv * uvScale);
    gl_FragColor = texel;
}
`;


// Persistence ("trails") is an explicit weighted average of earlier SOURCE
// frames. The frame sampler evaluates those frames at fixed one-frame offsets,
// and the averaging passes below blend them into one texture. Nothing reads
// this effect's previous output, so a frame renders the same in any order.
const VHS_TRAIL_DECAY = 0.6;
const VHS_TRAIL_SETUP_CONTROL = "openzoid-legacy.vhs-setup";

const VHS_ACCUMULATE_SHADER = `
uniform sampler2D tBase;
uniform sampler2D tSample;
uniform vec2 uvScale;
uniform float factor;
varying vec2 vUv;
void main() {
    gl_FragColor = mix(texture2D(tBase, vUv * uvScale), texture2D(tSample, vUv * uvScale), factor);
}
`;

// New effects use a clip-local clock plus an offset. Older explicit clocks
// retain their absolute value, including custom expressions and keyframes.
function effectTime(effect, frame) {
    const props = effect.properties;
    const rate = Number(effect.parentProject?.sequence?.properties?.rate?.get?.()) || 30;
    const value = Number(props.time.get(frame));
    const clock = Number.isFinite(value) ? value : 0;
    return props.timeMode.get() === 0 ? clock : Number(frame || 0) / rate + clock;
}

function loadEffectTime(effect, saved) {
    if (!saved || saved.time === undefined || saved.timeMode !== undefined) return;
    const entry = saved.time;
    const expression = entry && entry.expression;
    const source = typeof expression === "string" ? expression : expression?.source;
    const customKeys = Array.isArray(entry?.keyframes) && entry.keyframes.some((key) =>
        Number(key.value || 0) !== 0 || Number(key.frame || 0) !== 0);
    if (source?.trim() === "time" && !customKeys) {
        const property = effect.properties.time;
        property.expression = null;
        property.animated = false;
        // The donor expression default serialized an empty keyframe list.
        if (property.keyframes?.length === 0) property.keyframes.push(new PZ.keyframe(0, 0));
        property.set(0, 0);
    } else {
        effect.properties.timeMode.set(0);
    }
}

// Matches the mix factor applied by VHS_SIGNAL_SHADER (frameMix).
function vhsTrailMix(amount, persistence, interlace) {
    return Math.min(0.85, Math.max(0, (0.25 + persistence) * interlace * amount));
}

function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function readNumber(property, frame, fallback) {
    try {
        const value = Number(property && property.get ? property.get(frame) : NaN);
        return Number.isFinite(value) ? value : fallback;
    } catch (_error) {
        return fallback;
    }
}

function vhsNum(name, value, min, max, step, decimals) {
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

const vhsProperties = {
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
        zoidiumControl: VHS_TRAIL_SETUP_CONTROL,
    },
    timeMode: { visible: false, name: "Time mode", type: PZ.property.type.NUMBER, value: 1 },
    time: {
        dynamic: true, name: "Time Offset", type: PZ.property.type.NUMBER,
        value: 0, step: 0.01, decimals: 2,
    },
    amount: vhsNum("Amount", 1, 0, 1, 0.01, 2),
    signalStrength: vhsNum("Signal Strength", 0.25, 0, 1, 0.01, 2),
    colorStripes: vhsNum("Color Stripes", 0.25, 0, 1, 0.01, 2),
    chromaCrawl: vhsNum("Chroma Crawl", 0.2, 0, 1, 0.01, 2),
    chromaLoss: vhsNum("Chroma Loss", 0.05, 0, 1, 0.01, 2),
    flicker: vhsNum("Flicker", 0.08, 0, 1, 0.01, 2),
    vhsSharpen: vhsNum("VHS Sharpen", 0.35, 0, 1, 0.01, 2),
    interlace: vhsNum("Interlace", 0.4, 0, 1, 0.01, 2),
    staticWarp: vhsNum("Static Warp", 0.2, 0, 1, 0.01, 2),
    fastForward: vhsNum("Fast Forward", 0, 0, 1, 0.01, 2),
    tracking: vhsNum("Tracking", 0.25, 0, 1, 0.01, 2),
    anisotropyWarp: vhsNum("Anisotropy Warp", 0, 0, 1, 0.01, 2),
    rgbSplit: vhsNum("RGB Split", 0.12, 0, 1, 0.01, 2),
    tear: vhsNum("Tear", 0.12, 0, 1, 0.01, 2),
    humBar: vhsNum("Hum Bar", 0.1, 0, 1, 0.01, 2),
    blueScreen: vhsNum("Blue Screen", 0, 0, 1, 0.01, 2),
    skew: vhsNum("Skew", 0.25, 0, 1, 0.01, 2),
    crease: vhsNum("Crease", 0, 0, 1, 0.01, 2),
    ghost: vhsNum("Ghost", 0.08, 0, 1, 0.01, 2),
    osd: vhsNum("OSD Timecode", 0, 0, 1, 0.01, 2),
    noiseEvo: vhsNum("Noise Evolution", 0.5, 0, 1, 0.01, 2),
    noiseOpacity: vhsNum("Noise Opacity", 0.4, 0, 1, 0.01, 2),
    blinds: vhsNum("Blinds", 0, 0, 1, 0.01, 2),
    snowDots: vhsNum("Snow Dots", 0, 0, 1, 0.01, 2),
    speedDots: vhsNum("Speed Dots", 0, 0, 1, 0.01, 2),
    anisoSnow: vhsNum("Anisotropy Snow Dots", 0, 0, 1, 0.01, 2),
    jitterX: vhsNum("Jitter X", 0.3, 0, 1, 0.01, 2),
    jitterY: vhsNum("Jitter Y", 0.3, 0, 1, 0.01, 2),
    roll: vhsNum("Roll", 0, 0, 1, 0.01, 2),
    rollSpeed: {
        dynamic: true,
        name: "Roll Speed",
        type: PZ.property.type.NUMBER,
        value: 1.5,
        min: 0,
        max: 5,
        step: 0.1,
        decimals: 1,
    },
    persistence: vhsNum("Persistence", 0.25, 0, 1, 0.01, 2),
};

// Pass object assigned to effect.pass. The compositor calls render() once per
// output frame. Trails come from frame-sampler results only.
function VhsPass(effect) {
    THREE.Pass.call(this);
    this.effect = effect;
    this.resolution = new THREE.Vector2(2, 2);
    this.uniforms = {
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    };
    this.signalUniforms = {
        tDiffuse: { type: "t", value: null },
        tPrev: { type: "t", value: null },
        resolution: { type: "v2", value: this.resolution },
        uvScale: this.uniforms.uvScale,
        time: { type: "f", value: 0 },
        amount: { type: "f", value: 1 },
        hasHistory: { type: "f", value: 0 },
        persistence: { type: "f", value: 0.25 },
        signalStrength: { type: "f", value: 0.25 },
        colorStripes: { type: "f", value: 0.25 },
        chromaCrawl: { type: "f", value: 0.2 },
        chromaLoss: { type: "f", value: 0.05 },
        flicker: { type: "f", value: 0.08 },
        vhsSharpen: { type: "f", value: 0.35 },
        interlace: { type: "f", value: 0.4 },
        staticWarp: { type: "f", value: 0.2 },
        fastForward: { type: "f", value: 0 },
        tracking: { type: "f", value: 0.25 },
        anisotropyWarp: { type: "f", value: 0 },
        rgbSplit: { type: "f", value: 0.12 },
        tear: { type: "f", value: 0.12 },
        humBar: { type: "f", value: 0.1 },
        blueScreen: { type: "f", value: 0 },
        skew: { type: "f", value: 0.25 },
        crease: { type: "f", value: 0 },
        ghost: { type: "f", value: 0.08 },
        osd: { type: "f", value: 0 },
        noiseEvo: { type: "f", value: 0.5 },
        noiseOpacity: { type: "f", value: 0.4 },
        blinds: { type: "f", value: 0 },
        snowDots: { type: "f", value: 0 },
        speedDots: { type: "f", value: 0 },
        anisoSnow: { type: "f", value: 0 },
        jitterX: { type: "f", value: 0.3 },
        jitterY: { type: "f", value: 0.3 },
        roll: { type: "f", value: 0 },
        rollSpeed: { type: "f", value: 1.5 },
    };
    this.tubeUniforms = {
        tDiffuse: { type: "t", value: null },
        uvScale: this.uniforms.uvScale,
        time: { type: "f", value: 0 },
        amount: { type: "f", value: 1 },
    };
    this.accumulateUniforms = {
        tBase: { type: "t", value: null },
        tSample: { type: "t", value: null },
        uvScale: this.uniforms.uvScale,
        factor: { type: "f", value: 1 },
    };
    const options = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
    };
    this.target = new THREE.WebGLRenderTarget(2, 2, options);
    this.target.texture.generateMipmaps = false;
    this.trailTargets = [
        new THREE.WebGLRenderTarget(2, 2, options),
        new THREE.WebGLRenderTarget(2, 2, options),
    ];
    this.trailTargets.forEach(function (target) {
        target.texture.generateMipmaps = false;
    });
    this.materialSignal = new THREE.ShaderMaterial({
        uniforms: this.signalUniforms,
        vertexShader: VHS_VERTEX_SHADER,
        fragmentShader: VHS_SIGNAL_SHADER,
    });
    this.materialSignal.premultipliedAlpha = true;
    this.materialTube = new THREE.ShaderMaterial({
        uniforms: this.tubeUniforms,
        vertexShader: VHS_VERTEX_SHADER,
        fragmentShader: VHS_TUBE_SHADER,
    });
    this.materialTube.premultipliedAlpha = true;
    this.materialAccumulate = new THREE.ShaderMaterial({
        uniforms: this.accumulateUniforms,
        vertexShader: VHS_VERTEX_SHADER,
        fragmentShader: VHS_ACCUMULATE_SHADER,
    });
    this.materialAccumulate.premultipliedAlpha = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.enabled = true;
    this.needsSwap = true;
}

VhsPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: VhsPass,
    setSize: function (width, height) {
        const w = Math.max(2, Math.round(width));
        const h = Math.max(2, Math.round(height));
        this.resolution.set(w, h);
        this.target.setSize(w, h);
        this.trailTargets.forEach(function (target) {
            target.setSize(w, h);
        });
    },
    setMask: function () {},
    // Averages the sampled source frames into one texture. Returns null when
    // the host supplies no samples (no Adjustment layer, or no trail requested).
    renderTrail: function (renderer) {
        const temporal = PZ.zoidium && PZ.zoidium.temporal;
        const samples = temporal && temporal.resolveFrameSamples
            ? temporal.resolveFrameSamples(this.effect) || []
            : [];
        let current = null;
        let total = 0;
        let slot = 0;
        for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index];
            const weight = Number(sample && sample.opacity);
            if (!sample || !sample.texture || !(weight > 0)) continue;
            total += weight;
            const target = this.trailTargets[slot % 2];
            slot += 1;
            this.accumulateUniforms.tBase.value = current ? current.texture : sample.texture;
            this.accumulateUniforms.tSample.value = sample.texture;
            this.accumulateUniforms.factor.value = current ? weight / total : 1;
            this.quad.material = this.materialAccumulate;
            renderer.render(this.scene, this.camera, target, true);
            current = target;
        }
        return current;
    },
    render: function (renderer, writeBuffer, readBuffer) {
        if (readBuffer.width > 0 && readBuffer.height > 0 &&
            (this.target.width !== readBuffer.width || this.target.height !== readBuffer.height)) {
            this.setSize(readBuffer.width, readBuffer.height);
        }
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        const output = writeBuffer || readBuffer;
        const scale = this.uniforms.uvScale.value;
        const width = Math.round(readBuffer.width * scale.x);
        const height = Math.round(readBuffer.height * scale.y);
        this.resolution.set(width, height);
        this.target.viewport?.set?.(0, 0, width, height);
        this.trailTargets.forEach((target) => target.viewport?.set?.(0, 0, width, height));
        const trail = this.renderTrail(renderer);
        this.signalUniforms.tDiffuse.value = readBuffer.texture;
        this.signalUniforms.tPrev.value = trail ? trail.texture : readBuffer.texture;
        this.signalUniforms.hasHistory.value = trail ? 1 : 0;
        this.quad.material = this.materialSignal;
        renderer.render(this.scene, this.camera, this.target, true);
        this.tubeUniforms.tDiffuse.value = this.target.texture;
        this.quad.material = this.materialTube;
        renderer.render(this.scene, this.camera, output, true);
        renderer.autoClear = oldAutoClear;
    },
    dispose: function () {
        this.target.dispose();
        this.trailTargets.forEach(function (target) {
            target.dispose();
        });
        this.materialSignal.dispose();
        this.materialTube.dispose();
        this.materialAccumulate.dispose();
        this.quad.geometry.dispose();
    },
});

const vhsEffect = this;

ZoidiumPluginApis.defineFrameSampler.call(vhsEffect, {
    displayName: "VHS",
    properties: vhsProperties,
    // Trail taps are source frames at -1, -2, ... frames. Count grows with
    // Persistence; the host caps frame samples at 16 and we stay below 10.
    getRequest(effect, frame) {
        const amount = clamp01(readNumber(effect.properties.amount, frame, 1));
        const persistence = clamp01(readNumber(effect.properties.persistence, frame, 0.25));
        const interlace = clamp01(readNumber(effect.properties.interlace, frame, 0.4));
        const enabled = readNumber(effect.properties.enabled, frame, 1) === 1;
        return {
            enabled: enabled && vhsTrailMix(amount, persistence, interlace) > 0.001,
            count: 2 + Math.round(persistence * 8),
            offsetFrames: -1,
            startOpacity: 1,
            decay: VHS_TRAIL_DECAY,
        };
    },
    lifecycle: {
        load(data) {
            vhsEffect.pass = new VhsPass(vhsEffect);
            vhsEffect.pass.setSize(2, 2);
            vhsEffect.properties.load(data && data.properties);
            loadEffectTime(vhsEffect, data && data.properties);
        },
        update(e) {
            const pass = vhsEffect.pass;
            if (!pass) return;
            const props = vhsEffect.properties;
            const t = effectTime(vhsEffect, e);
            const amount = clamp01(props.amount.get(e));
            const s = pass.signalUniforms;
            s.time.value = t;
            s.amount.value = amount;
            s.persistence.value = clamp01(props.persistence.get(e));
            s.signalStrength.value = clamp01(props.signalStrength.get(e));
            s.colorStripes.value = clamp01(props.colorStripes.get(e));
            s.chromaCrawl.value = clamp01(props.chromaCrawl.get(e));
            s.chromaLoss.value = clamp01(props.chromaLoss.get(e));
            s.flicker.value = clamp01(props.flicker.get(e));
            s.vhsSharpen.value = clamp01(props.vhsSharpen.get(e));
            s.interlace.value = clamp01(props.interlace.get(e));
            s.staticWarp.value = clamp01(props.staticWarp.get(e));
            s.fastForward.value = clamp01(props.fastForward.get(e));
            s.tracking.value = clamp01(props.tracking.get(e));
            s.anisotropyWarp.value = clamp01(props.anisotropyWarp.get(e));
            s.rgbSplit.value = clamp01(props.rgbSplit.get(e));
            s.tear.value = clamp01(props.tear.get(e));
            s.humBar.value = clamp01(props.humBar.get(e));
            s.blueScreen.value = clamp01(props.blueScreen.get(e));
            s.skew.value = clamp01(props.skew.get(e));
            s.crease.value = clamp01(props.crease.get(e));
            s.ghost.value = clamp01(props.ghost.get(e));
            s.osd.value = clamp01(props.osd.get(e));
            s.noiseEvo.value = clamp01(props.noiseEvo.get(e));
            s.noiseOpacity.value = clamp01(props.noiseOpacity.get(e));
            s.blinds.value = clamp01(props.blinds.get(e));
            s.snowDots.value = clamp01(props.snowDots.get(e));
            s.speedDots.value = clamp01(props.speedDots.get(e));
            s.anisoSnow.value = clamp01(props.anisoSnow.get(e));
            s.jitterX.value = clamp01(props.jitterX.get(e));
            s.jitterY.value = clamp01(props.jitterY.get(e));
            s.roll.value = clamp01(props.roll.get(e));
            const rs = Number(props.rollSpeed.get(e));
            s.rollSpeed.value = isFinite(rs) ? Math.min(5, Math.max(0, rs)) : 0;

            pass.tubeUniforms.time.value = t;
            pass.tubeUniforms.amount.value = amount;
            pass.enabled = props.enabled.get(e) === 1 && amount !== 0;
        },
        unload() {
            if (vhsEffect.pass) {
                vhsEffect.pass.dispose();
            }
        },
        resize() {
            if (!vhsEffect.pass || !vhsEffect.parentLayer) {
                return;
            }
            const resolution = vhsEffect.parentLayer.properties.resolution.get();
            vhsEffect.pass.setSize(resolution[0], resolution[1]);
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
