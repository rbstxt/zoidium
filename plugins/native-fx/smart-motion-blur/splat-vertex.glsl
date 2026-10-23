void main() {
    vUv = position.xy;
    vec4 center = features(texture2D(uImage, (vUv + otherA + otherB) * uScale / 3.0));
    vec2 motion = guidedMotion(vUv, center);
    vec2 first = guidedMotion(otherA, center);
    vec2 second = guidedMotion(otherB, center);
    vec2 ratio = uProcessing / uProject;
    float jump = max(length((motion - first) * ratio),
                     max(length((motion - second) * ratio), length((first - second) * ratio)));
    vec2 destination = vUv + motion * uTime / (uProject * uDelta);
    // All three vertices evaluate the same triangle test. Collapsing the
    // triangle avoids interpolating between unrelated foreground/background.
    float depth = 0.99 - min(length(motion * ratio) / abs(uDelta), 256.0) / 256.0;
    gl_Position = jump > uTear ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(destination * 2.0 - 1.0, depth, 1.0);
}
