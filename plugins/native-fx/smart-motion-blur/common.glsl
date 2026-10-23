precision highp float;
varying vec2 vUv;
uniform vec2 uProject;
uniform float uLimit;

vec4 features(vec4 c) {
    return vec4(dot(c.rgb, vec3(0.299, 0.587, 0.114)), (c.r - c.b) * 0.5,
                (c.g - (c.r + c.b) * 0.5) * 0.5, c.a * 0.7);
}
vec2 decodeFlow(vec4 c) {
#ifdef FLOW_PACKED
    vec4 b = floor(c * 255.0 + 0.5);
    return (vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) - 32768.0) * (256.0 / 32767.0);
#else
    return c.rg;
#endif
}
vec4 encodeFlow(vec2 v) {
    float speed = length(v);
    v *= min(1.0, uLimit / max(speed, 0.000001));
#ifdef FLOW_PACKED
    vec2 c = floor(clamp(v, -256.0, 256.0) * (32767.0 / 256.0) + 32768.5);
    return vec4(floor(c.x / 256.0), mod(c.x, 256.0), floor(c.y / 256.0), mod(c.y, 256.0)) / 255.0;
#else
    return vec4(v, 0.0, 1.0);
#endif
}
// Packed bytes cannot be interpolated before decoding. This also gives both
// storage paths the same interpolation and clamp-to-edge convention.
vec2 flowAt(sampler2D tex, vec2 uv, vec2 size) {
    vec2 p = clamp(uv * size - 0.5, vec2(0.0), size - 1.0);
    vec2 b = floor(p), f = fract(p), stepUV = 1.0 / size;
    vec2 a = (b + 0.5) * stepUV;
    vec2 x = decodeFlow(texture2D(tex, a));
    vec2 y = decodeFlow(texture2D(tex, a + vec2(stepUV.x, 0.0)));
    vec2 z = decodeFlow(texture2D(tex, a + vec2(0.0, stepUV.y)));
    vec2 w = decodeFlow(texture2D(tex, a + stepUV));
    return mix(mix(x, y, f.x), mix(z, w, f.x), f.y);
}
float robust(vec4 delta) { return sqrt(dot(delta, delta) + 0.00001); }
