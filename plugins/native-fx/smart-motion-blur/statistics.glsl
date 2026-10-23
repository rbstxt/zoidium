// Normalized statistics use the same 24-bit fixed-point format on both paths.
float unpackStatistic(vec4 value) {
    vec3 bytes = floor(value.rgb * 255.0 + 0.5);
    return dot(bytes, vec3(65536.0, 256.0, 1.0)) / 16777215.0;
}
vec4 packStatistic(float value) {
    // The rounded upper endpoint can become 2^24 in float32. Clamp the integer
    // before byte extraction so a full tile remains exactly one.
    float code = min(floor(clamp(value, 0.0, 1.0) * 16777215.0 + 0.5), 16777215.0);
    return vec4(floor(code / 65536.0), mod(floor(code / 256.0), 256.0), mod(code, 256.0), 255.0) / 255.0;
}
