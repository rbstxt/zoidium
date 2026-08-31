precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom properties
uniform float Noise;        // 0=Uniform, 1=Squared, 2=Grain
uniform float Hue;          // Hue noise intensity
uniform float Saturation;   // Saturation noise intensity
uniform float Lightness;    // Lightness noise intensity
uniform float Grain_Size;   // Grain size when Noise=2
uniform float Noise_Phase;  // Phase for animated noise

// Helper: Random generator
float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);
}

// Convert RGB to HSL
vec3 rgb2hsl(vec3 color) {
    float maxC = max(max(color.r, color.g), color.b);
    float minC = min(min(color.r, color.g), color.b);
    float l = (maxC + minC) * 0.5;
    float s = 0.0;
    float h = 0.0;
    if(maxC != minC){
        float d = maxC - minC;
        s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
        if(maxC == color.r) h = (color.g - color.b) / d + (color.g < color.b ? 6.0 : 0.0);
        else if(maxC == color.g) h = (color.b - color.r) / d + 2.0;
        else h = (color.r - color.g) / d + 4.0;
        h /= 6.0;
    }
    return vec3(h, s, l);
}

// Convert HSL back to RGB
vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    float r, g, b;
    if(s == 0.0){ r = g = b = l; }
    else {
        float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
        float p = 2.0 * l - q;
        float hk = h;
        float t[3];
        t[0] = hk + 1.0/3.0;
        t[1] = hk;
        t[2] = hk - 1.0/3.0;
        for(int i=0;i<3;i++){
            if(t[i] < 0.0) t[i] += 1.0;
            if(t[i] > 1.0) t[i] -= 1.0;
            if(t[i] < 1.0/6.0) t[i] = p + (q - p) * 6.0 * t[i];
            else if(t[i] < 1.0/2.0) t[i] = q;
            else if(t[i] < 2.0/3.0) t[i] = p + (q - p) * (2.0/3.0 - t[i]) * 6.0;
            else t[i] = p;
        }
        r = t[0]; g = t[1]; b = t[2];
    }
    return vec3(r,g,b);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec3 hsl = rgb2hsl(texel.rgb);

    // FIX 1: Use gl_FragCoord for exact screen pixels. 
    // This removes the "glitch" (diagonal lines) but keeps the noise.
    float safeGrainSize = max(Grain_Size, 1.0);
    vec2 pixelCoord = floor(gl_FragCoord.xy / safeGrainSize);

    // FIX 2: Generate INDEPENDENT random noise for H, S, and L.
    // If you use the exact same random number for all three channels, 
    // it won't look like After Effects. We offset the coordinates slightly for each.
    float n_h = rand(pixelCoord + Noise_Phase + vec2(0.0, 0.0));
    float n_s = rand(pixelCoord + Noise_Phase + vec2(12.34, 56.78));
    float n_l = rand(pixelCoord + Noise_Phase + vec2(87.65, 43.21));

    if(Noise == 1.0) {
        // Squared noise (adjusted so it doesn't artificially darken the whole image)
        n_h = n_h * n_h * (3.0 - 2.0 * n_h);
        n_s = n_s * n_s * (3.0 - 2.0 * n_s);
        n_l = n_l * n_l * (3.0 - 2.0 * n_l);
    }

    // Apply HLS noise
    hsl.x += Hue * (n_h - 0.5);
    hsl.y += Saturation * (n_s - 0.5);
    hsl.z += Lightness * (n_l - 0.5);

    // Wrap hue, clamp saturation and lightness
    hsl.x = fract(hsl.x); 
    hsl.y = clamp(hsl.y, 0.0, 1.0);
    hsl.z = clamp(hsl.z, 0.0, 1.0);

    vec3 rgb = hsl2rgb(hsl);
    gl_FragColor = vec4(rgb, texel.a);
}
