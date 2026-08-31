precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

uniform float Property;   // 1:R, 2:G, 3:B, 4:A, 5:Luma, 6:Lightness
uniform float Softness;   // Single slider: controls fusion + displacement
uniform float CutAway;    // AE-style 0..100 or normalized 0..1

varying vec2 vUvScaled;

float getChannel(vec4 c) {
    int p = int(Property + 0.1);
    if (p == 1) return c.r;
    if (p == 2) return c.g;
    if (p == 3) return c.b;
    if (p == 4) return c.a;
    if (p == 5) return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    if (p == 6) {
        float mx = max(max(c.r,c.g), c.b);
        float mn = min(min(c.r,c.g), c.b);
        return 0.5 * (mx + mn);
    }
    return c.a;
}

float srcField(vec2 uv) { return getChannel(texture2D(tDiffuse, uv)); }

float fixedBlur(vec2 uv) {
    vec2 texel = 1.0 / resolution;
    float sum = 0.0, wsum = 0.0;
    for (int x = -2; x <= 2; ++x)
    for (int y = -2; y <= 2; ++y) {
        vec2 o = vec2(float(x), float(y));
        float w = exp(-dot(o,o) * 0.35);
        sum  += getChannel(texture2D(tDiffuse, uv + o * texel)) * w;
        wsum += w;
    }
    return sum / wsum;
}

float blobField(vec2 uv) {
    if (Softness <= 0.0) return srcField(uv);
    float s = clamp(Softness, 0.0, 100.0);
    float fuse = 1.0 - exp(-s * 0.06);
    return mix(srcField(uv), fixedBlur(uv), fuse);
}

vec3 fieldNormal(vec2 uv, float h) {
    vec2 texel = 1.0 / resolution;
    float hx = blobField(uv + vec2(texel.x, 0.0)) - h;
    float hy = blobField(uv + vec2(0.0, texel.y)) - h;
    return normalize(vec3(-hx * 28.0, -hy * 28.0, 1.0));
}

float normalizeCut(float c) { return (c > 1.0) ? clamp(c * 0.01, 0.0, 1.0) : clamp(c, 0.0, 1.0); }

void main() {
    vec2 uv = vUvScaled;
    float h = blobField(uv);
    float cut = normalizeCut(CutAway);
    float feather = 0.004;

    float mask = (CutAway <= 0.001) ? 1.0 : smoothstep(cut - feather, cut + feather, h);
    if (mask <= 0.0) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
    }

    // Strong displacement even at Softness = 20
    float heightFactor = clamp(Softness * 0.05, 0.0, 5.0); // more aggressive scaling

    // Displacement for blob depth
    vec3 N = fieldNormal(uv, h);
    vec2 displacedUV = uv + N.xy * heightFactor * 0.002;
    vec4 src = texture2D(tDiffuse, displacedUV);

    // AE-style shading: darken for contour
    vec3 L = normalize(vec3(-0.55, -0.75, 1.0));
    float diff = max(dot(N, L), 0.0);
    vec3 shading = vec3(1.0 - diff * 0.3);

    vec3 outRgb = mix(src.rgb, src.rgb * shading, mask);
    float outA = src.a;

    gl_FragColor = vec4(outRgb, outA);
}
