uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uWarp;
uniform vec2 uSize;
uniform float uSmoothness;

void main() {
    vec2 texelSize = 1.0 / uSize;
    vec4 currentFeature = features(texture2D(uCurrent, vUv));
    vec2 weightedMotion = vec2(0.0);
    float totalWeight = 0.0;
    for (int axis = 0; axis < 4; axis++) {
        vec2 offset = axis == 0   ? vec2(texelSize.x, 0.0)
                      : axis == 1 ? vec2(-texelSize.x, 0.0)
                      : axis == 2 ? vec2(0.0, texelSize.y)
                                  : vec2(0.0, -texelSize.y);
        vec4 neighborFeature = features(texture2D(uCurrent, vUv + offset));
        float weight =
            exp(-dot(currentFeature - neighborFeature, currentFeature - neighborFeature) * 60.0) +
            0.00001;
        weightedMotion += decodeFlow(texture2D(uFlow, vUv + offset)) * weight;
        totalWeight += weight;
    }
    vec2 neighborMotion = weightedMotion / totalWeight * uSize / uProject;
    vec2 warpMotion = decodeFlow(texture2D(uWarp, vUv)) * uSize / uProject;
    vec2 warpedUv = vUv + warpMotion / uSize;
    vec4 warpedFeature = features(texture2D(uOther, warpedUv));
    vec4 gradientX = 0.5 * (features(texture2D(uOther, warpedUv + vec2(texelSize.x, 0.0))) -
                            features(texture2D(uOther, warpedUv - vec2(texelSize.x, 0.0))));
    vec4 gradientY = 0.5 * (features(texture2D(uOther, warpedUv + vec2(0.0, texelSize.y))) -
                            features(texture2D(uOther, warpedUv - vec2(0.0, texelSize.y))));
    vec4 residual = warpedFeature - currentFeature + gradientX * (neighborMotion.x - warpMotion.x) +
                    gradientY * (neighborMotion.y - warpMotion.y);
    vec4 weight = inversesqrt(residual * residual + vec4(0.0001));
    float regularization = 0.02 + uSmoothness * 0.18;
    float normalXX = dot(weight * gradientX, gradientX) + regularization,
          normalYY = dot(weight * gradientY, gradientY) + regularization,
          normalXY = dot(weight * gradientX, gradientY);
    vec2 rightHandSide = vec2(dot(weight * gradientX, residual), dot(weight * gradientY, residual));
    float determinant = max(normalXX * normalYY - normalXY * normalXY, 0.000001);
    vec2 correction = vec2(normalYY * rightHandSide.x - normalXY * rightHandSide.y,
                           normalXX * rightHandSide.y - normalXY * rightHandSide.x) /
                      determinant;
    vec2 result = neighborMotion - clamp(correction, -1.0, 1.0);
    gl_FragColor = encodeFlow(result * uProject / uSize);
}
