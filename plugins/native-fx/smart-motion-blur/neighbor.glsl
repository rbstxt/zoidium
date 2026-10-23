uniform sampler2D uFlow;
uniform vec2 uSize;
uniform vec2 uProcessing;
uniform float uAmount;
void main() {
    vec2 best = vec2(0.0);
    float bestDistance = 1.0e20;
    vec2 radius = ceil(uLimit * uProcessing / uProject * uAmount / 32.0) + 1.0;
    for (int offsetY = -9; offsetY <= 9; offsetY++) {
        for (int offsetX = -9; offsetX <= 9; offsetX++) {
            vec2 offset = vec2(float(offsetX), float(offsetY));
            if (abs(offset.x) > radius.x || abs(offset.y) > radius.y) continue;
            vec2 uv = vUv + offset / uSize;
            if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
            vec2 motion = decodeFlow(texture2D(uFlow, uv));
            vec2 travel = motion * uProcessing / uProject * uAmount * 0.5;
            if (dot(motion, motion) < 0.0625) continue;
            vec2 distance = max(abs(offset * 16.0) - abs(travel) - 16.0, vec2(0.0));
            if (dot(distance, distance) > 0.0) continue;
            float score = dot(offset, offset);
            if (score < bestDistance ||
                (score == bestDistance && dot(motion, motion) > dot(best, best))) {
                best = motion;
                bestDistance = score;
            }
        }
    }
    gl_FragColor = encodeFlow(best);
}
