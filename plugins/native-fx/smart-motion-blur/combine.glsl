uniform sampler2D uFirst;
uniform sampler2D uSecond;
uniform sampler2D uThird;
uniform sampler2D uFourth;
uniform float uFirstWeight;
uniform float uSecondWeight;
uniform float uThirdWeight;
uniform float uFourthWeight;
void main() {
    gl_FragColor = texture2D(uFirst, vUv) * uFirstWeight +
                   texture2D(uSecond, vUv) * uSecondWeight +
                   texture2D(uThird, vUv) * uThirdWeight +
                   texture2D(uFourth, vUv) * uFourthWeight;
}
