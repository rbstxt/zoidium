uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform vec2 uSize;
uniform vec2 uFlowSize;
uniform float uCoarse;

float cost(vec2 velocity) {
    vec2 d = velocity / uProject;
    vec4 center = features(texture2D(uCurrent, vUv));
    float sum = 0.0, weights = 0.0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 p = vUv + vec2(float(x), float(y)) / uSize;
            vec4 a = features(texture2D(uCurrent, p));
            vec4 b = features(texture2D(uOther, p + d));
            float w = 0.1 + 0.9 * exp(-dot(a-center, a-center) * 12.0);
            sum += robust(a - b) * w;
            weights += w;
        }
    }
    // Luma gradient constancy adds edge orientation without dropping chroma
    // or alpha information from the patch term.
    vec2 e = vec2(1.0 / uSize.x, 0.0), f = vec2(0.0, 1.0 / uSize.y);
    vec2 ga = vec2(features(texture2D(uCurrent, vUv+e)).r - features(texture2D(uCurrent, vUv-e)).r,
        features(texture2D(uCurrent, vUv+f)).r - features(texture2D(uCurrent, vUv-f)).r);
    vec2 gb = vec2(features(texture2D(uOther, vUv+d+e)).r - features(texture2D(uOther, vUv+d-e)).r,
        features(texture2D(uOther, vUv+d+f)).r - features(texture2D(uOther, vUv+d-f)).r);
    return sum / weights + 0.1 * length(ga-gb);
}
void main() {
    vec2 base = vec2(0.0);
    if (uCoarse < 0.5) base = flowAt(uFlow, vUv, uFlowSize);
    vec2 best = base;
    float bestCost = cost(best);
    // Constant loop bounds are required by GLSL ES 1.00. Fine levels evaluate
    // only the central 3x3 candidates.
    for (int y = -4; y <= 4; y++) {
        for (int x = -4; x <= 4; x++) {
            if (uCoarse < 0.5 && (abs(x) > 1 || abs(y) > 1)) continue;
            vec2 v = base + vec2(float(x), float(y)) * uProject / uSize;
            if (length(v) > uLimit) continue;
            float c = cost(v);
            if (c < bestCost - 0.000001 || (abs(c-bestCost) <= 0.000001 && dot(v,v) < dot(best,best))) {
                best = v; bestCost = c;
            }
        }
    }
    gl_FragColor = encodeFlow(best);
}
