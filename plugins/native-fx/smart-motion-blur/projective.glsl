uniform sampler2D uHomography;
float coefficient(float column, float row) {
    vec3 bytes = floor(texture2D(uHomography, vec2((column + 0.5) / 8.0, (row + 0.5) / 2.0)).rgb * 255.0 + 0.5);
    return dot(bytes, vec3(65536.0, 256.0, 1.0)) * (8.0 / 16777215.0) - 4.0;
}
vec4 encodeCoefficient(float value) {
    float code = min(floor(clamp((value + 4.0) / 8.0, 0.0, 1.0) * 16777215.0 + 0.5), 16777215.0);
    return vec4(floor(code / 65536.0), mod(floor(code / 256.0), 256.0), mod(code, 256.0), 255.0) / 255.0;
}
vec2 projectiveMotion(vec2 uv, float row) {
    vec2 point = (uv - 0.5) * uProject / 128.0;
    vec2 moved = vec2(coefficient(0.0, row) * point.x + coefficient(1.0, row) * point.y + coefficient(4.0, row),
                      coefficient(2.0, row) * point.x + coefficient(3.0, row) * point.y + coefficient(5.0, row));
    moved /= 1.0 + coefficient(6.0, row) * point.x + coefficient(7.0, row) * point.y;
    return (moved - point) * 128.0;
}
