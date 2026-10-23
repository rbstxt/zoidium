attribute vec2 otherA;
attribute vec2 otherB;
uniform sampler2D uFlow;
uniform vec2 uFlowSize;
uniform vec2 uProcessing;
uniform float uTime;
uniform float uDelta;
uniform float uTear;
void main() {
    vUv = position.xy;
    vec2 motion = flowAt(uFlow, vUv, uFlowSize);
    vec2 first = flowAt(uFlow, otherA, uFlowSize);
    vec2 second = flowAt(uFlow, otherB, uFlowSize);
    vec2 ratio = uProcessing / uProject;
    float jump = max(length((motion - first) * ratio),
                     max(length((motion - second) * ratio), length((first - second) * ratio)));
    vec2 destination = vUv + motion * uTime / (uProject * uDelta);
    // All three vertices evaluate the same triangle test. Collapsing the
    // triangle avoids interpolating between unrelated foreground/background.
    gl_Position = jump > uTear ? vec4(2.0, 2.0, 0.0, 1.0)
                              : vec4(destination * 2.0 - 1.0, 0.0, 1.0);
}
