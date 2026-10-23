attribute vec2 otherA;
attribute vec2 otherB;
uniform sampler2D uFlow;
uniform sampler2D uImage;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2 uScale;
uniform vec2 uFlowSize;
uniform vec2 uProcessing;
uniform float uTime;
uniform float uDelta;
uniform float uTear;
bool stationaryPatch(vec2 point) {
    // Transparent antialiased content can retain the same interior colors
    // while its boundary moves. Only classify an opaque background here.
    if (texture2D(uImage, vec2(0.00001)).a < 0.99) return false;
    vec4 color = texture2D(uImage, point * uScale);
    if (color.a > 0.99) {
        vec2 texel = uScale / uProcessing;
        float before = 0.0, after = 0.0, variation = 0.0, opacity = 1.0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 uv = point * uScale + vec2(float(x), float(y)) * texel;
                vec4 sample = texture2D(uImage, uv);
                before += length(sample - texture2D(uBefore, uv));
                after += length(sample - texture2D(uAfter, uv));
                variation = max(variation, length(sample - color));
                opacity = min(opacity, sample.a);
            }
        }
        // One unchanged opaque textured observation identifies the stationary
        // sheet even when the other neighbor covers it with foreground.
        if (min(before, after) < 0.01 && opacity > 0.99 && variation > 0.02)
            return true;
    }
    return false;
}
vec2 guidedMotion(vec2 point, vec4 center) {
    if (stationaryPatch(point)) return vec2(0.0);
    vec4 color = texture2D(uImage, point * uScale);
    float stationary = min(length(color - texture2D(uBefore, point * uScale)),
                           length(color - texture2D(uAfter, point * uScale)));
    vec2 texel = uScale / uProcessing;
    float equal = 0.0;
    equal += step(length(color - texture2D(uImage, point * uScale + vec2(texel.x, 0.0))), 0.004);
    equal += step(length(color - texture2D(uImage, point * uScale - vec2(texel.x, 0.0))), 0.004);
    equal += step(length(color - texture2D(uImage, point * uScale + vec2(0.0, texel.y))), 0.004);
    equal += step(length(color - texture2D(uImage, point * uScale - vec2(0.0, texel.y))), 0.004);
    if (stationary < 0.00001 && equal < 2.0 && color.a > 0.99)
        return vec2(0.0);
    vec2 base = floor(point * uFlowSize - 0.5);
    vec2 fraction = clamp(point * uFlowSize - 0.5 - base, 0.0, 1.0);
    vec2 sum = vec2(0.0);
    float total = 0.0;
    for (int y = 0; y < 2; y++) {
        for (int x = 0; x < 2; x++) {
            vec2 uv = (base + vec2(float(x), float(y)) + 0.5) / uFlowSize;
            vec4 difference = features(texture2D(uImage, uv * uScale)) - center;
            float spatial =
                (x == 0 ? 1.0 - fraction.x : fraction.x) * (y == 0 ? 1.0 - fraction.y : fraction.y);
            float weight =
                (spatial + 0.001) * (exp(-dot(difference, difference) * 80.0) + 0.000001);
            sum += decodeFlow(texture2D(uFlow, uv)) * weight;
            total += weight;
        }
    }
    return sum / max(total, 0.000001);
}
