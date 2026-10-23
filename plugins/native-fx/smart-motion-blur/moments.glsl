uniform vec2 uSize;
uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
vec4 imageAt(vec2 uv, float row) {
    if (row < 1.0) return texture2D(uCurrent, uv);
    if (row < 2.0) return texture2D(uBefore, uv);
    return texture2D(uAfter, uv);
}
void main() {
    float column = floor(gl_FragCoord.x);
    float row = floor(gl_FragCoord.y);
    vec4 background = imageAt(vec2(0.001), row);
    float sum = 0.0;
    for (int y = 0; y < 128; y++) {
        for (int x = 0; x < 128; x++) {
            if (float(x) >= uSize.x || float(y) >= uSize.y) continue;
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / uSize;
            float weight = length(imageAt(uv, row) - background) * 0.5;
            float factor = 1.0;
            if (column > 0.5) factor = uv.x;
            if (column > 1.5) factor = uv.y;
            if (column > 2.5) factor = uv.x * uv.x;
            if (column > 3.5) factor = uv.x * uv.y;
            if (column > 4.5) factor = uv.y * uv.y;
            sum += weight * factor / (uSize.x * uSize.y);
        }
    }
    float value = floor(clamp(sum, 0.0, 1.0) * 16777215.0 + 0.5);
    gl_FragColor = vec4(floor(value / 65536.0), mod(floor(value / 256.0), 256.0),
                        mod(value, 256.0), 255.0) / 255.0;
}
