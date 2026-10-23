uniform sampler2D uImage;
uniform vec2 uScale;
void main() {
    gl_FragColor = texture2D(uImage, vUv * uScale);
    if (gl_FragColor.a < 0.000001) discard;
}
