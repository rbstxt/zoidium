uniform sampler2D uMoments;
float moment(float column, float row) {
    vec3 bytes =
        floor(texture2D(uMoments, vec2((column + 0.5) / 6.0, (row + 0.5) / 3.0)).rgb * 255.0 + 0.5);
    return dot(bytes, vec3(65536.0, 256.0, 1.0)) / 16777215.0;
}
vec2 centroid(float row) {
    float mass = max(moment(0.0, row), 0.0000001);
    return vec2(moment(1.0, row), moment(2.0, row)) / mass;
}
vec3 covariance(float row, vec2 center) {
    float mass = max(moment(0.0, row), 0.0000001);
    return vec3(moment(3.0, row), moment(4.0, row), moment(5.0, row)) / mass -
           vec3(center.x * center.x, center.x * center.y, center.y * center.y);
}
vec2 globalCurrent, globalOther;
float globalAngle, globalScale;
vec3 globalAffine;
void prepareGlobal(float row) {
    vec2 current = centroid(0.0), other = centroid(row);
    vec3 currentCov = covariance(0.0, current), otherCov = covariance(row, other);
    // Moments use project-pixel coordinates for rotation on non-square images.
    vec3 ratio = vec3(uProject.x * uProject.x, uProject.x * uProject.y, uProject.y * uProject.y);
    currentCov *= ratio;
    otherCov *= ratio;
    float currentTrace = max(currentCov.x + currentCov.z, 0.000001);
    float otherTrace = max(otherCov.x + otherCov.z, 0.000001);
    float anisotropy = length(vec2(currentCov.x - currentCov.z, 2.0 * currentCov.y)) / currentTrace;
    float angle = 0.0;
    if (anisotropy > 0.05) {
        angle = 0.5 * (atan(2.0 * otherCov.y, otherCov.x - otherCov.z) -
                       atan(2.0 * currentCov.y, currentCov.x - currentCov.z));
        if (angle > 1.5707963)
            angle -= 3.1415927;
        if (angle < -1.5707963)
            angle += 3.1415927;
    }
    float horizontal = sqrt(max(otherCov.x, 0.000001) / max(currentCov.x, 0.000001));
    float vertical = sqrt(
        max(otherCov.z - otherCov.y * otherCov.y / max(otherCov.x, 0.000001), 0.000001) /
        max(currentCov.z - currentCov.y * currentCov.y / max(currentCov.x, 0.000001), 0.000001));
    float shear = otherCov.y / max(currentCov.x * horizontal, 0.000001) -
                  vertical * currentCov.y / max(currentCov.x, 0.000001);
    globalAffine = vec3(horizontal, shear, vertical);
    globalCurrent = current;
    globalOther = other;
    globalAngle = angle;
    globalScale = sqrt(otherTrace / currentTrace);
}
vec2 globalMotion(vec2 uv) {
    vec2 point = (uv - globalCurrent) * uProject;
    float angle = globalAngle;
    vec2 moved = vec2(cos(angle) * point.x - sin(angle) * point.y,
                      sin(angle) * point.x + cos(angle) * point.y) *
                 globalScale;
    return (globalOther - uv) * uProject + moved;
}

vec2 affineMotion(vec2 uv) {
    vec2 point = (uv - globalCurrent) * uProject;
    return (globalOther - uv) * uProject +
           vec2(globalAffine.x * point.x, globalAffine.y * point.x + globalAffine.z * point.y);
}
