uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform sampler2D uPrevious;
uniform sampler2D uNext;
float direction;
vec4 otherAt(vec2 uv) { return direction < 0.5 ? texture2D(uBefore, uv) : texture2D(uAfter, uv); }
float cost(vec2 motion) {
    float total = 0.0;
    for (int y = 0; y < 12; y++) {
        for (int x = 0; x < 16; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(16.0, 12.0);
            vec2 moved = uv + motion / uProject;
            if (any(lessThan(moved, vec2(0.0))) || any(greaterThan(moved, vec2(1.0))))
                continue;
            total += length(texture2D(uCurrent, uv) - otherAt(moved));
        }
    }
    return total;
}
void main() {
    direction = floor(gl_FragCoord.x);
    vec2 best = vec2(0.0);
    float bestCost = cost(best);
    for (int y = 0; y < 8; y++) {
        for (int x = 0; x < 8; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / 8.0;
            vec2 candidate = direction < 0.5 ? decodeFlow(texture2D(uPrevious, uv))
                                             : decodeFlow(texture2D(uNext, uv));
            float score = cost(candidate);
            if (score < bestCost) {
                bestCost = score;
                best = candidate;
            }
        }
    }
    for (int step = 0; step < 5; step++) {
        vec2 center = best;
        float radius = exp2(1.0 - float(step));
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 candidate = center + vec2(float(x), float(y)) * radius;
                float score = cost(candidate);
                if (score < bestCost) {
                    bestCost = score;
                    best = candidate;
                }
            }
        }
    }
    gl_FragColor = encodeFlow(best);
}
