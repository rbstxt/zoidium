uniform sampler2D uTranslation;
uniform sampler2D uFlow;
uniform sampler2D uOpposite;
uniform sampler2D uAccepted;
uniform float uDirection;
void main() {
    vec2 point = vec2((uDirection - 0.5) / 2.0, 0.5);
    vec4 accepted = texture2D(uAccepted, point);
    if (accepted.r > 0.5 && accepted.b > 0.75) {
        gl_FragColor = texture2D(uTranslation, point);
    } else if (accepted.r > 0.5) {
        if (accepted.b > 0.125 && accepted.b < 0.375) {
            gl_FragColor = encodeFlow(projectiveMotion(vUv, uDirection - 1.0));
            return;
        }
        prepareGlobal(uDirection);
        gl_FragColor = encodeFlow(accepted.b > 0.25 ? affineMotion(vUv) : globalMotion(vUv));
    } else {
        vec2 motion = decodeFlow(texture2D(uFlow, vUv));
        vec2 opposite = decodeFlow(texture2D(uOpposite, vUv));
        // At subpixel speeds, symmetric observations cancel the opposite
        // coverage biases of the two boundary matches.
        if (max(length(motion), length(opposite)) < 4.0 && dot(motion, opposite) < 0.0)
            motion = (motion - opposite) * 0.5;
        gl_FragColor = encodeFlow(motion);
    }
}
