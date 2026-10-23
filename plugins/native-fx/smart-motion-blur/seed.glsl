uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform vec2 uSize;
uniform vec2 uFlowSize;
uniform float uCoarse;
uniform float uStep;

vec4 currentFeatures[25];
float currentWeights[25];
vec2 currentGradient;
float cost(vec2 velocity) {
    vec2 displacementUv = velocity / uProject;
    float totalCost = 0.0, totalWeight = 0.0;
    for (int offsetY = -2; offsetY <= 2; offsetY++) {
        for (int offsetX = -2; offsetX <= 2; offsetX++) {
            if (uCoarse < 0.5 && uStep >= 1.0 &&
                (abs(float(offsetX)) > 1.0 || abs(float(offsetY)) > 1.0))
                continue;
            vec2 patchUv = vUv + vec2(float(offsetX), float(offsetY)) / uSize;
            int index = (offsetY + 2) * 5 + offsetX + 2;
            vec4 currentFeature = currentFeatures[index];
            vec4 otherFeature = features(texture2D(uOther, patchUv + displacementUv));
            float weight = currentWeights[index];
            totalCost += robust(currentFeature - otherFeature) * weight;
            totalWeight += weight;
        }
    }
    // Luma gradient constancy adds edge orientation without dropping chroma
    // or alpha information from the patch term.
    vec2 horizontalTexel = vec2(1.0 / uSize.x, 0.0), verticalTexel = vec2(0.0, 1.0 / uSize.y);
    vec2 otherGradient =
        vec2(features(texture2D(uOther, vUv + displacementUv + horizontalTexel)).r -
                 features(texture2D(uOther, vUv + displacementUv - horizontalTexel)).r,
             features(texture2D(uOther, vUv + displacementUv + verticalTexel)).r -
                 features(texture2D(uOther, vUv + displacementUv - verticalTexel)).r);
    return totalCost / totalWeight + 0.1 * length(currentGradient - otherGradient);
}
void main() {
    // Fully transparent source texels contribute no foreground sheet.
    // Keep opaque black and textured backgrounds in the ordinary solver.
    float support = 0.0;
    for (int y = -2; y <= 2; y++)
        for (int x = -2; x <= 2; x++)
            support += texture2D(uCurrent, vUv + vec2(float(x), float(y)) / uSize).a;
    if (support < 0.000001) {
        gl_FragColor = encodeFlow(vec2(0.0));
        return;
    }
    // Cache the invariant side of every patch cost. Even the 83 coarse
    // candidates now need fewer than 2500 texture samples per fragment.
    vec4 center = features(texture2D(uCurrent, vUv));
    for (int y = -2; y <= 2; y++)
        for (int x = -2; x <= 2; x++) {
            int index = (y + 2) * 5 + x + 2;
            vec4 value = features(texture2D(uCurrent, vUv + vec2(float(x), float(y)) / uSize));
            currentFeatures[index] = value;
            currentWeights[index] = 0.1 + 0.9 * exp(-dot(value - center, value - center) * 12.0);
        }
    vec2 horizontalTexel = vec2(1.0 / uSize.x, 0.0), verticalTexel = vec2(0.0, 1.0 / uSize.y);
    currentGradient = vec2(features(texture2D(uCurrent, vUv + horizontalTexel)).r -
                                    features(texture2D(uCurrent, vUv - horizontalTexel)).r,
                                features(texture2D(uCurrent, vUv + verticalTexel)).r -
                                    features(texture2D(uCurrent, vUv - verticalTexel)).r);
    vec2 base = vec2(0.0);
    if (uCoarse < 0.5) base = flowAt(uFlow, vUv, uFlowSize);
    vec2 bestMotion = base;
    float bestCost = cost(bestMotion);
    float zeroCost = cost(vec2(0.0));
    if (zeroCost < bestCost - 0.000001) {
        bestMotion = vec2(0.0);
        bestCost = zeroCost;
    }
    // Constant loop bounds are required by GLSL ES 1.00. Fine levels evaluate
    // only the central 3x3 candidates.
    for (int offsetY = -4; offsetY <= 4; offsetY++) {
        for (int offsetX = -4; offsetX <= 4; offsetX++) {
            if (uCoarse < 0.5 && (abs(float(offsetX)) > 1.0 || abs(float(offsetY)) > 1.0)) continue;
            vec2 candidateMotion =
                base + vec2(float(offsetX), float(offsetY)) * uStep * uProject / uSize;
            if (length(candidateMotion) > uLimit) continue;
            float candidateCost = cost(candidateMotion);
            if (candidateCost < bestCost - 0.000001 ||
                (uCoarse > 0.5 && abs(candidateCost - bestCost) <= 0.000001 &&
                 dot(candidateMotion, candidateMotion) < dot(bestMotion, bestMotion))) {
                bestMotion = candidateMotion;
                bestCost = candidateCost;
            }
        }
    }
    gl_FragColor = encodeFlow(bestMotion);
}
