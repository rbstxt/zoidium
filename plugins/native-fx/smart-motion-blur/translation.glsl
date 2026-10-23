uniform sampler2D uPrevious;
uniform sampler2D uNext;
uniform sampler2D uTranslation;
uniform sampler2D uCosts;
uniform float uStep;
float cost(float column, float row) {
    return unpackStatistic(texture2D(uCosts, vec2((column + 0.5) / 65.0, (row + 0.5) / 2.0)));
}
void main() {
    float direction = floor(gl_FragCoord.x);
    vec2 best = vec2(0.0);
    if (uStep < -0.5) {
        float bestCost = cost(64.0, direction);
        for (int index = 0; index < 64; index++) {
            float score = cost(float(index), direction);
            if (score < bestCost) {
                bestCost = score;
                vec2 uv = (vec2(mod(float(index), 8.0), floor(float(index) / 8.0)) + 0.5) / 8.0;
                best = direction < 0.5 ? decodeFlow(texture2D(uPrevious, uv)) : decodeFlow(texture2D(uNext, uv));
            }
        }
    } else {
        vec2 center = decodeFlow(texture2D(uTranslation, vec2((direction + 0.5) / 2.0, 0.5)));
        best = center;
        float bestCost = cost(4.0, direction);
        for (int index = 0; index < 9; index++) {
            float score = cost(float(index), direction);
            if (score < bestCost) {
                bestCost = score;
                best = center + (vec2(mod(float(index), 3.0), floor(float(index) / 3.0)) - 1.0) * uStep;
            }
        }
    }
    gl_FragColor = encodeFlow(best);
}
