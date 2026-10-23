uniform sampler2D uImage;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform sampler2D uPrevious;
uniform sampler2D uNext;
uniform sampler2D uPreviousMax;
uniform sampler2D uNextMax;
uniform sampler2D uPreviousConfidence;
uniform sampler2D uNextConfidence;
uniform sampler2D uGuide;
uniform vec2 uScale;
uniform vec2 uFlowSize;
uniform vec2 uProcessing;
uniform vec2 uTileSize;
uniform vec2 uDeltas;
uniform float uAmount;
uniform int uSamples;
uniform int uView;

vec4 colorAt(vec2 uv) {
    vec2 lo = 0.5 * uScale / uProcessing;
    return texture2D(uImage, clamp(uv * uScale, lo, uScale - lo));
}
vec2 velocity(sampler2D field, vec2 uv, float delta, float signValue) {
    vec4 original = colorAt(uv);
    if (original.a < 0.000001) return vec2(0.0);
    vec4 previousDifference = abs(original - texture2D(uBefore, uv * uScale));
    vec4 nextDifference = abs(original - texture2D(uAfter, uv * uScale));
    float stationary = min(dot(previousDifference, vec4(1.0)), dot(nextDifference, vec4(1.0)));
    vec2 texel = 1.0 / uProcessing;
    vec4 horizontalPositive = abs(colorAt(uv + vec2(texel.x, 0.0)) - original);
    vec4 horizontalNegative = abs(colorAt(uv - vec2(texel.x, 0.0)) - original);
    vec4 verticalPositive = abs(colorAt(uv + vec2(0.0, texel.y)) - original);
    vec4 verticalNegative = abs(colorAt(uv - vec2(0.0, texel.y)) - original);
    float equalNeighbors = step(dot(horizontalPositive, vec4(1.0)), 0.004) +
                           step(dot(horizontalNegative, vec4(1.0)), 0.004) +
                           step(dot(verticalPositive, vec4(1.0)), 0.004) +
                           step(dot(verticalNegative, vec4(1.0)), 0.004);
    vec4 variation = horizontalPositive + horizontalNegative + verticalPositive + verticalNegative;
    if (stationary < 0.001 && equalNeighbors < 2.0 && dot(variation, vec4(1.0)) > 0.02)
        return vec2(0.0);
    // Joint bilateral upsampling keeps a flat object's field off its background.
    vec2 pixel = uv * uFlowSize - 0.5, base = floor(pixel), fraction = fract(pixel);
    vec4 center = features(colorAt(uv));
    vec2 weightedSum = vec2(0.0);
    float totalWeight = 0.0;
    for (int sampleY = 0; sampleY < 2; sampleY++)
        for (int sampleX = 0; sampleX < 2; sampleX++) {
            vec2 guideUv = (base + vec2(float(sampleX), float(sampleY)) + 0.5) / uFlowSize;
            vec4 guideFeature = features(texture2D(uGuide, guideUv));
            float weight = (sampleX == 0 ? 1.0 - fraction.x : fraction.x) *
                           (sampleY == 0 ? 1.0 - fraction.y : fraction.y);
            weight *= exp(-dot(guideFeature - center, guideFeature - center) * 80.0) + 0.00001;
            weightedSum += decodeFlow(texture2D(field, guideUv)) * weight;
            totalWeight += weight;
        }
    vec2 result = weightedSum / max(totalWeight, 0.000001) * signValue / delta;
    return length(result) < 0.25 ? vec2(0.0) : result;
}
vec4 integrate(vec2 uv, vec2 own, float tau, sampler2D field, sampler2D maxField, sampler2D conf, float delta,
               float signValue) {
    vec2 candidate = decodeFlow(texture2D(maxField, uv));
    vec2 guideUv = uv - own * tau / uProject;
    if (length(own) > 0.25) {
        vec2 correctedMotion = velocity(field, guideUv, delta, signValue);
        if (length(correctedMotion) > 0.25) guideUv = uv - correctedMotion * tau / uProject;
    }
    vec4 result = colorAt(guideUv);
    // Neighbor-max proposes a foreground trajectory reaching this destination.
    // Verify its donor's motion before replacing the ordinary gather sample.
    vec2 donor = uv - candidate * tau / uProject;
    vec2 tracked = velocity(field, donor, delta, signValue);
    // Invert the motion at the donor, rather than assuming tile motion is
    // constant across a rotating or scaling foreground object.
    if (length(tracked) > 0.25) {
        donor = uv - tracked * tau / uProject;
        tracked = velocity(field, donor, delta, signValue);
    }
    vec2 error = (donor + tracked * tau / uProject - uv) * uProcessing;
    float confidence = texture2D(conf, donor).a;
    if (length(candidate) > 0.25 && length(error) < 1.5 &&
        dot(tracked, candidate) > 0.75 * dot(candidate, candidate) && confidence > 0.12 &&
        length(tracked) >= length(own) - 2.0) {
        result = colorAt(donor);
    }
    return result;
}
void main() {
    vec2 previous = velocity(uPrevious, vUv, uDeltas.x, -1.0);
    vec2 next = velocity(uNext, vUv, uDeltas.y, 1.0);
    if (uView == 1) {
        vec2 motion = (previous + next) * 0.5;
        gl_FragColor = vec4(0.5 + motion.x / 512.0, 0.5 + motion.y / 512.0,
                            min(1.0, length(motion) / 64.0), 1.0);
        return;
    }
    if (uView == 2) {
        float guideFeature =
            min(texture2D(uPreviousConfidence, vUv).a, texture2D(uNextConfidence, vUv).a);
        gl_FragColor = vec4(vec3(guideFeature), 1.0);
        return;
    }
    vec4 weightedSum = vec4(0.0);
    for (int sampleIndex = 0; sampleIndex < 64; sampleIndex++) {
        if (sampleIndex >= uSamples) break;
        float tau = ((float(sampleIndex) + 0.5) / float(uSamples) - 0.5) * uAmount;
        if (tau < 0.0)
            weightedSum +=
                integrate(vUv, previous, tau, uPrevious, uPreviousMax, uPreviousConfidence, uDeltas.x, -1.0);
        else
            weightedSum += integrate(vUv, next, tau, uNext, uNextMax, uNextConfidence, uDeltas.y, 1.0);
    }
    // Inputs and output are premultiplied. Never normalize RGB by alpha.
    gl_FragColor = weightedSum / float(uSamples);
}
