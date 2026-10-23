uniform float uAxis;
uniform float uRadius;
uniform sampler2D uCosts;
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
    float original = coefficient(column, row);
    if (abs(column - uAxis) > 0.1) {
        gl_FragColor = texture2D(uHomography, vUv);
        return;
    }
    float best = unpackStatistic(texture2D(uCosts, vec2(0.5 / 3.0, (row + 0.5) / 2.0)));
    float selected = original;
    float score = unpackStatistic(texture2D(uCosts, vec2(1.5 / 3.0, (row + 0.5) / 2.0)));
    if (score < best) { best = score; selected = original - uRadius; }
    score = unpackStatistic(texture2D(uCosts, vec2(2.5 / 3.0, (row + 0.5) / 2.0)));
    if (score < best) selected = original + uRadius;
    gl_FragColor = encodeCoefficient(selected);
}
