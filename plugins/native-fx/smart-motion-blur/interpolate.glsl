uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform sampler2D uScore;
uniform sampler2D uNorthWest;
uniform sampler2D uNorthEast;
uniform sampler2D uSouthWest;
uniform sampler2D uSouthEast;
uniform vec2 uSize;

vec2 decodeAnchor(vec4 value) {
    vec4 bytes = floor(value * 255.0 + 0.5);
    return vec2(bytes.r * 256.0 + bytes.g, bytes.b * 256.0 + bytes.a) - 1.0;
}
void main() {
    // Fully transparent source texels contribute no foreground sheet.
    // Keep opaque black and textured backgrounds in the ordinary solver.
    if (texture2D(uCurrent, vUv).a < 0.000001) {
        gl_FragColor = encodeFlow(vec2(0.0));
        return;
    }
    vec2 points[4];
    points[0] = decodeAnchor(texture2D(uNorthWest, vUv));
    points[1] = decodeAnchor(texture2D(uNorthEast, vUv));
    points[2] = decodeAnchor(texture2D(uSouthWest, vUv));
    points[3] = decodeAnchor(texture2D(uSouthEast, vUv));
    float priority[4];
    float bestPriority = 0.0;
    for (int index = 0; index < 4; index++) {
#ifdef FLOW_PACKED
        priority[index] = texture2D(uScore, (points[index] + 0.5) / uSize).r;
#else
        priority[index] = texture2D(uFlow, (points[index] + 0.5) / uSize).b;
#endif
        if (points[index].x < 0.0) priority[index] = 0.0;
        bestPriority = max(bestPriority, priority[index]);
    }
    vec2 positions[4];
    vec2 motions[4];
    float weights[4];
    float total = 0.0;
    vec2 meanPosition = vec2(0.0);
    vec2 meanMotion = vec2(0.0);
    for (int index = 0; index < 4; index++) {
        vec2 point = points[index];
        vec2 position = (point + 0.5 - vUv * uSize) / 128.0;
        float weight = point.x < 0.0 || priority[index] < bestPriority - 0.1
                           ? 0.0
                           : 1.0 / (0.25 + dot(position, position));
        vec2 motion = decodeFlow(texture2D(uFlow, (point + 0.5) / uSize));
        positions[index] = position;
        motions[index] = motion;
        weights[index] = weight;
        total += weight;
        meanPosition += position * weight;
        meanMotion += motion * weight;
    }
    if (total < 0.00001) {
        gl_FragColor = encodeFlow(decodeFlow(texture2D(uFlow, vUv)));
        return;
    }
    meanPosition /= total;
    meanMotion /= total;
    float normalXX = 0.0, normalXY = 0.0, normalYY = 0.0;
    vec2 rightHandSideX = vec2(0.0), rightHandSideY = vec2(0.0);
    for (int index = 0; index < 4; index++) {
        vec2 position = positions[index] - meanPosition;
        vec2 motion = motions[index] - meanMotion;
        float weight = weights[index];
        normalXX += weight * position.x * position.x;
        normalXY += weight * position.x * position.y;
        normalYY += weight * position.y * position.y;
        rightHandSideX += weight * position.x * motion;
        rightHandSideY += weight * position.y * motion;
    }
    float determinant = normalXX * normalYY - normalXY * normalXY;
    vec2 result = meanMotion;
    if (determinant > 0.00001 * (normalXX + normalYY) * (normalXX + normalYY) &&
        min(normalXX, normalYY) > 0.002 * total) {
        // Centering the normal equations keeps an affine fit well conditioned.
        vec2 slopeX = (normalYY * rightHandSideX - normalXY * rightHandSideY) / determinant;
        vec2 slopeY = (normalXX * rightHandSideY - normalXY * rightHandSideX) / determinant;
        result -= slopeX * meanPosition.x + slopeY * meanPosition.y;
    } else if (normalXX + normalYY > 0.002 * total) {
        // Two constraints still determine a similarity transform. This avoids
        // translation-only extrapolation near the edge of the constraint hull.
        float scale = (rightHandSideX.x + rightHandSideY.y) / (normalXX + normalYY);
        float rotation = (rightHandSideX.y - rightHandSideY.x) / (normalXX + normalYY);
        result -= vec2(scale * meanPosition.x - rotation * meanPosition.y,
                       rotation * meanPosition.x + scale * meanPosition.y);
    }
    gl_FragColor = encodeFlow(result);
}
