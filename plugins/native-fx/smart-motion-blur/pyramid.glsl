uniform sampler2D uImage;
uniform vec2 uScale;
uniform vec2 uSourceSize;
void main() {
    // A separable 1,2,1 Gaussian, evaluated in one pass. Source texel centers
    // remain inside the active region even when its allocation is larger.
    vec4 sum = vec4(0.0);
    vec2 minimumUv = 0.5 / uSourceSize, maximumUv = uScale - minimumUv;
    for (int offsetY = -1; offsetY <= 1; offsetY++) {
        for (int offsetX = -1; offsetX <= 1; offsetX++) {
            float weight = (offsetX == 0 ? 2.0 : 1.0) * (offsetY == 0 ? 2.0 : 1.0);
            sum += texture2D(uImage, clamp(vUv * uScale +
                                               vec2(float(offsetX), float(offsetY)) / uSourceSize,
                                           minimumUv, maximumUv)) *
                   weight;
        }
    }
    gl_FragColor = sum / 16.0;
}
