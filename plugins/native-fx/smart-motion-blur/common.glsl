precision highp float;
varying vec2 vUv;
uniform vec2 uProject;
uniform float uLimit;

vec4 features(vec4 color) {
    return vec4(dot(color.rgb, vec3(0.299, 0.587, 0.114)), (color.r - color.b) * 0.5,
                (color.g - (color.r + color.b) * 0.5) * 0.5, color.a * 0.7);
}
vec2 decodeFlow(vec4 color) {
#ifdef FLOW_PACKED
    vec4 bytes = floor(color * 255.0 + 0.5);
    vec2 components = vec2(bytes.r * 256.0 + bytes.g, bytes.b * 256.0 + bytes.a);
    return (components - 32768.0) * (256.0 / 32767.0);
#else
    return color.rg;
#endif
}
vec4 encodeFlow(vec2 motion) {
    float speed = length(motion);
    motion *= min(1.0, uLimit / max(speed, 0.000001));
#ifdef FLOW_PACKED
    vec2 components = floor(clamp(motion, -256.0, 256.0) * (32767.0 / 256.0) + 32768.5);
    return vec4(floor(components.x / 256.0), mod(components.x, 256.0), floor(components.y / 256.0),
                mod(components.y, 256.0)) /
           255.0;
#else
    return vec4(motion, 0.0, 1.0);
#endif
}
// Decode before interpolation, so packed bytes and half-float values use
// the same bilinear weights and clamp-to-edge convention.
vec2 flowAt(sampler2D field, vec2 uv, vec2 size) {
    vec2 pixel = clamp(uv * size - 0.5, vec2(0.0), size - 1.0);
    vec2 base = floor(pixel);
    vec2 fraction = fract(pixel);
    vec2 texel = 1.0 / size;
    vec2 first = (base + 0.5) * texel;
    vec2 topLeft = decodeFlow(texture2D(field, first));
    vec2 topRight = decodeFlow(texture2D(field, first + vec2(texel.x, 0.0)));
    vec2 bottomLeft = decodeFlow(texture2D(field, first + vec2(0.0, texel.y)));
    vec2 bottomRight = decodeFlow(texture2D(field, first + texel));
    return mix(mix(topLeft, topRight, fraction.x), mix(bottomLeft, bottomRight, fraction.x),
               fraction.y);
}
float robust(vec4 difference) { return sqrt(dot(difference, difference) + 0.00001); }
