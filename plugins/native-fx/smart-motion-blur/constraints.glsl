uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uScore;
uniform vec2 uSize;
uniform float uRadius;
uniform float uOutput;
uniform sampler2D uRawCurrent;
uniform sampler2D uRawOther;
uniform vec2 uRawSize;
uniform vec2 uRawScale;

vec2 rawCenter(vec2 uv) { return (floor(uv * uRawScale * uRawSize + 0.0001) + 0.5) / uRawSize; }
vec4 currentAt(vec2 uv) { return texture2D(uRawCurrent, rawCenter(vUv) + (uv - vUv) * uRawScale); }
vec4 otherAt(vec2 uv) { return texture2D(uRawOther, rawCenter(vUv) + (uv - vUv) * uRawScale); }

float membership(vec4 color, vec4 center) {
    vec4 difference = features(color) - center;
    return 1.0 - smoothstep(0.002, 0.01, dot(difference, difference));
}
float otherMembership(vec2 uv, vec4 center) {
    vec2 rawUv = rawCenter(vUv) + (uv - vUv) * uRawScale;
    vec2 pixel = rawUv * uRawSize - 0.5;
    vec2 base = floor(pixel);
    vec2 fraction = fract(pixel);
    vec2 first = (base + 0.5) / uRawSize;
    vec2 stepUv = 1.0 / uRawSize;
    // Classify source texels before interpolation. Thresholding an already
    // interpolated color biases slow flow toward the inside of an edge.
    float topLeft = membership(texture2D(uRawOther, first), center);
    float topRight = membership(texture2D(uRawOther, first + vec2(stepUv.x, 0.0)), center);
    float bottomLeft = membership(texture2D(uRawOther, first + vec2(0.0, stepUv.y)), center);
    float bottomRight = membership(texture2D(uRawOther, first + stepUv), center);
    return mix(mix(topLeft, topRight, fraction.x), mix(bottomLeft, bottomRight, fraction.x),
               fraction.y);
}
bool uniformPatch;
float patchCost(vec2 displacement, float patchSpacing) {
    float cost = 0.0;
    vec4 center = features(currentAt(vUv));
    vec4 otherCenter = features(otherAt(vUv + displacement / uProject));
    for (int offsetY = -2; offsetY <= 2; offsetY++) {
        for (int offsetX = -2; offsetX <= 2; offsetX++) {
            vec2 uv =
                vUv + vec2(float(offsetX), float(offsetY)) * patchSpacing / (uRawSize * uRawScale);
            vec4 current = features(currentAt(uv));
            vec4 other = features(otherAt(uv + displacement / uProject));
            if (uniformPatch) {
                float currentRegion = membership(currentAt(uv), center);
                float otherRegion = otherMembership(uv + displacement / uProject, center);
                cost += abs(currentRegion - otherRegion) + 0.01 * robust(current - other);
            } else {
                // A soft census comparison measures ordering rather than a
                // color mask. Truncated color handles flat or repeated ranks.
                float currentDelta = current.r - center.r;
                float otherDelta = other.r - otherCenter.r;
                float currentRank = currentDelta / (abs(currentDelta) + 0.01);
                float otherRank = otherDelta / (abs(otherDelta) + 0.01);
                cost += 0.5 * abs(currentRank - otherRank) + min(robust(current - other), 0.12);
            }
        }
    }
    return cost / 25.0;
}
float gaussianCost(vec2 candidateMotion) {
    float cost = 0.0;
    vec4 center = features(texture2D(uCurrent, vUv));
    for (int offsetY = -2; offsetY <= 2; offsetY++)
        for (int offsetX = -2; offsetX <= 2; offsetX++) {
            vec2 uv = vUv + vec2(float(offsetX), float(offsetY)) / uSize;
            vec4 currentFeature = features(texture2D(uCurrent, uv)),
                 otherFeature = features(texture2D(uOther, uv + candidateMotion / uProject));
            float currentRegion =
                1.0 -
                smoothstep(0.002, 0.01, dot(currentFeature - center, currentFeature - center));
            float otherRegion =
                1.0 - smoothstep(0.002, 0.01, dot(otherFeature - center, otherFeature - center));
            cost += abs(currentRegion - otherRegion) + 0.01 * robust(currentFeature - otherFeature);
        }
    return cost / 25.0;
}
bool supportedMatch(vec2 displacement) {
    vec2 stepUv = 1.0 / uSize;
    vec2 point = vUv + displacement / uProject;
    float normalXX = 0.0;
    float normalXY = 0.0;
    float normalYY = 0.0;
    for (int offsetY = -2; offsetY <= 2; offsetY++) {
        for (int offsetX = -2; offsetX <= 2; offsetX++) {
            vec2 uv = point + vec2(float(offsetX), float(offsetY)) * stepUv;
            vec4 gradientX = features(texture2D(uOther, uv + vec2(stepUv.x, 0.0))) -
                             features(texture2D(uOther, uv - vec2(stepUv.x, 0.0)));
            vec4 gradientY = features(texture2D(uOther, uv + vec2(0.0, stepUv.y))) -
                             features(texture2D(uOther, uv - vec2(0.0, stepUv.y)));
            normalXX += dot(gradientX, gradientX);
            normalXY += dot(gradientX, gradientY);
            normalYY += dot(gradientY, gradientY);
        }
    }
    float trace = normalXX + normalYY;
    float eigen =
        (trace - sqrt((normalXX - normalYY) * (normalXX - normalYY) + 4.0 * normalXY * normalXY)) *
        0.5;
    return eigen > trace * 0.08;
}
float regionValue(vec2 uv, vec4 center) {
    vec4 difference = features(currentAt(uv)) - center;
    return 1.0 - smoothstep(0.002, 0.01, dot(difference, difference));
}
vec4 scoreValue(float valid, float distance) {
    float code = floor(min(distance * 8.0, 65535.0) + 0.5);
    return vec4(valid, floor(code / 256.0) / 255.0, mod(code, 256.0) / 255.0, 1.0);
}
float distanceAt(vec4 score) {
    return (floor(score.g * 255.0 + 0.5) * 256.0 + floor(score.b * 255.0 + 0.5)) / 8.0;
}
vec4 readScore(vec2 uv) {
    vec4 candidateCost = texture2D(uScore, uv);
#ifdef FLOW_PACKED
    return candidateCost;
#else
    return scoreValue(candidateCost.b, candidateCost.a);
#endif
}
vec4 fieldAndScore(vec2 flow, float valid, float distance) {
    vec4 result = encodeFlow(flow);
#ifndef FLOW_PACKED
    result.ba = vec2(valid, distance);
#endif
    return result;
}
void main() {
    // Fully transparent source texels contribute no foreground sheet.
    // Keep opaque black and textured backgrounds in the ordinary solver.
    if (texture2D(uCurrent, vUv).a < 0.000001) {
        gl_FragColor = encodeFlow(vec2(0.0));
        return;
    }
    vec2 bestMotion = decodeFlow(texture2D(uFlow, vUv));
    if (uRadius < 0.5) {
        vec2 texelSize = 1.0 / (uRawSize * uRawScale);
        float normalXX = 0.0, normalXY = 0.0, normalYY = 0.0, stationaryPatch = 0.0;
        vec4 centerFeature = features(currentAt(vUv));
        float uniformCount = 0.0;
        for (int offsetY = -2; offsetY <= 2; offsetY++) {
            for (int offsetX = -2; offsetX <= 2; offsetX++) {
                uniformCount += regionValue(vUv + vec2(float(offsetX), float(offsetY)) * texelSize,
                                            centerFeature);
            }
        }
        uniformPatch = uniformCount > 10.0;
        for (int offsetY = -1; offsetY <= 1; offsetY++) {
            for (int offsetX = -1; offsetX <= 1; offsetX++) {
                vec2 uv = vUv + vec2(float(offsetX), float(offsetY)) * texelSize;
                vec4 gradientX = features(currentAt(uv + vec2(texelSize.x, 0.0))) -
                                 features(currentAt(uv - vec2(texelSize.x, 0.0)));
                vec4 gradientY = features(currentAt(uv + vec2(0.0, texelSize.y))) -
                                 features(currentAt(uv - vec2(0.0, texelSize.y)));
                if (uniformCount > 10.0) {
                    gradientX = vec4(regionValue(uv + vec2(texelSize.x, 0.0), centerFeature) -
                                         regionValue(uv - vec2(texelSize.x, 0.0), centerFeature),
                                     0.0, 0.0, 0.0);
                    gradientY = vec4(regionValue(uv + vec2(0.0, texelSize.y), centerFeature) -
                                         regionValue(uv - vec2(0.0, texelSize.y), centerFeature),
                                     0.0, 0.0, 0.0);
                }
                normalXX += dot(gradientX, gradientX);
                normalXY += dot(gradientX, gradientY);
                normalYY += dot(gradientY, gradientY);
            }
        }
        stationaryPatch = 0.0;
        for (int patchY = -2; patchY <= 2; patchY++) {
            for (int patchX = -2; patchX <= 2; patchX++) {
                vec2 patchUv = vUv + vec2(float(patchX), float(patchY)) * texelSize;
                stationaryPatch += dot(abs(currentAt(patchUv) - otherAt(patchUv)), vec4(1.0));
            }
        }
        float eigen =
            (normalXX + normalYY -
             sqrt((normalXX - normalYY) * (normalXX - normalYY) + 4.0 * normalXY * normalXY)) /
            18.0;
        float valid = 0.0;
        if (eigen > 0.003 && stationaryPatch < 0.001) {
            bestMotion = vec2(0.0);
            valid = 1.0;
        } else if (eigen > 0.003) {
            float cost = patchCost(bestMotion, 1.0);
            // The packed score pass validates the stored vector. It does not
            // repeat the displacement search performed by the flow pass.
            if (uOutput < 0.5) {
                cost = patchCost(bestMotion, 16.0);
                for (int searchY = -8; searchY <= 8; searchY++) {
                    for (int searchX = -8; searchX <= 8; searchX++) {
                        vec2 candidate = vec2(float(searchX), float(searchY)) * 32.0 * uProject /
                                         (uRawSize * uRawScale);
                        float candidateCost = patchCost(candidate, 16.0);
                        if (candidateCost < cost - 0.000001 && length(candidate) <= uLimit) {
                            bestMotion = candidate;
                            cost = candidateCost;
                        }
                    }
                }
                cost = patchCost(bestMotion, 1.0);
                for (int step = 0; step < 8; step++) {
                    vec2 center = bestMotion;
                    float spacing = exp2(4.0 - float(step));
                    for (int offsetY = -1; offsetY <= 1; offsetY++)
                        for (int offsetX = -1; offsetX <= 1; offsetX++) {
                            vec2 candidateMotion = center + vec2(float(offsetX), float(offsetY)) *
                                                                spacing * uProject /
                                                                (uRawSize * uRawScale);
                            float candidateCost = patchCost(candidateMotion, 1.0);
                            if (candidateCost < cost - 0.000001 &&
                                length(candidateMotion) <= uLimit) {
                                bestMotion = candidateMotion;
                                cost = candidateCost;
                            }
                        }
                }
            }
            if (cost < 0.08 && supportedMatch(bestMotion)) valid = 1.0;
        }
        if (valid < 0.5) {
            vec2 gaussianStep = 1.0 / uSize;
            float gaussianXX = 0.0;
            float gaussianXY = 0.0;
            float gaussianYY = 0.0;
            for (int offsetY = -1; offsetY <= 1; offsetY++) {
                for (int offsetX = -1; offsetX <= 1; offsetX++) {
                    vec2 point = vUv + vec2(float(offsetX), float(offsetY)) * gaussianStep;
                    vec4 gradientX =
                        features(texture2D(uCurrent, point + vec2(gaussianStep.x, 0.0))) -
                        features(texture2D(uCurrent, point - vec2(gaussianStep.x, 0.0)));
                    vec4 gradientY =
                        features(texture2D(uCurrent, point + vec2(0.0, gaussianStep.y))) -
                        features(texture2D(uCurrent, point - vec2(0.0, gaussianStep.y)));
                    gaussianXX += dot(gradientX, gradientX);
                    gaussianXY += dot(gradientX, gradientY);
                    gaussianYY += dot(gradientY, gradientY);
                }
            }
            float gaussianEigen = (gaussianXX + gaussianYY -
                                   sqrt((gaussianXX - gaussianYY) * (gaussianXX - gaussianYY) +
                                        4.0 * gaussianXY * gaussianXY)) /
                                  18.0;
            if (gaussianEigen > 0.003) {
                bestMotion = decodeFlow(texture2D(uFlow, vUv));
                float cost = gaussianCost(bestMotion);
                if (uOutput < 0.5) {
                    for (int step = 0; step < 7; step++) {
                        vec2 center = bestMotion;
                        float spacing = exp2(2.0 - float(step));
                        for (int offsetY = -1; offsetY <= 1; offsetY++) {
                            for (int offsetX = -1; offsetX <= 1; offsetX++) {
                                vec2 candidate = center + vec2(float(offsetX), float(offsetY)) *
                                                              spacing * uProject / uSize;
                                float candidateCost = gaussianCost(candidate);
                                if (candidateCost < cost - 0.000001 &&
                                    length(candidate) <= uLimit) {
                                    bestMotion = candidate;
                                    cost = candidateCost;
                                }
                            }
                        }
                    }
                }
                if (cost < 0.08 && supportedMatch(bestMotion)) valid = 0.5;
            }
        }
        gl_FragColor =
            uOutput > 0.5 ? scoreValue(valid, 0.0) : fieldAndScore(bestMotion, valid, 0.0);
        return;
    }
}
