uniform float uHasHomography;
uniform sampler2D uTranslation;
uniform vec2 uScale;
uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
vec4 otherAt(vec2 uv, float row) {
    return row < 1.5 ? texture2D(uBefore, uv * uScale) : texture2D(uAfter, uv * uScale);
}
void main() {
    float metric = floor(gl_FragCoord.x / 8.0);
    float row = floor(gl_FragCoord.y / 8.0) + 1.0;
    vec2 tile = mod(floor(gl_FragCoord.xy), 8.0);
    prepareGlobal(row);
    vec4 background = texture2D(uCurrent, vec2(0.001) * uScale);
    vec2 translation = decodeFlow(texture2D(uTranslation, vec2((row - 0.5) / 2.0, 0.5)));
    // Hoist the eight coefficient reads out of the pixel loop.
    vec3 a = vec3(coefficient(0.0, row - 1.0), coefficient(1.0, row - 1.0), coefficient(4.0, row - 1.0));
    vec3 b = vec3(coefficient(2.0, row - 1.0), coefficient(3.0, row - 1.0), coefficient(5.0, row - 1.0));
    vec2 perspective = vec2(coefficient(6.0, row - 1.0), coefficient(7.0, row - 1.0));
    float sum = 0.0;
    for (int y = 0; y < 12; y++) {
        for (int x = 0; x < 16; x++) {
            vec2 pixel = tile * vec2(16.0, 12.0) + vec2(float(x), float(y));
            vec2 uv = (pixel + 0.5) / vec2(128.0, 96.0);
            vec4 current = texture2D(uCurrent, uv * uScale);
            if (metric > 5.5) {
                bool edge = pixel.x < 1.0 || pixel.x > 126.0 || pixel.y < 1.0 || pixel.y > 94.0;
                if (edge) sum += length(current - background) / 384.0;
            } else if (metric > 4.5) sum += length(current - background) / 384.0;
            else {
                vec2 moved = uv;
                if (metric > 3.5 && uHasHomography > 0.5) {
                    vec2 point = (uv - 0.5) * uProject / 128.0;
                    moved = vec2(dot(a, vec3(point, 1.0)), dot(b, vec3(point, 1.0))) /
                            (1.0 + dot(perspective, point));
                    moved = moved * 128.0 / uProject + 0.5;
                } else if (metric > 2.5) moved += translation / uProject;
                else if (metric > 1.5) moved += affineMotion(uv) / uProject;
                else if (metric > 0.5) moved += globalMotion(uv) / uProject;
                sum += length(current - otherAt(moved, row)) / 384.0;
            }
        }
    }
    gl_FragColor = packStatistic(sum);
}
