precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float time;

uniform float Noise;        // 0 = Uniform, 1 = Squared, 2 = Grain
uniform float Hue;          // intensity of hue noise
uniform float Saturation;   // intensity of saturation noise
uniform float Lightness;    // intensity of lightness noise
uniform float GrainSize;    // only used when Noise == 2
uniform float NoiseSpeed;   // frames per second

varying vec2 vUvScaled;

/* ===============================
   High-Precision Random Generator
   (Replaced sin() to permanently fix diagonal banding)
================================ */
float rand(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

/* ===============================
   RGB ↔ HSL Conversion
================================ */
vec3 rgb2hsl(vec3 color) {
    float maxC = max(color.r, max(color.g, color.b));
    float minC = min(color.r, min(color.g, color.b));
    float L = (maxC + minC) * 0.5;
    float H = 0.0;
    float S = 0.0;

    if(maxC != minC) {
        float d = maxC - minC;
        S = L > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
        if(maxC == color.r) H = (color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0);
        else if(maxC == color.g) H = (color.b - color.r) / d + 2.0;
        else H = (color.r - color.g) / d + 4.0;
        H /= 6.0;
    }
    return vec3(H, S, L);
}

float hue2rgb(float p, float q, float t) {
    if(t < 0.0) t += 1.0;
    if(t > 1.0) t -= 1.0;
    if(t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if(t < 1.0/2.0) return q;
    if(t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}

vec3 hsl2rgb(vec3 hsl) {
    float H = hsl.x;
    float S = hsl.y;
    float L = hsl.z;
    float r, g, b;

    if(S == 0.0) {
        r = g = b = L;
    } else {
        float q = L < 0.5 ? L * (1.0 + S) : L + S - L * S;
        float p = 2.0 * L - q;
        r = hue2rgb(p, q, H + 1.0/3.0);
        g = hue2rgb(p, q, H);
        b = hue2rgb(p, q, H - 1.0/3.0);
    }
    return vec3(r, g, b);
}

/* ===============================
   Main
================================ */
void main() {
    vec4 base = texture2D(tDiffuse, vUvScaled);
    vec3 hsl = rgb2hsl(base.rgb);

    // Calculate animation seed based on time and desired FPS.
    // Wrapped with mod() to prevent precision failure if the composition is very long.
    float seed = mod(floor(time * NoiseSpeed), 10000.0);

    // Determine grain scaling
    float actualGrainSize = (Noise >= 1.5) ? max(GrainSize, 1.0) : 1.0;

    // Use exact screen coordinates to ensure pure, crisp static
    vec2 pixelCoord = floor(gl_FragCoord.xy / actualGrainSize);

    // Generate independent noise for H, S, and L using the new hash function.
    float n_h = rand(pixelCoord + vec2(seed * 13.0, seed * 17.0));
    float n_s = rand(pixelCoord + vec2(seed * 23.0 + 123.4, seed * 29.0 + 567.8));
    float n_l = rand(pixelCoord + vec2(seed * 31.0 + 890.1, seed * 37.0 + 234.5));

    // Apply the "Squared" mode correctly if selected (Noise == 1)
    if (Noise > 0.5 && Noise < 1.5) {
        n_h = n_h * n_h * (3.0 - 2.0 * n_h);
        n_s = n_s * n_s * (3.0 - 2.0 * n_s);
        n_l = n_l * n_l * (3.0 - 2.0 * n_l);
    }

    // Apply noise directly to the HSL channels divided by 100
    hsl.x += (Hue / 100.0) * (n_h - 0.5);
    hsl.y += (Saturation / 100.0) * (n_s - 0.5);
    hsl.z += (Lightness / 100.0) * (n_l - 0.5);

    // Wrap hue, clamp saturation and lightness
    hsl.x = fract(hsl.x);
    hsl.y = clamp(hsl.y, 0.0, 1.0);
    hsl.z = clamp(hsl.z, 0.0, 1.0);

    vec3 finalColor = hsl2rgb(hsl);
    gl_FragColor = vec4(finalColor, base.a);
}
