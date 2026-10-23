uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2 uSize;
uniform float uAxis;
uniform float uRadius;
float parameters[8];
float cost(float row) {
    float sum = 0.0;
    for (int y = 0; y < 128; y++) {
        for (int x = 0; x < 128; x++) {
            if (float(x) >= uSize.x || float(y) >= uSize.y) continue;
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / uSize;
            vec2 point = (uv - 0.5) * uProject / 128.0;
            vec2 moved = vec2(parameters[0] * point.x + parameters[1] * point.y + parameters[4],
                              parameters[2] * point.x + parameters[3] * point.y + parameters[5]);
            moved /= 1.0 + parameters[6] * point.x + parameters[7] * point.y;
            vec2 target = moved * 128.0 / uProject + 0.5;
            vec4 other = row < 0.5 ? texture2D(uBefore, target) : texture2D(uAfter, target);
            sum += length(texture2D(uCurrent, uv) - other);
        }
    }
    return sum;
}
void main() {
    float column = floor(gl_FragCoord.x), row = floor(gl_FragCoord.y);
    if (uAxis < -0.5) {
        prepareGlobal(row + 1.0);
        vec2 center = (globalCurrent - 0.5) * uProject / 128.0;
        vec2 other = (globalOther - 0.5) * uProject / 128.0;
        float value = 0.0;
        if (column < 0.5) value = globalAffine.x;
        else if (column < 1.5) value = 0.0;
        else if (column < 2.5) value = globalAffine.y;
        else if (column < 3.5) value = globalAffine.z;
        else if (column < 4.5) value = other.x - globalAffine.x * center.x;
        else if (column < 5.5) value = other.y - globalAffine.y * center.x - globalAffine.z * center.y;
        gl_FragColor = encodeCoefficient(value);
        return;
    }
    if (abs(column - uAxis) > 0.1) {
        gl_FragColor = texture2D(uHomography, vUv);
        return;
    }
    for (int index = 0; index < 8; index++) parameters[index] = coefficient(float(index), row);
    float original = coefficient(uAxis, row), selected = original, best = cost(row);
    for (int index = 0; index < 8; index++)
        if (abs(float(index) - uAxis) < 0.1) parameters[index] = original - uRadius;
    float score = cost(row);
    if (score < best) { best = score; selected = original - uRadius; }
    for (int index = 0; index < 8; index++)
        if (abs(float(index) - uAxis) < 0.1) parameters[index] = original + uRadius;
    score = cost(row);
    if (score < best) selected = original + uRadius;
    gl_FragColor = encodeCoefficient(selected);
}
