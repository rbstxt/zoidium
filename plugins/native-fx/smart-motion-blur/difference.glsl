uniform sampler2D uCurrent;
uniform sampler2D uOther;
uniform vec2 uSourceSize;
uniform vec2 uActiveSize;
void main() {
    vec2 first = floor(gl_FragCoord.xy - 0.5) * 2.0;
    float difference = 0.0;
    for (int y = 0; y < 2; y++)
        for (int x = 0; x < 2; x++) {
            vec2 p = min(first + vec2(float(x), float(y)), uActiveSize - 1.0);
            vec2 uv = (p + 0.5) / uSourceSize;
            vec4 d = abs(texture2D(uCurrent, uv) - texture2D(uOther, uv));
            difference = max(difference, max(max(d.r, d.g), max(d.b, d.a)));
        }
    gl_FragColor = vec4(difference);
}
