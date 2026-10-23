uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform sampler2D uFlow;
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
    vec2 points[4];
    points[0] = decodeAnchor(texture2D(uNorthWest, vUv));
    points[1] = decodeAnchor(texture2D(uNorthEast, vUv));
    points[2] = decodeAnchor(texture2D(uSouthWest, vUv));
    points[3] = decodeAnchor(texture2D(uSouthEast, vUv));
    vec2 positions[4];
    vec2 motions[4];
    float weights[4];
    float total = 0.0;
    vec2 meanPosition = vec2(0.0);
    vec2 meanMotion = vec2(0.0);
    for (int index = 0; index < 4; index++) {
        vec2 point = points[index];
        vec2 position = (point + 0.5 - vUv * uSize) / 128.0;
        float weight = point.x < 0.0 ? 0.0 : 1.0 / (0.25 + dot(position, position));
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
    float xx = 0.0, xy = 0.0, yy = 0.0;
    vec2 rhsX = vec2(0.0), rhsY = vec2(0.0);
    for (int index = 0; index < 4; index++) {
        vec2 position = positions[index] - meanPosition;
        vec2 motion = motions[index] - meanMotion;
        float weight = weights[index];
        xx += weight * position.x * position.x;
        xy += weight * position.x * position.y;
        yy += weight * position.y * position.y;
        rhsX += weight * position.x * motion;
        rhsY += weight * position.y * motion;
    }
    float determinant = xx * yy - xy * xy;
    vec2 result = meanMotion;
    if (determinant > 0.00001 * (xx + yy) * (xx + yy)) {
        // Centering the normal equations keeps an affine fit well conditioned.
        vec2 slopeX = (yy * rhsX - xy * rhsY) / determinant;
        vec2 slopeY = (xx * rhsY - xy * rhsX) / determinant;
        result -= slopeX * meanPosition.x + slopeY * meanPosition.y;
    } else if (xx + yy > 0.00001) {
        // Two constraints still determine a similarity transform. This avoids
        // translation-only extrapolation near the edge of the constraint hull.
        float scale = (rhsX.x + rhsY.y) / (xx + yy);
        float rotation = (rhsX.y - rhsY.x) / (xx + yy);
        result -= vec2(scale * meanPosition.x - rotation * meanPosition.y,
                       rotation * meanPosition.x + scale * meanPosition.y);
    }
    gl_FragColor = encodeFlow(result);
}
