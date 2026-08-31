precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time;

uniform float Scanline_Intensity;
uniform float Scanline_Width;
uniform float Dot_Mask;
uniform float CRT_Gamma;
uniform float Monitor_Gamma;

uniform float Halation;
uniform float Halation_Threshold;
uniform float Bloom_Threshold;
uniform float Bloom_Intensity;
uniform float Bloom_Radius;

uniform float Red_Offset_X;
uniform float Red_Offset_Y;
uniform float Green_Offset_X;
uniform float Green_Offset_Y;
uniform float Blue_Offset_X;
uniform float Blue_Offset_Y;

uniform float Color_Bleed;
uniform float Noise;
uniform float Jitter;
uniform float Hum_Bar_Strength;
uniform float Hum_Bar_Speed;
uniform float Hum_Bar_Count;

uniform float Corner_Size;
uniform float Barrel;
uniform float Pincushion;
uniform float H_Keystone;
uniform float V_Keystone;

uniform float Expand_Beyond_Layer;
uniform float Exposure;
uniform float Vignette;
uniform float Mix;

varying vec2 vUv;
varying vec2 vUvScaled;

float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

vec2 applyGeometry(vec2 uv) {
    vec2 centered = uv - 0.5;
    if (H_Keystone != 0.0) {
        float hFactor = 1.0 + H_Keystone * 0.01 * centered.y;
        centered.x *= hFactor;
    }
    if (V_Keystone != 0.0) {
        float vFactor = 1.0 + V_Keystone * 0.01 * centered.x;
        centered.y *= vFactor;
    }
    if (Barrel != 0.0) {
        float r2 = dot(centered, centered);
        float distortion = 1.0 + Barrel * 0.01 * r2;
        centered *= distortion;
    }
    if (Pincushion != 0.0) {
        float r2 = dot(centered, centered);
        float distortion = 1.0 / (1.0 + Pincushion * 0.01 * r2);
        centered *= distortion;
    }
    return centered + 0.5;
}

float cornerMask(vec2 uv) {
    if (Corner_Size <= 0.0) return 1.0;
    vec2 centered = abs(uv - 0.5);
    float corner = Corner_Size;
    vec2 dist = max(centered + corner - 0.5, 0.0);
    float d = length(dist);
    return 1.0 - smoothstep(0.0, corner, d);
}

vec4 sampleChromatic(vec2 uv) {
    vec2 redOff = vec2(Red_Offset_X, Red_Offset_Y) * 0.001;
    vec2 greenOff = vec2(Green_Offset_X, Green_Offset_Y) * 0.001;
    vec2 blueOff = vec2(Blue_Offset_X, Blue_Offset_Y) * 0.001;
    float r = texture2D(tDiffuse, uv + redOff).r;
    float g = texture2D(tDiffuse, uv + greenOff).g;
    float b = texture2D(tDiffuse, uv + blueOff).b;
    float a = texture2D(tDiffuse, uv).a;
    return vec4(r, g, b, a);
}

vec4 applyColorBleed(vec4 color, vec2 uv) {
    if (Color_Bleed <= 0.0) return color;
    float bleed = Color_Bleed * 0.0015;
    vec4 blurred = vec4(0.0);
    float total = 0.0;
    for (int i = -6; i <= 6; i++) {
        float fi = float(i);
        float weight = exp(-abs(fi) * 0.5);
        blurred += texture2D(tDiffuse, uv + vec2(fi * bleed, 0.0)) * weight;
        total += weight;
    }
    blurred /= total;
    return mix(color, blurred, Color_Bleed * 0.01);
}

vec4 applyBloom(vec4 color, vec2 uv) {
    if (Bloom_Intensity <= 0.0) return color;
    float radius = Bloom_Radius * 0.002;
    vec4 bloom = vec4(0.0);
    float samples = 0.0;
    for (int x = -3; x <= 3; x++) {
        for (int y = -3; y <= 3; y++) {
            vec2 off = vec2(float(x), float(y)) * radius;
            vec4 s = texture2D(tDiffuse, uv + off);
            float bright = dot(s.rgb, vec3(0.299, 0.587, 0.114));
            float thresh = Bloom_Threshold * 0.01;
            if (bright > thresh) {
                bloom += s * (bright - thresh);
            }
            samples += 1.0;
        }
    }
    bloom /= samples;
    return color + bloom * Bloom_Intensity * 0.05;
}

vec4 applyHalation(vec4 color, vec2 uv) {
    if (Halation <= 0.0) return color;
    vec3 halationCol = vec3(0.0);
    float totalWeight = 0.0;
    for (int x = -5; x <= 5; x++) {
        for (int y = -5; y <= 5; y++) {
            vec2 off = vec2(float(x), float(y)) * 0.003;
            vec4 s = texture2D(tDiffuse, uv + off);
            float bright = dot(s.rgb, vec3(0.299, 0.587, 0.114));
            float thresh = Halation_Threshold * 0.01;
            if (bright > thresh) {
                float w = bright - thresh;
                halationCol += vec3(1.0, 0.35, 0.15) * w;
                totalWeight += w;
            }
        }
    }
    if (totalWeight > 0.0) {
        halationCol /= totalWeight;
        color.rgb += halationCol * Halation * 0.015;
    }
    return color;
}

vec4 applyScanlines(vec4 color, vec2 uv) {
    if (Scanline_Intensity <= 0.0) return color;
    float freq = resolution.y / max(Scanline_Width, 0.1);
    float scanline = sin(uv.y * freq * 3.14159);
    float factor = 1.0 - (scanline * 0.5 + 0.5) * Scanline_Intensity * 0.01;
    return vec4(color.rgb * factor, color.a);
}

vec4 applyDotMask(vec4 color, vec2 uv) {
    if (Dot_Mask <= 0.0) return color;
    float x = uv.x * resolution.x;
    float strength = Dot_Mask * 0.01;
    float triad = mod(x, 3.0);
    vec3 mask;
    if (triad < 1.0) {
        mask = vec3(1.0, 0.5, 0.5);
    } else if (triad < 2.0) {
        mask = vec3(0.5, 1.0, 0.5);
    } else {
        mask = vec3(0.5, 0.5, 1.0);
    }
    color.rgb = mix(color.rgb, color.rgb * mask, strength);
    return color;
}

vec4 applyNoise(vec4 color, vec2 uv) {
    if (Noise <= 0.0) return color;
    float n = hash(vec3(uv * resolution, fract(time * 30.0)));
    n = n * 2.0 - 1.0;
    color.rgb += n * Noise * 0.008;
    return color;
}

vec2 applyJitter(vec2 uv) {
    if (Jitter <= 0.0) return uv;
    
    float jitterAmount = Jitter * 0.001;
    float pixelY = uv.y * resolution.y;
    float frameTime = floor(time * 60.0);
    
    // 3 frequency layers for realistic analog instability
    float fine   = hash(vec2(floor(pixelY),      frameTime))      * 2.0 - 1.0;
    float medium = hash(vec2(floor(pixelY / 4.0), frameTime * 0.7)) * 2.0 - 1.0;
    float coarse = hash(vec2(floor(pixelY / 16.0), frameTime * 1.3)) * 2.0 - 1.0;
    
    float displacement = fine * 0.5 + medium * 0.3 + coarse * 0.2;
    
    // Horizontal displacement only
    return uv + vec2(displacement * jitterAmount, 0.0);
}

vec4 applyHumBars(vec4 color, vec2 uv) {
    if (Hum_Bar_Strength <= 0.0) return color;
    float speed = Hum_Bar_Speed;
    float count = Hum_Bar_Count;
    float strength = Hum_Bar_Strength * 0.01;
    float barPhase = time * speed;
    float barPattern = sin((uv.y + barPhase) * count * 3.14159 * 2.0);
    barPattern = barPattern * 0.5 + 0.5;
    float effect = 1.0 - barPattern * strength;
    return vec4(color.rgb * effect, color.a);
}

vec4 applyVignette(vec4 color, vec2 uv) {
    if (Vignette <= 0.0) return color;
    vec2 centered = uv - 0.5;
    float dist = length(centered) * 1.4142;
    float vig = 1.0 - smoothstep(0.3, 0.85, dist);
    vig = mix(1.0, vig, Vignette * 0.01);
    return vec4(color.rgb * vig, color.a);
}

vec4 applyExposure(vec4 color) {
    if (Exposure == 0.0) return color;
    float factor = pow(2.0, Exposure * 0.1);
    color.rgb *= factor;
    return color;
}

vec4 applyGamma(vec4 color) {
    if (CRT_Gamma > 0.0 && CRT_Gamma != 1.0) {
        color.rgb = pow(max(color.rgb, 0.0), vec3(CRT_Gamma));
    }
    if (Monitor_Gamma > 0.0 && Monitor_Gamma != 1.0) {
        color.rgb = pow(max(color.rgb, 0.0), vec3(1.0 / Monitor_Gamma));
    }
    return color;
}

void main() {
    vec2 uv = vUvScaled;
    uv = applyJitter(uv);
    vec2 distortedUV = applyGeometry(uv);
    bool outOfBounds = distortedUV.x < 0.0 || distortedUV.x > 1.0 || 
                       distortedUV.y < 0.0 || distortedUV.y > 1.0;
    vec4 color = sampleChromatic(distortedUV);
    color = applyColorBleed(color, distortedUV);
    color = applyBloom(color, distortedUV);
    color = applyHalation(color, distortedUV);
    color = applyGamma(color);
    color = applyScanlines(color, distortedUV);
    color = applyDotMask(color, distortedUV);
    color = applyNoise(color, distortedUV);
    color = applyHumBars(color, distortedUV);
    color = applyVignette(color, distortedUV);
    color = applyExposure(color);
    float corner = cornerMask(distortedUV);
    color.rgb *= corner;
    if (outOfBounds && Expand_Beyond_Layer < 0.5) {
        color = vec4(0.0);
    }
    vec4 original = texture2D(tDiffuse, vUvScaled);
    color = mix(original, color, Mix * 0.01);
    gl_FragColor = color;
}
