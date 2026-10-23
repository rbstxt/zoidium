uniform sampler2D uFlow;
uniform vec2 uFlowSize;
uniform vec2 uProcessing;
uniform float uDelta;
uniform float uSign;
void main() {
    vec2 first = floor(gl_FragCoord.xy - 0.5) * 16.0;
    vec2 best = vec2(0.0);
    for (int y = 0; y < 16; y++)
        for (int x = 0; x < 16; x++) {
            vec2 p = first + vec2(float(x), float(y)) + 0.5;
            if (p.x > uProcessing.x || p.y > uProcessing.y) continue;
            vec2 f = flowAt(uFlow, p / uProcessing, uFlowSize) * uSign / uDelta;
            if (dot(f, f) > dot(best, best)) best = f;
        }
    gl_FragColor = encodeFlow(best);
}
