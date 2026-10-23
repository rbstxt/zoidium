uniform sampler2D uFirst;
uniform sampler2D uSecond;
uniform sampler2D uThird;
uniform sampler2D uFourth;
void main() {
    gl_FragColor = (texture2D(uFirst, vUv) + texture2D(uSecond, vUv) +
                    texture2D(uThird, vUv) + texture2D(uFourth, vUv)) * 0.25;
}
