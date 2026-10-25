uniform sampler2D uFirst;
uniform sampler2D uSecond;
uniform sampler2D uThird;
uniform sampler2D uFourth;
uniform sampler2D uFifth;
uniform sampler2D uSixth;
uniform sampler2D uSeventh;
uniform sampler2D uEighth;
uniform vec2 uScale;
void main() {
    // Eight equal taps fit WebGL1's minimum texture-unit count. Each level
    // rounds once, rather than rounding every step of an incremental mean.
    vec2 uv = vUv * uScale;
    gl_FragColor = (texture2D(uFirst, uv) + texture2D(uSecond, uv) +
                   texture2D(uThird, uv) + texture2D(uFourth, uv) +
                   texture2D(uFifth, uv) + texture2D(uSixth, uv) +
                   texture2D(uSeventh, uv) + texture2D(uEighth, uv)) * 0.125;
}
