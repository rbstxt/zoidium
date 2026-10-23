uniform sampler2D uImage;
uniform float uWeight;
void main() { gl_FragColor = texture2D(uImage, vUv) * uWeight; }
