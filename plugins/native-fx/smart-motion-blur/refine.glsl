uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uWarp;
uniform vec2 uSize;
uniform float uSmoothness;

void main() {
    vec2 e = 1.0 / uSize;
    vec4 a = features(texture2D(uCurrent, vUv));
    vec2 sum = vec2(0.0);
    float weights = 0.0;
    for (int axis = 0; axis < 4; axis++) {
        vec2 off = axis == 0   ? vec2(e.x, 0.0)
                   : axis == 1 ? vec2(-e.x, 0.0)
                   : axis == 2 ? vec2(0.0, e.y)
                               : vec2(0.0, -e.y);
        vec4 c = features(texture2D(uCurrent, vUv + off));
        float w = exp(-dot(a - c, a - c) * 60.0) + 0.00001;
        sum += decodeFlow(texture2D(uFlow, vUv + off)) * w;
        weights += w;
    }
    vec2 mean = sum / weights * uSize / uProject;
    vec2 base = decodeFlow(texture2D(uWarp, vUv)) * uSize / uProject;
    vec2 q = vUv + base / uSize;
    vec4 b = features(texture2D(uOther, q));
    vec4 gx = 0.5 * (features(texture2D(uOther, q + vec2(e.x, 0.0))) -
                     features(texture2D(uOther, q - vec2(e.x, 0.0))));
    vec4 gy = 0.5 * (features(texture2D(uOther, q + vec2(0.0, e.y))) -
                     features(texture2D(uOther, q - vec2(0.0, e.y))));
    vec4 residual = b - a + gx * (mean.x - base.x) + gy * (mean.y - base.y);
    vec4 w = inversesqrt(residual * residual + vec4(0.0001));
    float lambda = 0.02 + uSmoothness * 0.18;
    float xx = dot(w * gx, gx) + lambda, yy = dot(w * gy, gy) + lambda, xy = dot(w * gx, gy);
    vec2 rhs = vec2(dot(w * gx, residual), dot(w * gy, residual));
    float det = max(xx * yy - xy * xy, 0.000001);
    vec2 correction = vec2(yy * rhs.x - xy * rhs.y, xx * rhs.y - xy * rhs.x) / det;
    vec2 result = mean - clamp(correction, -1.0, 1.0);
    gl_FragColor = encodeFlow(result * uProject / uSize);
}
