precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Custom Properties
uniform float Amount;          
uniform vec2 Center;           
uniform float Type;             // 0: Spin, 1: Zoom
uniform float Antialiasing;     // 0: Low (16), 1: High (64)
uniform float Random_Seed;      

// High-frequency noise function to randomize sampling patterns
float gold_noise(vec2 coord, float seed) {
    return fract(sin(dot(coord.xy + seed, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 center = Center;
    float aspect = resolution.x / resolution.y;
    
    // Determine sample count based on Antialiasing toggle
    int samples = (Antialiasing > 0.5) ? 64 : 16;
    
    // Amount normalization (Matches AE intensity feel)
    float strength = Amount * 0.01;
    
    vec4 accum = vec4(0.0);
    
    for (int i = 0; i < 64; i++) {
        if (i >= samples) break;

        // The Random Seed now creates a unique jitter per sample per pixel
        float noise = gold_noise(vUv + float(i), Random_Seed);
        float t = (float(i) + noise) / float(samples);

        vec2 sampleUv;

        if (Type > 0.5) {
            // --- ZOOM BLUR ---
            // Samples move inward/outward relative to center
            float scale = 1.0 - (strength * t);
            sampleUv = center + (vUv - center) * scale;
        } else {
            // --- SPIN BLUR ---
            // Rotation based on distance from center
            float angle = strength * t * 2.0;
            float s = sin(angle);
            float c = cos(angle);
            
            // Shift to origin, correct aspect, rotate, then shift back
            vec2 rel = vUv - center;
            rel.x *= aspect;
            
            vec2 rotated;
            rotated.x = rel.x * c - rel.y * s;
            rotated.y = rel.x * s + rel.y * c;
            
            rotated.x /= aspect;
            sampleUv = rotated + center;
        }

        accum += texture2D(tDiffuse, sampleUv);
    }

    gl_FragColor = accum / float(samples);
}
