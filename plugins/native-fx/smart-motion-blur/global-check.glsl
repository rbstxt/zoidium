uniform sampler2D uChecks;
uniform float uHasHomography;
float metric(float column, float row) {
    return unpackStatistic(texture2D(uChecks, vec2((column + 0.5) / 7.0, (row - 0.5) / 2.0)));
}
void main() {
    float row = floor(gl_FragCoord.x) + 1.0;
    prepareGlobal(row);
    float raw = metric(0.0, row), compensated = metric(1.0, row);
    float affine = metric(2.0, row), translated = metric(3.0, row);
    float projective = metric(4.0, row), weight = metric(5.0, row);
    float border = metric(6.0, row);
    float mode = 0.0;
    if (affine < compensated) {
        compensated = affine;
        mode = 0.5;
    }
    if (translated < compensated) {
        compensated = translated;
        mode = 1.0;
    }
    if (uHasHomography > 0.5 && projective < compensated) {
        compensated = projective;
        mode = 0.25;
    }
    bool accepted = raw > 0.01 / 24576.0 && compensated < raw * 0.6 && compensated < max(weight, 0.01 / 24576.0) * 0.3;
    // Full-frame footage and opaque handheld shots have occupied borders.
    // A projective proposal is reserved for an isolated subject with a stable border.
    bool candidate = abs(globalAffine.x - globalAffine.z) > 0.03 &&
                     abs(globalAffine.z - 1.0) < 0.2 && border < 0.002;
    gl_FragColor = vec4(accepted ? 1.0 : 0.0, compensated / max(weight, 0.01 / 24576.0), mode,
                       candidate ? 1.0 : 0.0);
}
