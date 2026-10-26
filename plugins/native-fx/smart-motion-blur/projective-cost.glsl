uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2 uSize;
uniform float uAxis;
uniform float uRadius;
void main() {
    float candidate = floor(gl_FragCoord.x / 8.0);
    float row = floor(gl_FragCoord.y / 8.0);
    vec2 tile = mod(floor(gl_FragCoord.xy), 8.0);
    if (any(greaterThanEqual(tile * 16.0, uSize))) {
        gl_FragColor = packStatistic(0.0);
        return;
    }
    float parameters[8];
    for (int index = 0; index < 8; index++) {
        float delta = abs(float(index) - uAxis) < 0.1 ? uRadius : 0.0;
        float sign = candidate < 0.5 ? 0.0 : candidate < 1.5 ? -1.0 : 1.0;
        parameters[index] = coefficient(float(index), row) + sign * delta;
    }
    float sum = 0.0;
    // A fragment evaluates one candidate on at most 256 guide pixels.
    for (int y = 0; y < 16; y++) {
        for (int x = 0; x < 16; x++) {
            vec2 pixel = tile * 16.0 + vec2(float(x), float(y));
            if (pixel.x >= uSize.x || pixel.y >= uSize.y) continue;
            vec2 uv = (pixel + 0.5) / uSize;
            vec2 point = (uv - 0.5) * uProject / 128.0;
            vec2 moved = vec2(parameters[0] * point.x + parameters[1] * point.y + parameters[4],
                              parameters[2] * point.x + parameters[3] * point.y + parameters[5]);
            moved /= 1.0 + parameters[6] * point.x + parameters[7] * point.y;
            vec2 target = moved * 128.0 / uProject + 0.5;
            vec4 other = row < 0.5 ? texture2D(uBefore, target) : texture2D(uAfter, target);
            sum += length(texture2D(uCurrent, uv) - other) / 512.0;
        }
    }
    gl_FragColor = packStatistic(sum);
}
