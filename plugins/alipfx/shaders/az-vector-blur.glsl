precision highp float;
precision highp int;

// Built‑ins
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// Custom properties
uniform int Type;                 // 0:Natural, 1:Constant Length, 2:Perpendicular, 3:Direction Center, 4:Direction Fading
uniform float Amount;
uniform float Angle_Offset;
uniform float Ridge_Smoothness;
uniform float Revolutions;
uniform int Property;             // 0:Red,1:Green,2:Blue,3:Alpha,4:Luminance,5:Lightness,6:Hue,7:Saturation
uniform float Map_Softness;

// ------------------------------------------------------------
// Utility: convert RGB to HSV (hue in 0..1)
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y)/(6.0*d + e)), d/(q.x + e), q.x);
}

// ------------------------------------------------------------
// Get scalar map value from the source texel according to Property
float getMapValue(vec4 texel) {
    if (Property == 0) return texel.r;                     // Red
    if (Property == 1) return texel.g;                     // Green
    if (Property == 2) return texel.b;                     // Blue
    if (Property == 3) return texel.a;                     // Alpha
    if (Property == 4) {                                    // Luminance (Rec.709)
        return dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
    }
    if (Property == 5) {                                    // Lightness (HSL)
        float mx = max(texel.r, max(texel.g, texel.b));
        float mn = min(texel.r, min(texel.g, texel.b));
        return (mx + mn) * 0.5;
    }
    if (Property == 6) {                                    // Hue
        return rgb2hsv(texel.rgb).x;
    }
    if (Property == 7) {                                    // Saturation
        return rgb2hsv(texel.rgb).y;
    }
    return 0.0;
}

// ------------------------------------------------------------
// 3x3 Gaussian blur with kernel radius = Map_Softness (pixels)
// Also returns Sobel gradients (smoothed) for types 0–2.
void sampleMapWithBlur(vec2 uv, out float smoothVal, out vec2 grad) {
    vec2 px = 1.0 / resolution;
    float scale = max(0.0, Map_Softness);
    vec2 stepUV = px * scale;

    vec2 off[9];
    off[0] = vec2(-1.0, -1.0) * stepUV;
    off[1] = vec2( 0.0, -1.0) * stepUV;
    off[2] = vec2( 1.0, -1.0) * stepUV;
    off[3] = vec2(-1.0,  0.0) * stepUV;
    off[4] = vec2( 0.0,  0.0) * stepUV;
    off[5] = vec2( 1.0,  0.0) * stepUV;
    off[6] = vec2(-1.0,  1.0) * stepUV;
    off[7] = vec2( 0.0,  1.0) * stepUV;
    off[8] = vec2( 1.0,  1.0) * stepUV;

    float s[9];
    for (int i = 0; i < 9; i++) {
        vec4 texel = texture2D(tDiffuse, uv + off[i]);
        s[i] = getMapValue(texel);
    }

    float w[9];
    w[0] = 1.0; w[1] = 2.0; w[2] = 1.0;
    w[3] = 2.0; w[4] = 4.0; w[5] = 2.0;
    w[6] = 1.0; w[7] = 2.0; w[8] = 1.0;
    float sumW = 16.0;

    smoothVal = 0.0;
    for (int i = 0; i < 9; i++) {
        smoothVal += w[i] * s[i];
    }
    smoothVal /= sumW;

    float gx = 0.0, gy = 0.0;
    gx += -1.0 * s[0] + 0.0 * s[1] + 1.0 * s[2];
    gy += -1.0 * s[0] + -2.0 * s[1] + -1.0 * s[2];
    gx += -2.0 * s[3] + 0.0 * s[4] + 2.0 * s[5];
    gy +=  0.0 * s[3] + 0.0 * s[4] + 0.0 * s[5];
    gx += -1.0 * s[6] + 0.0 * s[7] + 1.0 * s[8];
    gy +=  1.0 * s[6] + 2.0 * s[7] + 1.0 * s[8];

    grad = vec2(gx, gy) / 8.0;
    if (Ridge_Smoothness > 0.0) {
        grad *= Ridge_Smoothness;
    }
}

// ------------------------------------------------------------
// Directional blur accumulation – 64 samples for ultra‑smooth fading
vec4 directionalBlur(vec2 uv, vec2 dir, float lenPixels, bool symmetric, bool fading) {
    if (lenPixels < 0.5) return texture2D(tDiffuse, uv);

    vec2 px = 1.0 / resolution;
    const int SAMPLES = 64;                     // increased for maximum smoothness
    vec4 accum = vec4(0.0);
    float totalWeight = 0.0;

    if (symmetric) {
        for (int i = 0; i < SAMPLES; i++) {
            float t = float(i) / float(SAMPLES - 1) * 2.0 - 1.0;  // -1..1
            vec2 offset = dir * (t * lenPixels) * px;
            vec2 sampleUV = uv + offset;
            vec4 c = texture2D(tDiffuse, sampleUV);
            float w = 1.0;
            accum += c * w;
            totalWeight += w;
        }
    } else if (fading) {
        for (int i = 0; i < SAMPLES; i++) {
            float t = float(i) / float(SAMPLES - 1);              // 0..1
            vec2 offset = dir * (t * lenPixels) * px;
            vec2 sampleUV = uv + offset;
            vec4 c = texture2D(tDiffuse, sampleUV);
            // Smoothstep‑based weight: perfectly smooth fade‑out
            float w = 1.0 - smoothstep(0.0, 1.0, t);
            accum += c * w;
            totalWeight += w;
        }
    }

    return accum / totalWeight;
}

// ------------------------------------------------------------
void main() {
    float mapVal;
    vec2 grad;
    sampleMapWithBlur(vUvScaled, mapVal, grad);

    vec4 result = texture2D(tDiffuse, vUvScaled);

    vec2 dir = vec2(0.0);
    float len = 0.0;
    bool symmetric = false;
    bool fading = false;

    if (Type == 0) {        // Natural
        float gradLen = length(grad);
        if (gradLen > 0.0) {
            dir = normalize(grad);
            len = Amount * gradLen;
        }
        symmetric = true;
    }
    else if (Type == 1) {   // Constant Length
        float gradLen = length(grad);
        if (gradLen > 0.0) {
            dir = normalize(grad);
            len = Amount;
        }
        symmetric = true;
    }
    else if (Type == 2) {   // Perpendicular
        float gradLen = length(grad);
        if (gradLen > 0.0) {
            dir = normalize(vec2(-grad.y, grad.x));
            len = Amount * gradLen;
        }
        symmetric = true;
    }
    else if (Type == 3) {   // Direction Center
        float angle = mapVal * 2.0 * 3.14159265 * Revolutions + radians(Angle_Offset);
        dir = vec2(cos(angle), sin(angle));
        len = Amount;
        symmetric = true;
    }
    else if (Type == 4) {   // Direction Fading
        float angle = mapVal * 2.0 * 3.14159265 * Revolutions + radians(Angle_Offset);
        dir = vec2(cos(angle), sin(angle));
        len = Amount;
        fading = true;      // one‑sided with ultra‑smooth fade
    }

    if (len > 0.5) {
        result = directionalBlur(vUvScaled, dir, len, symmetric, fading);
    }

    gl_FragColor = result;
}
