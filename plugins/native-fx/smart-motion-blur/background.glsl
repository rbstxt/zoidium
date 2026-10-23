uniform sampler2D uImage;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform vec2 uFlowSize;
uniform vec2 uScale;
uniform sampler2D uRegistered;
uniform float uDirection;
uniform float uTime;
uniform float uDelta;
void main() {
    if (texture2D(uRegistered, vec2((uDirection + 0.5) / 2.0, 0.5)).r > 0.5) {
        // A validated whole-image transform moves the entire foreground. Its
        // uncovered base is the border observation, not an unwarped ghost of
        // the current foreground.
        vec4 border = texture2D(uImage, vec2(0.00001));
        vec2 motion = flowAt(uFlow, vUv, uFlowSize) / uDelta;
        gl_FragColor = border.a < 0.01
                           ? border
                           : texture2D(uOther, (vUv + motion * (1.0 - uTime) / uProject) * uScale);
        return;
    }
    vec4 current = texture2D(uImage, vUv * uScale);
    vec4 other = texture2D(uOther, vUv * uScale);
    float speed = length(flowAt(uFlow, vUv, uFlowSize));
    // In a vacated region, prefer the less opaque/lower-energy observation.
    // This is a background heuristic, not a depth estimate. Static pixels use
    // the current image exactly. The displaced mesh draws over this base.
    float currentEnergy = dot(current.rgb, vec3(0.333333)) + current.a;
    float otherEnergy = dot(other.rgb, vec3(0.333333)) + other.a;
    gl_FragColor = speed > 0.5 && otherEnergy < currentEnergy ? other : current;
}
