precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform sampler2D envMap;
uniform vec2 resolution;
varying vec2 vUvScaled;

uniform float Property;
uniform float Softness;   // Controls Expansion/Contraction
uniform float Height;     // Positive = Outward, Negative = Inward
uniform float Cut_Min;
uniform float Cut_Max;

float getProperty(vec4 texel) {
    float val;
    if (Property < 1.5) val = texel.r;
    else if (Property < 2.5) val = texel.g;
    else if (Property < 3.5) val = texel.b;
    else if (Property < 4.5) val = texel.a;
    else if (Property < 5.5) val = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
    else val = 0.5 * (max(max(texel.r, texel.g), texel.b) + min(min(texel.r, texel.g), texel.b));
    
    // Mirrored logic for full-logo coverage
    return abs(val - 0.5) * 2.0; 
}

float normalizeSlider(float v) {
    return v / 100.0;
}

void main() {
    // Edge Fade to prevent cropping artifacts
    vec2 uv = vUvScaled;
    float edgeFade = smoothstep(0.0, 0.01, uv.x) * smoothstep(1.0, 0.99, uv.x) *
                     smoothstep(0.0, 0.01, uv.y) * smoothstep(1.0, 0.99, uv.y);

    vec4 texel = texture2D(tDiffuse, uv);
    float rawProp = getProperty(texel);

    // ---------------------------------------------------------
    // 1. SOFTNESS = EXPANSION/CONTRACTION
    // We use Softness to shift the threshold of the matte.
    // ---------------------------------------------------------
    float expansion = normalizeSlider(Softness) * 0.5;
    float cutMinNorm = clamp(normalizeSlider(Cut_Min) - expansion, 0.0, 1.0);
    float cutMaxNorm = clamp(normalizeSlider(Cut_Max) - expansion, 0.0, 1.0);
    
    float matte = smoothstep(cutMinNorm, cutMaxNorm, rawProp) * edgeFade;

    if (matte <= 0.0) {
        gl_FragColor = texel;
        return;
    }

    // 2. SURFACE SAMPLING
    vec2 texelSize = 1.0 / resolution;
    // We use a small fixed blur for the internal surface smoothness
    float h = rawProp;
    float h_r = getProperty(texture2D(tDiffuse, uv + vec2(texelSize.x, 0.0)));
    float h_u = getProperty(texture2D(tDiffuse, uv + vec2(0.0, texelSize.y)));

    // ---------------------------------------------------------
    // 3. HEIGHT = INWARD/OUTWARD
    // Multiplying the XY of the normal by the height value 
    // flips the lighting direction when negative.
    // ---------------------------------------------------------
    float hNorm = normalizeSlider(Height);
    // 0.1 is the 'flatness' constant. Smaller = steeper plastic.
    vec3 N = normalize(vec3((h - h_r) * hNorm, (h - h_u) * hNorm, 0.1));

    // 4. LIGHTING
    vec3 L = normalize(vec3(-0.5, -0.7, 1.0));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 64.0);

    // Distorted reflection for the liquid look
    vec2 reflectUV = uv + N.xy * 0.05;
    vec3 reflection = texture2D(envMap, vec2(reflectUV.x, 1.0 - reflectUV.y)).rgb;

    vec3 plasticColor = (texel.rgb * (0.3 + 0.7 * diff)) + (reflection * 0.5) + vec3(spec * 0.8);

    gl_FragColor = vec4(mix(texel.rgb, plasticColor, matte), texel.a);
}
