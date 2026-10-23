uniform sampler2D uFlow;
uniform vec2 uFlowSize;
uniform vec2 uProcessing;
uniform float uDelta;
uniform float uSign;
uniform sampler2D uImage;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2 uScale;

bool stationary(vec2 uv) {
    vec4 current = texture2D(uImage, uv * uScale);
    if (current.a < 0.000001) return true;
    float previousDifference = dot(abs(current - texture2D(uBefore, uv * uScale)), vec4(1.0));
    float nextDifference = dot(abs(current - texture2D(uAfter, uv * uScale)), vec4(1.0));
    if (min(previousDifference, nextDifference) > 0.001) return false;
    vec2 stepUv = uScale / uProcessing;
    vec4 horizontalPositive = abs(texture2D(uImage, uv * uScale + vec2(stepUv.x, 0.0)) - current);
    vec4 horizontalNegative = abs(texture2D(uImage, uv * uScale - vec2(stepUv.x, 0.0)) - current);
    vec4 verticalPositive = abs(texture2D(uImage, uv * uScale + vec2(0.0, stepUv.y)) - current);
    vec4 verticalNegative = abs(texture2D(uImage, uv * uScale - vec2(0.0, stepUv.y)) - current);
    float equalNeighbors = step(dot(horizontalPositive, vec4(1.0)), 0.004) +
                           step(dot(horizontalNegative, vec4(1.0)), 0.004) +
                           step(dot(verticalPositive, vec4(1.0)), 0.004) +
                           step(dot(verticalNegative, vec4(1.0)), 0.004);
    vec4 variation = horizontalPositive + horizontalNegative + verticalPositive + verticalNegative;
    return equalNeighbors < 2.0 && dot(variation, vec4(1.0)) > 0.02;
}
void main() {
    vec2 first = floor(gl_FragCoord.xy - 0.5) * 16.0;
    vec2 best = vec2(0.0);
    for (int offsetY = 0; offsetY < 16; offsetY++)
        for (int offsetX = 0; offsetX < 16; offsetX++) {
            vec2 pixel = first + vec2(float(offsetX), float(offsetY)) + 0.5;
            if (pixel.x > uProcessing.x || pixel.y > uProcessing.y) continue;
            if (stationary(pixel / uProcessing)) continue;
            vec2 motion = flowAt(uFlow, pixel / uProcessing, uFlowSize) * uSign / uDelta;
            if (dot(motion, motion) > dot(best, best)) best = motion;
        }
    gl_FragColor = encodeFlow(best);
}
