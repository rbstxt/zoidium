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

// Each coefficient is evaluated once, using two eight-tap transforms.
// JPEG_STAGE: 0 = row DCT, 1 = column DCT/damage, 2 = vertical
// IDCT, 3 = horizontal IDCT/output. Intermediate RGB is signed YCbCr.
uniform sampler2D tStage;
uniform sampler2D quantTable;
// Compute this in GLSL with the original division order. Uploading a JS
// quotient shifts floor() at exact downsample boundaries by one source pixel.
vec2 jpegLowResolution() {
    float rF = max(resFactor, 1.0);
    vec2 down = vec2(rF * max(resRelX, 0.01), rF);
    return max(resolution / down, vec2(1.0));
}
#define lowResolution jpegLowResolution()
uniform vec2 outputResolution;
uniform vec2 blockGrid;
uniform vec2 atlasGrid;
uniform vec2 sparseAxes;
uniform float blockOffset;
uniform float blockCount;

vec2 atlasBlock(float index) {
    return vec2(mod(index, atlasGrid.x), floor(index / atlasGrid.x)) * vec2(8.0, 9.0);
}

vec2 sourceBase(vec2 block) {
    vec2 center = (block + 0.5) / outputResolution;
    vec2 coord = clamp(floor(clamp(center, vec2(0.0), vec2(0.999999)) * lowResolution), vec2(0.0), lowResolution - 1.0);
    return mix(block * 8.0, floor(coord / 8.0) * 8.0, sparseAxes);
}

#ifdef JPEG_PACKED
// Three RGBA8 texels store the exact float32 RGB values independently.
// Arithmetic packing works on the WebGL 1 host without integer bit operators.
float unpackValue(vec4 c) {
    vec4 bytes = floor(c * 255.0 + 0.5);
    if (dot(bytes, vec4(1.0)) == 0.0) return 0.0;
    float signValue = bytes.a >= 128.0 ? -1.0 : 1.0;
    float exponent = mod(bytes.a, 128.0) * 2.0 + floor(bytes.b / 128.0) - 127.0;
    float mantissa = mod(bytes.b, 128.0) * 65536.0 + bytes.g * 256.0 + bytes.r;
    return signValue * (1.0 + mantissa / 8388608.0) * exp2(exponent);
}
vec3 readStage(vec2 p) {
    vec2 size = atlasGrid * vec2(24.0, 9.0);
    vec2 uv = (vec2(p.x * 3.0, p.y) + 0.5) / size;
    return vec3(unpackValue(texture2D(tStage, uv)),
        unpackValue(texture2D(tStage, uv + vec2(1.0 / size.x, 0.0))),
        unpackValue(texture2D(tStage, uv + vec2(2.0 / size.x, 0.0))));
}
vec4 writeStage(vec3 value) {
    float channel = mod(floor(gl_FragCoord.x), 3.0);
    float v = channel < 0.5 ? value.x : (channel < 1.5 ? value.y : value.z);
    if (v == 0.0) return vec4(0.0);
    float exponent = floor(log2(abs(v)));
    float normalized = abs(v) * exp2(-exponent);
    // Correct a log2 rounding at exact powers of two before extracting bits.
    if (normalized < 1.0) { exponent -= 1.0; normalized *= 2.0; }
    if (normalized >= 2.0) { exponent += 1.0; normalized *= 0.5; }
    float mantissa = (normalized - 1.0) * 8388608.0;
    float biased = exponent + 127.0;
    return vec4(mod(mantissa, 256.0), mod(floor(mantissa / 256.0), 256.0),
        floor(mantissa / 65536.0) + mod(biased, 2.0) * 128.0,
        floor(biased / 2.0) + (v < 0.0 ? 128.0 : 0.0)) / 255.0;
}
#else
vec3 readStage(vec2 p) {
    return texture2D(tStage, (p + 0.5) / (atlasGrid * vec2(8.0, 9.0))).rgb;
}
vec4 writeStage(vec3 value) { return vec4(value, 1.0); }
#endif

void main() {
#if JPEG_STAGE == 3
    vec4 orig = texture2D(tDiffuse, vUv * uvScale);
    vec2 vv = clamp(vUv, vec2(0.0), vec2(0.999999));
    vec2 lowCoord = clamp(floor(vv * lowResolution), vec2(0.0), lowResolution - 1.0);
    vec2 block = mix(floor(lowCoord / 8.0), floor(vv * outputResolution), sparseAxes);
    vec2 base = sourceBase(block);
    float index = block.y * blockGrid.x + block.x - blockOffset;
    if (index < 0.0 || index >= blockCount) discard;
    vec2 at = atlasBlock(index);
    float lx = lowCoord.x - base.x;
    // The original clamps fractional last coordinates before the IDCT.
    float row = ceil(lowCoord.y - base.y);
    vec3 result = vec3(0.0);
    for (int u = 0; u < 8; u++) {
        float cu = u == 0 ? 0.70710678 : 1.0;
        result += readStage(at + vec2(float(u), row)) * (cu * cos((2.0 * lx + 1.0) * float(u) * JPI / 16.0));
    }
    result *= 0.25;
    vec3 dmg = clamp(ycbcr2rgb(result / 255.0 + 0.5), 0.0, 1.0);
    dmg *= scaleLights;
    float lum0 = dot(dmg, vec3(0.299, 0.587, 0.114));
    dmg += offsetDarks * (1.0 - lum0);
    float lum1 = dot(clamp(dmg, 0.0, 1.0), vec3(0.299, 0.587, 0.114));
    dmg = clamp(mix(vec3(lum1), dmg, saturation), 0.0, 1.0);
    gl_FragColor = vec4(mix(orig.rgb, dmg, clamp(amount, 0.0, 1.0)), orig.a);
#else
    vec2 pixel = floor(gl_FragCoord.xy);
#ifdef JPEG_PACKED
    pixel.x = floor(pixel.x / 3.0);
#endif
    vec2 at = floor(pixel / vec2(8.0, 9.0)) * vec2(8.0, 9.0);
    vec2 freq = pixel - at;
    float index = at.y / 9.0 * atlasGrid.x + at.x / 8.0;
    if (index >= blockCount) { gl_FragColor = writeStage(vec3(0.0)); return; }
    index += blockOffset;
    vec2 block = vec2(mod(index, blockGrid.x), floor(index / blockGrid.x));
    vec2 blockBase = sourceBase(block);
    vec3 result = vec3(0.0);
#if JPEG_STAGE < 2
    if (freq.y >= 8.0) { gl_FragColor = writeStage(vec3(0.0)); return; }
#endif
#if JPEG_STAGE == 0
    for (int i = 0; i < 8; i++) {
        vec2 tuv = clamp((blockBase + vec2(float(i), freq.y) + 0.5) / lowResolution, vec2(0.0), vec2(1.0));
        vec3 sampleYcc = (rgb2ycbcr(texture2D(tDiffuse, tuv * uvScale).rgb) - 0.5) * 255.0;
        result += sampleYcc * cos((2.0 * float(i) + 1.0) * freq.x * JPI / 16.0);
    }
#elif JPEG_STAGE == 1
    for (int j = 0; j < 8; j++) {
        result += readStage(at + vec2(freq.x, float(j))) * cos((2.0 * float(j) + 1.0) * freq.y * JPI / 16.0);
    }
    float cu = freq.x == 0.0 ? 0.70710678 : 1.0;
    float cv = freq.y == 0.0 ? 0.70710678 : 1.0;
    result *= 0.25 * cu * cv;
    float m = allFreq;
    if (freq.x != 0.0) m *= xFreq;
    if (freq.y != 0.0) m *= yFreq;
    float sb = freq.x + freq.y;
    if (sb <= 2.0) m *= lowFreq;
    else if (sb <= 6.0) m *= midFreq;
    else m *= highFreq;
    float eL = max(1.0 + (m - 1.0) * affectLuma, 0.0);
    float eC = max(1.0 + (m - 1.0) * affectChroma, 0.0);
    float qq = clamp(quality, 0.01, 1.0) * 100.0;
    float qScale = qq < 50.0 ? 5000.0 / qq : 200.0 - 2.0 * qq;
    vec2 qt = floor(texture2D(quantTable, (freq + 0.5) / 8.0).rg * 255.0 + 0.5);
    vec2 q = max(floor((qt * qScale + 50.0) / 100.0), 1.0);
    result = vec3(jpegRound(result.x * eL / q.x) * q.x,
        jpegRound(result.y * eC / q.y) * q.y, jpegRound(result.z * eC / q.y) * q.y);
    float errFrame = jitterFrames < 0.5 ? 0.0 : floor(floor(time * 30.0) / max(jitterFrames, 1.0));
    vec2 bseed = blockBase * 0.731 + vec2(randSeed * 91.7, randSeed * 47.3) + vec2(errFrame * 13.73, errFrame * 7.31);
    float bh = hash12(bseed);
    float cn = vnoise(blockBase * 0.13 + bseed * 0.31);
    float gate = mix(bh, cn, clamp(errCoherence * 0.25, 0.0, 1.0));
    float blockHit = step(1.0 - clamp(errDensity, 0.0, 1.0), gate) * step(0.001, errRate);
    if (blockHit > 0.5) {
        float slotP = clamp(errRate / 6.0, 0.0, 1.0);
        float errGain = errAmp * (1.0 + errRate * 0.25);
        for (int s = 0; s < 6; s++) {
            float fs = float(s);
            float h1 = hash12(bseed + vec2(fs * 17.17, fs * 9.31));
            if (h1 < slotP) {
                float h2 = hash12(bseed + vec2(fs * 5.37 + 3.1, fs * 11.7 + 7.7));
                float h3 = hash12(bseed + vec2(fs * 3.71 + 9.2, fs * 7.97 + 1.3));
                float h4 = hash12(bseed + vec2(fs * 13.1 + 5.5, fs * 1.93 + 4.4));
                float h5 = hash12(bseed + vec2(fs * 8.77 + 2.2, fs * 4.23 + 6.6));
                vec2 picked = min(floor(vec2(h2, h3) * 8.0), 7.0);
                if (picked.x == freq.x && picked.y == freq.y) {
                    result += vec3((h4 - 0.5) * 2.0 * errGain * q.x,
                        (h5 - 0.5) * 2.0 * errGain * q.y, (h4 + h5 - 1.0) * errGain * q.y);
                }
            }
        }
    }
#else
    float ly = min(blockBase.y + freq.y, lowResolution.y - 1.0) - blockBase.y;
    for (int v = 0; v < 8; v++) {
        float cv = v == 0 ? 0.70710678 : 1.0;
        result += readStage(at + vec2(freq.x, float(v))) * (cv * cos((2.0 * ly + 1.0) * float(v) * JPI / 16.0));
    }
#endif
    gl_FragColor = writeStage(result);
#endif
}
