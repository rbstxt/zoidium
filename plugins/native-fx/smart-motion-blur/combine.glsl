uniform sampler2D uFirst;
uniform sampler2D uSecond;
uniform sampler2D uThird;
uniform sampler2D uFourth;
uniform float uFirstWeight;
uniform float uSecondWeight;
uniform float uThirdWeight;
uniform float uFourthWeight;
uniform sampler2D uImage;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform vec2 uScale;
uniform vec2 uProcessing;
void main() {
    vec4 current = texture2D(uImage, vUv * uScale);
    vec4 delta = max(abs(current - texture2D(uBefore, vUv * uScale)),
                     abs(current - texture2D(uAfter, vUv * uScale)));
    if (dot(delta, vec4(1.0)) < 0.00001) {
        vec2 texel = uScale / uProcessing;
        float equal = 0.0;
        equal +=
            step(length(current - texture2D(uImage, vUv * uScale + vec2(texel.x, 0.0))), 0.004);
        equal +=
            step(length(current - texture2D(uImage, vUv * uScale - vec2(texel.x, 0.0))), 0.004);
        equal +=
            step(length(current - texture2D(uImage, vUv * uScale + vec2(0.0, texel.y))), 0.004);
        equal +=
            step(length(current - texture2D(uImage, vUv * uScale - vec2(0.0, texel.y))), 0.004);
        // An unchanged textured background has no shutter contribution from
        // this motion. Preserve its original code values after accumulation.
        if (equal < 2.0 && current.a > 0.99) {
            gl_FragColor = current;
            return;
        }
    }
    gl_FragColor = texture2D(uFirst, vUv) * uFirstWeight + texture2D(uSecond, vUv) * uSecondWeight +
                   texture2D(uThird, vUv) * uThirdWeight + texture2D(uFourth, vUv) * uFourthWeight;
}
