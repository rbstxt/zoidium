uniform float uSourceOnly;
uniform sampler2D uCurrent;
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform sampler2D uPreviousConfidence;
uniform sampler2D uNextConfidence;
uniform vec2 uSourceSize;
uniform vec2 uActiveSize;
void main() {
    vec4 previous = vec4(0.0), next = vec4(0.0);
    if (uSourceOnly < 0.5) {
        previous = texture2D(uPreviousConfidence, vUv);
        next = texture2D(uNextConfidence, vUv);
    }
    vec2 first = floor(gl_FragCoord.xy - 0.5) * 2.0;
    float difference = 0.0;
    for (int offsetY = 0; offsetY < 2; offsetY++) {
        for (int offsetX = 0; offsetX < 2; offsetX++) {
            vec2 pixel = min(first + vec2(float(offsetX), float(offsetY)), uActiveSize - 1.0);
            vec2 uv = (pixel + 0.5) / uSourceSize;
            vec4 current = texture2D(uCurrent, uv);
            vec4 delta =
                max(abs(current - texture2D(uBefore, uv)), abs(current - texture2D(uAfter, uv)));
            difference = max(difference, max(max(delta.r, delta.g), max(delta.b, delta.a)));
        }
    }
    // Residual and inconsistency are averaged. Speed and exact source
    // difference use maximum reduction, so a one-code change survives.
    gl_FragColor = vec4(max(previous.rg, next.rg), max(previous.b, next.b), difference);
}
