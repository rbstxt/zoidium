precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// Panzoid custom properties
uniform float Render;               // 0 Fill, 1 Edges, 2 Fill & Edges
uniform float Detail_Radius;        // pixels
uniform float Detail_Threshold;     // 0..100
uniform float Shading_Steps;        // 1..32
uniform float Shading_Smoothness;   // 0..100
uniform float Threshold;            // 0..10
uniform float Width;                // pixels
uniform float Softness;             // 0..100
uniform float Opacity;              // 0..100
uniform float Edge_Enhancement;     // -5..5
uniform float Edge_Black_Level;     // 0..5
uniform float Edge_Contrast;        // 0..2

float saturate(float x) {
    return clamp(x, 0.0, 1.0);
}

vec3 src(vec2 uv) {
    return texture2D(tDiffuse, uv).rgb;
}

float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

// ----------------------------------------------------
// Lightweight edge-preserving smoothing for fill
// 9 taps total
// ----------------------------------------------------
vec3 fastSmooth(vec2 uv) {
    vec3 c0 = src(uv);

    float r = max(Detail_Radius, 0.0);
    if (r < 0.5) return c0;

    vec2 px = 1.0 / resolution;
    float rr = max(1.0, r);
    vec2 ox = vec2(rr * px.x, 0.0);
    vec2 oy = vec2(0.0, rr * px.y);
    vec2 od = vec2(rr * 0.70710678 * px.x, rr * 0.70710678 * px.y);

    float sigma = mix(0.015, 0.25, saturate(Detail_Threshold / 100.0));
    float sig2 = max(sigma * sigma, 1e-5);

    vec3 acc = c0;
    float wsum = 1.0;

    vec3 s;
    float w;

    s = src(uv + ox); w = exp(-dot(s - c0, s - c0) / sig2) * 0.90; acc += s * w; wsum += w;
    s = src(uv - ox); w = exp(-dot(s - c0, s - c0) / sig2) * 0.90; acc += s * w; wsum += w;
    s = src(uv + oy); w = exp(-dot(s - c0, s - c0) / sig2) * 0.90; acc += s * w; wsum += w;
    s = src(uv - oy); w = exp(-dot(s - c0, s - c0) / sig2) * 0.90; acc += s * w; wsum += w;

    s = src(uv + od); w = exp(-dot(s - c0, s - c0) / sig2) * 0.65; acc += s * w; wsum += w;
    s = src(uv - od); w = exp(-dot(s - c0, s - c0) / sig2) * 0.65; acc += s * w; wsum += w;
    s = src(uv + vec2( od.x, -od.y)); w = exp(-dot(s - c0, s - c0) / sig2) * 0.65; acc += s * w; wsum += w;
    s = src(uv + vec2(-od.x,  od.y)); w = exp(-dot(s - c0, s - c0) / sig2) * 0.65; acc += s * w; wsum += w;

    return acc / max(wsum, 1e-5);
}

// ----------------------------------------------------
// Cartoon fill / cel shading
// ----------------------------------------------------
vec3 cartoonFill(vec3 color) {
    float lum = luma(color);
    float steps = max(1.0, floor(Shading_Steps + 0.5));

    float scaled = lum * steps;
    float baseBand = floor(scaled);
    float fracBand = fract(scaled);

    float lo = baseBand / steps;
    float hi = min(baseBand + 1.0, steps) / steps;

    float smoothAmt = saturate(Shading_Smoothness / 100.0);
    float bandSoft = mix(0.001, 0.35, smoothAmt);
    float t = smoothstep(0.5 - bandSoft, 0.5 + bandSoft, fracBand);

    float targetLum = mix(lo, hi, t);
    float safeLum = max(lum, 1e-4);

    vec3 outCol = color * (targetLum / safeLum);

    float rgbSteps = max(2.0, steps * 0.8);
    vec3 poster = floor(outCol * rgbSteps + 0.5) / rgbSteps;
    outCol = mix(outCol, poster, 0.28);

    return clamp(outCol, 0.0, 1.0);
}

// ----------------------------------------------------
// Cheap edge detector (5 taps)
// ----------------------------------------------------
float edgeBase(vec2 uv) {
    vec2 px = 1.0 / resolution;

    float edgeDist = max(1.0, 1.0 + Detail_Radius * 0.18 + max(Edge_Enhancement, 0.0) * 0.35);
    vec2 dx = vec2(edgeDist * px.x, 0.0);
    vec2 dy = vec2(0.0, edgeDist * px.y);

    float lc = luma(src(uv));
    float ll = luma(src(uv - dx));
    float lr = luma(src(uv + dx));
    float lt = luma(src(uv + dy));
    float lb = luma(src(uv - dy));

    float gx = lr - ll;
    float gy = lt - lb;
    float g = length(vec2(gx, gy));

    float detailBias = mix(0.85, 1.75, saturate(Detail_Threshold / 100.0));
    float th = max(0.0001, Threshold * detailBias);

    float widthGain = 1.0 + Width * 0.7;

    float enh = Edge_Enhancement;
    float enhGain = 1.0 + max(enh, 0.0) * 0.25;
    float spread = 1.0 + max(-enh, 0.0) * 0.35;

    float e = g * widthGain * enhGain / spread;

    e = max(e - th * 0.08, 0.0) / (th * 0.55 + 0.06);

    float contrast = max(0.05, 1.0 + Edge_Contrast * 2.5);
    e = pow(max(e, 0.0), contrast);

    e *= mix(0.92, 1.08, saturate(abs(lc - 0.5) * 2.0));

    return saturate(e);
}

// ----------------------------------------------------
// Edge width + softness + black level
// Small 5-sample dilation
// ----------------------------------------------------
float finalEdge(vec2 uv) {
    vec2 px = 1.0 / resolution;

    float wpx = max(0.0, Width);
    vec2 ox = vec2(wpx * px.x, 0.0);
    vec2 oy = vec2(0.0, wpx * px.y);

    float e0 = edgeBase(uv);
    float e1 = edgeBase(uv + ox);
    float e2 = edgeBase(uv - ox);
    float e3 = edgeBase(uv + oy);
    float e4 = edgeBase(uv - oy);

    float eMax = max(e0, max(e1, max(e2, max(e3, e4))));
    float eAvg = (e0 + e1 + e2 + e3 + e4) / 5.0;

    float soft = saturate(Softness / 100.0);
    float edge = mix(eMax, eAvg, soft);

    edge += Edge_Black_Level * 0.18;
    edge = saturate(edge);

    return edge;
}

void main() {
    vec2 uv = vUvScaled;

    vec3 smoothed = fastSmooth(uv);
    vec3 fillColor = cartoonFill(smoothed);

    float edgeMask = finalEdge(uv);
    float edgeOpacity = saturate(Opacity / 100.0);

    vec3 edgesOnly = vec3(1.0 - edgeMask * edgeOpacity);
    vec3 fillAndEdges = mix(fillColor, vec3(0.0), edgeMask * edgeOpacity);

    float mode = floor(Render + 0.5);

    vec3 outCol;
    if (mode < 0.5) {
        outCol = fillColor;
    } else if (mode < 1.5) {
        outCol = edgesOnly;
    } else {
        outCol = fillAndEdges;
    }

    gl_FragColor = vec4(outCol, 1.0);
}
