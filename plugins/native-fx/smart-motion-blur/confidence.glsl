uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uReverse;
uniform vec2 uSize;
uniform float uDelta;
void main() {
    vec2 f = decodeFlow(texture2D(uFlow, vUv));
    vec2 q = vUv + f / uProject;
    vec2 reverse = flowAt(uReverse, q, uSize);
    float error = length(f + reverse) / uDelta;
    float residual = robust(features(texture2D(uCurrent, vUv)) - features(texture2D(uOther, q)));
    float threshold = 2.0 + 0.05 * length(f) / uDelta;
    float confidence = exp(-error / threshold - residual * 3.0);
    float inconsistent = error > threshold ? 1.0 : 0.0;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) {
        confidence = 0.0;
        inconsistent = 1.0;
    }
    // Reduction averages residual/inconsistency, and takes maximum speed.
    gl_FragColor = vec4(residual, inconsistent, min(1.0, length(f) / uDelta / 256.0), confidence);
}
