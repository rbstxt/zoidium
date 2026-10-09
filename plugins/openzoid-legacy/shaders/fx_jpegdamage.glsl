uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;
uniform float amount;

// Sapphire S_JpegDamage parameters
uniform float quality;      // 0.01..1, normal JPEG artifacts (lower = more compression)
uniform float resFactor;    // >=1, downres factor so JPEG blocks grow (1 = full res)
uniform float resRelX;      // >=0.01, extra horizontal downres (rectangular blocks)
uniform float allFreq;      // scales all DCT coefficients
uniform float xFreq;        // scales horizontal DCT frequencies (u > 0)
uniform float yFreq;        // scales vertical DCT frequencies (v > 0)
uniform float lowFreq;      // scales soft low frequencies (u+v <= 2)
uniform float midFreq;      // scales middle frequencies (3 <= u+v <= 6)
uniform float highFreq;     // scales sharp high frequencies (u+v >= 7)
uniform float affectLuma;   // how much freq scales affect luma (0 = no change)
uniform float affectChroma; // how much freq scales affect chroma (0 = no change)
uniform float errRate;      // avg decompression errors per damaged block (0 = none)
uniform float errDensity;   // 0..1 fraction of blocks that receive errors
uniform float errAmp;       // amplitude of decompression errors
uniform float errCoherence; // clustering of damaged blocks (0 = evenly spread)
uniform float jitterFrames; // 0 = frozen errors, 1 = new errors each frame, 2 = every other frame...
uniform float randSeed;     // random seed for error pattern
uniform float scaleLights;  // brightness scale of result
uniform float offsetDarks;  // gray added to darker regions
uniform float saturation;   // color saturation scale (0 = monochrome)

varying vec2 vUv;

const float JPI = 3.14159265359;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
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

float jpegRound(float x) {
    return x >= 0.0 ? floor(x + 0.5) : ceil(x - 0.5);
}

void main() {
    vec4 orig = texture2D(tDiffuse, vUv * uvScale);

    // ---- 0. Effective JPEG grid. The image is conceptually downsampled by
    // (resFactor * resRelX, resFactor), JPEG-coded in 8x8 blocks at that low
    // resolution, then nearest-upsampled. Larger resFactor = larger blocks.
    float rF = max(resFactor, 1.0);
    vec2 down = vec2(rF * max(resRelX, 0.01), rF);
    vec2 lowRes = max(resolution / down, vec2(1.0));
    vec2 vv = clamp(vUv, vec2(0.0), vec2(0.999999));
    vec2 lowCoord = clamp(floor(vv * lowRes), vec2(0.0), lowRes - vec2(1.0));
    vec2 blockBase = floor(lowCoord / 8.0) * 8.0;
    float lx = lowCoord.x - blockBase.x;
    float ly = lowCoord.y - blockBase.y;

    // ---- 1. Sample the 8x8 source block (single center tap per low-res
    // pixel = box downsample + nearest upsample), convert to YCbCr and level
    // shift into the signed 0..255-style coefficient domain.
    float yB[64];
    float cbB[64];
    float crB[64];
    for (int j = 0; j < 8; j++) {
        for (int i = 0; i < 8; i++) {
            vec2 tuv = clamp((blockBase + vec2(float(i), float(j)) + 0.5) / lowRes, vec2(0.0), vec2(1.0));
            vec3 ycc = rgb2ycbcr(texture2D(tDiffuse, tuv * uvScale).rgb);
            // NOTE: ANGLE only accepts loop indices / constants in array
            // subscripts, so index arrays with direct (j, i) expressions.
            yB[j * 8 + i] = (ycc.x - 0.5) * 255.0;
            cbB[j * 8 + i] = (ycc.y - 0.5) * 255.0;
            crB[j * 8 + i] = (ycc.z - 0.5) * 255.0;
        }
    }

    // ---- 2. Cosine basis table: cosT[a*8+b] = cos((2b+1)*a*pi/16).
    float cosT[64];
    for (int a = 0; a < 8; a++) {
        for (int b = 0; b < 8; b++) {
            cosT[a * 8 + b] = cos((2.0 * float(b) + 1.0) * float(a) * JPI / 16.0);
        }
    }

    // ---- 3. Standard JPEG base quantization tables (quality 50).
    float qTabL[64];
    qTabL[0] = 16.0; qTabL[1] = 11.0; qTabL[2] = 10.0; qTabL[3] = 16.0;
    qTabL[4] = 24.0; qTabL[5] = 40.0; qTabL[6] = 51.0; qTabL[7] = 61.0;
    qTabL[8] = 12.0; qTabL[9] = 12.0; qTabL[10] = 14.0; qTabL[11] = 19.0;
    qTabL[12] = 26.0; qTabL[13] = 58.0; qTabL[14] = 60.0; qTabL[15] = 55.0;
    qTabL[16] = 14.0; qTabL[17] = 13.0; qTabL[18] = 16.0; qTabL[19] = 24.0;
    qTabL[20] = 40.0; qTabL[21] = 57.0; qTabL[22] = 69.0; qTabL[23] = 56.0;
    qTabL[24] = 14.0; qTabL[25] = 17.0; qTabL[26] = 22.0; qTabL[27] = 29.0;
    qTabL[28] = 51.0; qTabL[29] = 87.0; qTabL[30] = 80.0; qTabL[31] = 62.0;
    qTabL[32] = 18.0; qTabL[33] = 22.0; qTabL[34] = 37.0; qTabL[35] = 56.0;
    qTabL[36] = 68.0; qTabL[37] = 109.0; qTabL[38] = 103.0; qTabL[39] = 77.0;
    qTabL[40] = 24.0; qTabL[41] = 35.0; qTabL[42] = 55.0; qTabL[43] = 64.0;
    qTabL[44] = 81.0; qTabL[45] = 104.0; qTabL[46] = 113.0; qTabL[47] = 92.0;
    qTabL[48] = 49.0; qTabL[49] = 64.0; qTabL[50] = 78.0; qTabL[51] = 87.0;
    qTabL[52] = 103.0; qTabL[53] = 121.0; qTabL[54] = 120.0; qTabL[55] = 101.0;
    qTabL[56] = 72.0; qTabL[57] = 92.0; qTabL[58] = 95.0; qTabL[59] = 98.0;
    qTabL[60] = 112.0; qTabL[61] = 100.0; qTabL[62] = 103.0; qTabL[63] = 99.0;
    float qTabC[64];
    qTabC[0] = 17.0; qTabC[1] = 18.0; qTabC[2] = 24.0; qTabC[3] = 47.0;
    qTabC[4] = 99.0; qTabC[5] = 99.0; qTabC[6] = 99.0; qTabC[7] = 99.0;
    qTabC[8] = 18.0; qTabC[9] = 21.0; qTabC[10] = 26.0; qTabC[11] = 66.0;
    qTabC[12] = 99.0; qTabC[13] = 99.0; qTabC[14] = 99.0; qTabC[15] = 99.0;
    qTabC[16] = 24.0; qTabC[17] = 26.0; qTabC[18] = 56.0; qTabC[19] = 99.0;
    qTabC[20] = 99.0; qTabC[21] = 99.0; qTabC[22] = 99.0; qTabC[23] = 99.0;
    qTabC[24] = 47.0; qTabC[25] = 66.0; qTabC[26] = 99.0; qTabC[27] = 99.0;
    qTabC[28] = 99.0; qTabC[29] = 99.0; qTabC[30] = 99.0; qTabC[31] = 99.0;
    qTabC[32] = 99.0; qTabC[33] = 99.0; qTabC[34] = 99.0; qTabC[35] = 99.0;
    qTabC[36] = 99.0; qTabC[37] = 99.0; qTabC[38] = 99.0; qTabC[39] = 99.0;
    qTabC[40] = 99.0; qTabC[41] = 99.0; qTabC[42] = 99.0; qTabC[43] = 99.0;
    qTabC[44] = 99.0; qTabC[45] = 99.0; qTabC[46] = 99.0; qTabC[47] = 99.0;
    qTabC[48] = 99.0; qTabC[49] = 99.0; qTabC[50] = 99.0; qTabC[51] = 99.0;
    qTabC[52] = 99.0; qTabC[53] = 99.0; qTabC[54] = 99.0; qTabC[55] = 99.0;
    qTabC[56] = 99.0; qTabC[57] = 99.0; qTabC[58] = 99.0; qTabC[59] = 99.0;
    qTabC[60] = 99.0; qTabC[61] = 99.0; qTabC[62] = 99.0; qTabC[63] = 99.0;

    // IJG quality scaling: Quality 0.01..1 maps to JPEG Q 1..100.
    float qq = clamp(quality, 0.01, 1.0) * 100.0;
    float qScale = qq < 50.0 ? (5000.0 / qq) : (200.0 - 2.0 * qq);

    // ---- 4. Separable forward DCT (row pass, then column pass with the
    // 0.25*C(u)*C(v) normalization), all three channels together.
    float tmpY[64];
    float tmpCb[64];
    float tmpCr[64];
    for (int j = 0; j < 8; j++) {
        for (int u = 0; u < 8; u++) {
            float aY = 0.0;
            float aCb = 0.0;
            float aCr = 0.0;
            for (int i = 0; i < 8; i++) {
                float c = cosT[u * 8 + i];
                aY += yB[j * 8 + i] * c;
                aCb += cbB[j * 8 + i] * c;
                aCr += crB[j * 8 + i] * c;
            }
            tmpY[j * 8 + u] = aY;
            tmpCb[j * 8 + u] = aCb;
            tmpCr[j * 8 + u] = aCr;
        }
    }
    float coefY[64];
    float coefCb[64];
    float coefCr[64];
    for (int v = 0; v < 8; v++) {
        float cv = v == 0 ? 0.70710678 : 1.0;
        for (int u = 0; u < 8; u++) {
            float cu = u == 0 ? 0.70710678 : 1.0;
            float aY = 0.0;
            float aCb = 0.0;
            float aCr = 0.0;
            for (int jj = 0; jj < 8; jj++) {
                float c = cosT[v * 8 + jj];
                aY += tmpY[jj * 8 + u] * c;
                aCb += tmpCb[jj * 8 + u] * c;
                aCr += tmpCr[jj * 8 + u] * c;
            }
            float nrm = 0.25 * cu * cv;
            coefY[v * 8 + u] = aY * nrm;
            coefCb[v * 8 + u] = aCb * nrm;
            coefCr[v * 8 + u] = aCr * nrm;
        }
    }

    // ---- 5. Frequency scaling, quantization, dequantization.
    float fqY[64];
    float fqCb[64];
    float fqCr[64];
    for (int v = 0; v < 8; v++) {
        for (int u = 0; u < 8; u++) {
            float m = allFreq;
            if (u != 0) m *= xFreq;
            if (v != 0) m *= yFreq;
            int sb = u + v;
            if (sb <= 2) m *= lowFreq;
            else if (sb <= 6) m *= midFreq;
            else m *= highFreq;
            float eL = max(1.0 + (m - 1.0) * affectLuma, 0.0);
            float eC = max(1.0 + (m - 1.0) * affectChroma, 0.0);
            float qL = max(floor((qTabL[v * 8 + u] * qScale + 50.0) / 100.0), 1.0);
            float qC = max(floor((qTabC[v * 8 + u] * qScale + 50.0) / 100.0), 1.0);
            fqY[v * 8 + u] = jpegRound(coefY[v * 8 + u] * eL / qL) * qL;
            fqCb[v * 8 + u] = jpegRound(coefCb[v * 8 + u] * eC / qC) * qC;
            fqCr[v * 8 + u] = jpegRound(coefCr[v * 8 + u] * eC / qC) * qC;
        }
    }

    // ---- 6. Random decompression errors. A fraction (errDensity) of blocks
    // is damaged; damaged blocks get ~errRate corrupted coefficients with
    // amplitude errAmp (scaled by the local quant step). errCoherence
    // clusters damaged blocks; jitterFrames/randSeed drive the animation.
    float errFrame = jitterFrames < 0.5 ? 0.0 : floor(floor(time * 30.0) / max(jitterFrames, 1.0));
    vec2 bseed = blockBase * 0.731 + vec2(randSeed * 91.7, randSeed * 47.3) + vec2(errFrame * 13.73, errFrame * 7.31);
    float bh = hash12(bseed);
    float cn = vnoise(blockBase * 0.13 + bseed * 0.31);
    float gate = mix(bh, cn, clamp(errCoherence * 0.25, 0.0, 1.0));
    float blockHit = step(1.0 - clamp(errDensity, 0.0, 1.0), gate) * step(0.001, errRate);
    if (blockHit > 0.5) {
        float slotP = clamp(errRate / 6.0, 0.0, 1.0);
        float errGain = errAmp * (1.0 + errRate * 0.25);
        for (int v = 0; v < 8; v++) {
            for (int u = 0; u < 8; u++) {
                float qL = max(floor((qTabL[v * 8 + u] * qScale + 50.0) / 100.0), 1.0);
                float qC = max(floor((qTabC[v * 8 + u] * qScale + 50.0) / 100.0), 1.0);
                for (int s = 0; s < 6; s++) {
                    float fs = float(s);
                    float h1 = hash12(bseed + vec2(fs * 17.17, fs * 9.31));
                    if (h1 < slotP) {
                        float h2 = hash12(bseed + vec2(fs * 5.37 + 3.1, fs * 11.7 + 7.7));
                        float h3 = hash12(bseed + vec2(fs * 3.71 + 9.2, fs * 7.97 + 1.3));
                        float h4 = hash12(bseed + vec2(fs * 13.1 + 5.5, fs * 1.93 + 4.4));
                        float h5 = hash12(bseed + vec2(fs * 8.77 + 2.2, fs * 4.23 + 6.6));
                        int pu = int(min(floor(h2 * 8.0), 7.0));
                        int pv = int(min(floor(h3 * 8.0), 7.0));
                        if (pu == u && pv == v) {
                            fqY[v * 8 + u] += (h4 - 0.5) * 2.0 * errGain * qL;
                            fqCb[v * 8 + u] += (h5 - 0.5) * 2.0 * errGain * qC;
                            fqCr[v * 8 + u] += (h4 + h5 - 1.0) * errGain * qC;
                        }
                    }
                }
            }
        }
    }

    // ---- 7. Separable inverse DCT evaluated at this pixel's position
    // (lx, ly) inside its block.
    float invX[8];
    float invYv[8];
    for (int u = 0; u < 8; u++) {
        float cu = u == 0 ? 0.70710678 : 1.0;
        invX[u] = cu * cos((2.0 * lx + 1.0) * float(u) * JPI / 16.0);
        invYv[u] = cu * cos((2.0 * ly + 1.0) * float(u) * JPI / 16.0);
    }
    float rY = 0.0;
    float rCb = 0.0;
    float rCr = 0.0;
    for (int v = 0; v < 8; v++) {
        float aY = 0.0;
        float aCb = 0.0;
        float aCr = 0.0;
        for (int u = 0; u < 8; u++) {
            aY += fqY[v * 8 + u] * invX[u];
            aCb += fqCb[v * 8 + u] * invX[u];
            aCr += fqCr[v * 8 + u] * invX[u];
        }
        rY += aY * invYv[v];
        rCb += aCb * invYv[v];
        rCr += aCr * invYv[v];
    }
    rY *= 0.25;
    rCb *= 0.25;
    rCr *= 0.25;

    vec3 dmg = clamp(ycbcr2rgb(vec3(rY / 255.0 + 0.5, rCb / 255.0 + 0.5, rCr / 255.0 + 0.5)), 0.0, 1.0);

    // ---- 8. Post: brightness, darks offset, saturation, amount mix.
    dmg *= scaleLights;
    float lum0 = dot(dmg, vec3(0.299, 0.587, 0.114));
    dmg += offsetDarks * (1.0 - lum0);
    float lum1 = dot(clamp(dmg, 0.0, 1.0), vec3(0.299, 0.587, 0.114));
    dmg = mix(vec3(lum1), dmg, saturation);
    dmg = clamp(dmg, 0.0, 1.0);

    vec3 outc = mix(orig.rgb, dmg, clamp(amount, 0.0, 1.0));
    gl_FragColor = vec4(outc, orig.a);
}
