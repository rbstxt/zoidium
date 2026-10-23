uniform sampler2D uImage;
uniform sampler2D uOther;
uniform sampler2D uFlow;
uniform vec2 uFlowSize;
uniform vec2 uScale;
void main() {
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
