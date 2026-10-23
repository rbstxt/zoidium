uniform sampler2D uFlow;
uniform sampler2D uAccepted;
uniform float uDirection;
void main() {
    if (texture2D(uAccepted, vec2((uDirection - 0.5) / 2.0, 0.5)).r > 0.5) {
        prepareGlobal(uDirection);
        gl_FragColor = encodeFlow(globalMotion(vUv));
    } else {
        gl_FragColor = texture2D(uFlow, vUv);
    }
}
