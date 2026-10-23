uniform float uHasHomography;
uniform sampler2D uTranslation;
uniform vec2 uScale;
uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
vec4 otherAt(vec2 uv, float row) {
    if (row < 1.5)
        return texture2D(uBefore, uv * uScale);
    return texture2D(uAfter, uv * uScale);
}
void main() {
    float row = floor(gl_FragCoord.x) + 1.0;
    prepareGlobal(row);
    vec4 background = texture2D(uCurrent, vec2(0.001) * uScale);
    vec2 translation = decodeFlow(texture2D(uTranslation, vec2((row - 0.5) / 2.0, 0.5)));
    float projective = 0.0;
    float raw = 0.0, compensated = 0.0, translated = 0.0, affine = 0.0, weight = 0.0;
    for (int y = 0; y < 96; y++) {
        for (int x = 0; x < 128; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(128.0, 96.0);
            vec4 current = texture2D(uCurrent, uv * uScale);
            vec2 moved = uv + globalMotion(uv) / uProject;
            raw += length(current - otherAt(uv, row));
            if (uHasHomography > 0.5)
                projective += length(current - otherAt(uv + projectiveMotion(uv, row - 1.0) / uProject, row));
            affine += length(current - otherAt(uv + affineMotion(uv) / uProject, row));
            translated += length(current - otherAt(uv + translation / uProject, row));
            compensated += length(current - otherAt(moved, row));
            weight += length(current - background);
        }
    }
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
    bool accepted = raw > 0.01 && compensated < raw * 0.6 && compensated < max(weight, 0.01) * 0.3;
    bool candidate = abs(globalAffine.x - globalAffine.z) > 0.03 &&
                     abs(globalAffine.z - 1.0) < 0.2;
    gl_FragColor = vec4(accepted ? 1.0 : 0.0, compensated / max(weight, 0.01), mode,
                       candidate ? 1.0 : 0.0);
}
