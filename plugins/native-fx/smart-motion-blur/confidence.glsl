uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uReverse;
uniform vec2 uSize;
uniform float uDelta;
void main() {
    vec2 motion = decodeFlow(texture2D(uFlow, vUv));
    vec2 warpedUv = vUv + motion / uProject;
    vec2 reverseMotion = flowAt(uReverse, warpedUv, uSize);
    float consistencyError = length(motion + reverseMotion) / uDelta;
    float colorResidual =
        robust(features(texture2D(uCurrent, vUv)) - features(texture2D(uOther, warpedUv)));
    float threshold = 2.0 + 0.05 * length(motion) / uDelta;
    float confidence = exp(-consistencyError / threshold - colorResidual * 3.0);
    float inconsistent = consistencyError > threshold ? 1.0 : 0.0;
    if (warpedUv.x < 0.0 || warpedUv.y < 0.0 || warpedUv.x > 1.0 || warpedUv.y > 1.0) {
        confidence = 0.0;
        inconsistent = 1.0;
    }
    // Reduction averages residual/inconsistency, and takes maximum speed.
    gl_FragColor =
        vec4(colorResidual, inconsistent,
             confidence > 0.5 ? min(1.0, length(motion) / uDelta / 256.0) : 0.0, confidence);
}
