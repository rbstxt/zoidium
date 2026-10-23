uniform sampler2D uCurrent;
uniform sampler2D uFlow;
uniform sampler2D uScore;
uniform sampler2D uAnchors;
uniform vec2 uSize;
uniform vec2 uQuadrant;
uniform float uRadius;
uniform sampler2D uRawCurrent;
uniform vec2 uRawSize;
uniform vec2 uRawScale;
vec4 guideAt(vec2 uv) {
    vec2 point = (floor(uv * uRawScale * uRawSize + 0.0001) + 0.5) / uRawSize;
    return texture2D(uRawCurrent, point);
}

vec2 decodeAnchor(vec4 value) {
    vec4 bytes = floor(value * 255.0 + 0.5);
    return vec2(bytes.r * 256.0 + bytes.g, bytes.b * 256.0 + bytes.a) - 1.0;
}
vec4 encodeAnchor(vec2 point) {
    vec2 code = point + 1.0;
    return vec4(floor(code.x / 256.0), mod(code.x, 256.0), floor(code.y / 256.0),
                mod(code.y, 256.0)) /
           255.0;
}
bool connected(vec2 point, vec4 center) {
    vec2 uv = (point + 0.5) / uSize;
    // Check the path as well as its endpoint. Equal colors on separate objects
    // must not let a constraint jump across the intervening background.
    for (int index = 1; index <= 4; index++) {
        vec4 difference = features(guideAt(mix(vUv, uv, float(index) / 4.0))) - center;
        if (dot(difference, difference) > 0.002) return false;
    }
    return true;
}
void main() {
    if (uRadius < 0.5) {
#ifdef FLOW_PACKED
        float valid = texture2D(uScore, vUv).r;
#else
        float valid = texture2D(uFlow, vUv).b;
#endif
        gl_FragColor = valid > 0.25 ? encodeAnchor(floor(vUv * uSize)) : vec4(0.0);
        return;
    }
    vec2 pixel = floor(vUv * uSize);
    vec2 best = vec2(-1.0);
    float bestDistance = 1.0e20;
    float bestPriority = 0.0;
    vec4 center = features(guideAt(vUv));
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 uv = vUv + vec2(float(x), float(y)) * uRadius / uSize;
            if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
            vec2 point = decodeAnchor(texture2D(uAnchors, uv));
            if (point.x < 0.0 || point.y < 0.0) continue;
            vec2 offset = point - pixel;
            if (any(lessThan(offset * uQuadrant, vec2(-0.01)))) continue;
            float distance = dot(offset, offset);
#ifdef FLOW_PACKED
            float priority = texture2D(uScore, (point + 0.5) / uSize).r;
#else
            float priority = texture2D(uFlow, (point + 0.5) / uSize).b;
#endif
            if ((priority > bestPriority + 0.1 ||
                 (abs(priority - bestPriority) < 0.1 && distance < bestDistance)) &&
                connected(point, center)) {
                best = point;
                bestDistance = distance;
                bestPriority = priority;
            }
        }
    }
    gl_FragColor = best.x < 0.0 ? vec4(0.0) : encodeAnchor(best);
}
