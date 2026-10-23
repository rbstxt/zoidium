uniform sampler2D uTranslation;
uniform sampler2D uFlow;
uniform sampler2D uAccepted;
uniform float uDirection;
void main() {
    vec2 point = vec2((uDirection - 0.5) / 2.0, 0.5);
    vec4 accepted = texture2D(uAccepted, point);
    if (accepted.r > 0.5 && accepted.b > 0.75) {
        gl_FragColor = texture2D(uTranslation, point);
    } else if (accepted.r > 0.5) {
        prepareGlobal(uDirection);
        gl_FragColor = encodeFlow(accepted.b > 0.25 ? affineMotion(vUv) : globalMotion(vUv));
    } else {
        gl_FragColor = texture2D(uFlow, vUv);
    }
}
