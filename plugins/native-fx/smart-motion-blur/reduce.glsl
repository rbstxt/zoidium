uniform sampler2D uImage;
uniform vec2 uSourceSize;
uniform float uAverage;
void main() {
    vec2 first = floor(gl_FragCoord.xy-0.5)*2.0;
    vec4 maximum = vec4(0.0), sum = vec4(0.0);
    float count=0.0;
    for (int y=0; y<2; y++) for (int x=0; x<2; x++) {
        vec2 p=first+vec2(float(x),float(y));
        if (p.x >= uSourceSize.x || p.y >= uSourceSize.y) continue;
        vec4 c=texture2D(uImage,(p+0.5)/uSourceSize);
        maximum=max(maximum,c); sum+=c; count+=1.0;
    }
    gl_FragColor=vec4(mix(maximum.rg,sum.rg/max(count,1.0),uAverage),maximum.ba);
}
