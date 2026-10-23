uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
vec4 otherAt(vec2 uv, float row) {
    if (row < 1.5) return texture2D(uBefore, uv);
    return texture2D(uAfter, uv);
}
void main() {
    float row = floor(gl_FragCoord.x) + 1.0;
    prepareGlobal(row);
    vec4 background = texture2D(uCurrent, vec2(0.001));
    float raw = 0.0, compensated = 0.0, weight = 0.0;
    for (int y = 0; y < 64; y++) {
        for (int x = 0; x < 96; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(96.0, 64.0);
            vec4 current = texture2D(uCurrent, uv);
            vec2 moved = uv + globalMotion(uv) / uProject;
            raw += length(current - otherAt(uv, row));
            compensated += length(current - otherAt(moved, row));
            weight += length(current - background);
        }
    }
    bool accepted = raw > 0.01 && compensated < raw * 0.6 &&
                    compensated < max(weight, 0.01) * 0.08;
    gl_FragColor = vec4(accepted ? 1.0 : 0.0, compensated / max(weight, 0.01), 0.0, 1.0);
}
