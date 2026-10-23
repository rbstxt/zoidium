uniform sampler2D uImage;
uniform vec2 uScale;
uniform vec2 uSourceSize;
void main() {
    // A separable 1,2,1 Gaussian, evaluated in one pass. Source texel centers
    // remain inside the active region even when its allocation is larger.
    vec4 sum = vec4(0.0);
    vec2 lo = 0.5 / uSourceSize, hi = uScale - lo;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
            sum += texture2D(uImage, clamp(vUv * uScale + vec2(float(x), float(y)) / uSourceSize, lo, hi)) * w;
        }
    }
    gl_FragColor = sum / 16.0;
}
