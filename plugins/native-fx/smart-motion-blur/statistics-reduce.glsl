uniform sampler2D uTiles;
uniform vec2 uGroups;
uniform float uNormalization;
void main() {
    vec2 group = floor(gl_FragCoord.xy);
    float sum = 0.0;
    // Each statistic owns an 8 by 8 block of normalized partial sums.
    for (int y = 0; y < 8; y++)
        for (int x = 0; x < 8; x++) {
            vec2 pixel = group * 8.0 + vec2(float(x), float(y));
            sum += unpackStatistic(texture2D(uTiles, (pixel + 0.5) / (uGroups * 8.0))) / 64.0;
        }
    gl_FragColor = packStatistic(sum * uNormalization);
}
