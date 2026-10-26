uniform float uAxis;
uniform float uRadius;
uniform sampler2D uCosts;
float candidateCost(float column, float row) {
    float sum = 0.0;
    // Preserve statistics-reduce's traversal and fixed-point round trip.
    for (int y = 0; y < 8; y++)
        for (int x = 0; x < 8; x++) {
            vec2 pixel = vec2(column, row) * 8.0 + vec2(float(x), float(y));
            sum += unpackStatistic(texture2D(uCosts, (pixel + 0.5) / vec2(24.0, 16.0))) / 64.0;
        }
    return unpackStatistic(packStatistic(sum));
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
    float original = coefficient(column, row);
    if (abs(column - uAxis) > 0.1) {
        gl_FragColor = texture2D(uHomography, vUv);
        return;
    }
    float best = candidateCost(0.0, row);
    float selected = original;
    float score = candidateCost(1.0, row);
    if (score < best) { best = score; selected = original - uRadius; }
    score = candidateCost(2.0, row);
    if (score < best) selected = original + uRadius;
    gl_FragColor = encodeCoefficient(selected);
}
