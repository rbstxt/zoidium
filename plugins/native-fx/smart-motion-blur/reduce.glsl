uniform sampler2D uImage;
uniform vec2 uSourceSize;
uniform float uAverage;
void main() {
    vec2 first = floor(gl_FragCoord.xy - 0.5) * 2.0;
    vec4 maximum = vec4(0.0), sum = vec4(0.0);
    float count = 0.0;
    for (int offsetY = 0; offsetY < 2; offsetY++)
        for (int offsetX = 0; offsetX < 2; offsetX++) {
            vec2 pixel = first + vec2(float(offsetX), float(offsetY));
            if (pixel.x >= uSourceSize.x || pixel.y >= uSourceSize.y) continue;
            vec4 value = texture2D(uImage, (pixel + 0.5) / uSourceSize);
            maximum = max(maximum, value);
            sum += value;
            count += 1.0;
        }
    gl_FragColor = vec4(mix(maximum.rg, sum.rg / max(count, 1.0), uAverage), maximum.ba);
}
