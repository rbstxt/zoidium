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

float patchCost(vec2 v, float patchSpacing) {
    float cost = 0.0;
    vec4 center = features(currentAt(vUv));
    for (int y = -2; y <= 2; y++)
        for (int x = -2; x <= 2; x++) {
            vec2 uv = vUv + vec2(float(x), float(y)) * patchSpacing / (uRawSize * uRawScale);
            vec4 a = features(currentAt(uv)), b = features(otherAt(uv + v / uProject));
            float ma = 1.0 - smoothstep(0.002, 0.01, dot(a - center, a - center));
            float mb = 1.0 - smoothstep(0.002, 0.01, dot(b - center, b - center));
            cost += abs(ma - mb) + 0.01 * robust(a - b);
        }
    return cost / 25.0;
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
    vec4 c = texture2D(uScore, uv);
#ifdef FLOW_PACKED
    return c;
#else
    return scoreValue(c.b, c.a);
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
    vec2 best = decodeFlow(texture2D(uFlow, vUv));
    if (uRadius < 0.5) {
        vec2 e = 1.0 / (uRawSize * uRawScale);
        float xx = 0.0, xy = 0.0, yy = 0.0, stationaryPatch = 0.0;
        vec4 centerFeature = features(currentAt(vUv));
        float uniformCount = 0.0;
        for (int y = -2; y <= 2; y++) {
            for (int x = -2; x <= 2; x++) {
                uniformCount += regionValue(vUv + vec2(float(x), float(y)) * e, centerFeature);
            }
        }
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 uv = vUv + vec2(float(x), float(y)) * e;
                vec4 gradientX = features(currentAt(uv + vec2(e.x, 0.0))) -
                                 features(currentAt(uv - vec2(e.x, 0.0)));
                vec4 gradientY = features(currentAt(uv + vec2(0.0, e.y))) -
                                 features(currentAt(uv - vec2(0.0, e.y)));
                if (uniformCount > 10.0) {
                    gradientX = vec4(regionValue(uv + vec2(e.x, 0.0), centerFeature) -
                                         regionValue(uv - vec2(e.x, 0.0), centerFeature),
                                     0.0, 0.0, 0.0);
                    gradientY = vec4(regionValue(uv + vec2(0.0, e.y), centerFeature) -
                                         regionValue(uv - vec2(0.0, e.y), centerFeature),
                                     0.0, 0.0, 0.0);
                }
                xx += dot(gradientX, gradientX);
                xy += dot(gradientX, gradientY);
                yy += dot(gradientY, gradientY);
            }
        }
        stationaryPatch = 0.0;
        for (int patchY = -2; patchY <= 2; patchY++) {
            for (int patchX = -2; patchX <= 2; patchX++) {
                vec2 patchUv = vUv + vec2(float(patchX), float(patchY)) * e;
                stationaryPatch += dot(abs(currentAt(patchUv) - otherAt(patchUv)), vec4(1.0));
            }
        }
        float eigen = (xx + yy - sqrt((xx - yy) * (xx - yy) + 4.0 * xy * xy)) / 18.0;
        float valid = 0.0;
        if (eigen > 0.003 && stationaryPatch < 0.001) {
            best = vec2(0.0);
            valid = 1.0;
        } else if (eigen > 0.003) {
            float cost = patchCost(best, 8.0);
            vec2 initial = best;
            for (int searchY = -4; searchY <= 4; searchY++) {
                for (int searchX = -4; searchX <= 4; searchX++) {
                    vec2 candidate = initial + vec2(float(searchX), float(searchY)) * 16.0 *
                                                   uProject / (uRawSize * uRawScale);
                    float candidateCost = patchCost(candidate, 8.0);
                    if (candidateCost < cost - 0.000001 && length(candidate) <= uLimit) {
                        best = candidate;
                        cost = candidateCost;
                    }
                }
            }
            cost = patchCost(best, 1.0);
            for (int step = 0; step < 7; step++) {
                vec2 center = best;
                float spacing = exp2(3.0 - float(step));
                for (int y = -1; y <= 1; y++)
                    for (int x = -1; x <= 1; x++) {
                        vec2 v = center + vec2(float(x), float(y)) * spacing * uProject /
                                              (uRawSize * uRawScale);
                        float c = patchCost(v, 1.0);
                        if (c < cost - 0.000001 && length(v) <= uLimit) {
                            best = v;
                            cost = c;
                        }
                    }
            }
            if (cost < 0.08) valid = 1.0;
        }
        gl_FragColor = uOutput > 0.5 ? scoreValue(valid, 0.0) : fieldAndScore(best, valid, 0.0);
        return;
    }
}
