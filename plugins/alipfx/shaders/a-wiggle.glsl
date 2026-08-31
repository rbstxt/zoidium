precision highp float;
precision highp int;

// Built-in Panzoid Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;
uniform float time; // Panzoid's built-in time variable

// Custom Plugin Properties (17 Parameters)
uniform float Wiggle_Type; // 0 = Smooth Random, 1 = Consistent Amplitude
uniform float Global_Amplitude;
uniform float Global_Frequency;
uniform vec2 Anchor_Point; // In pixels (e.g., 960, 540)

uniform float Pos_Separate_Dimension; // 0 = Disabled, 1 = Enabled
uniform float Pos_X;
uniform float Pos_Freq_X_Mult;
uniform float Pos_Y;
uniform float Pos_Freq_Y_Mult;

uniform float Scale_Separate_Dimension; // 0 = Disabled, 1 = Enabled
uniform float Scale_X;
uniform float Scale_Freq_X_Mult;
uniform float Scale_Y;
uniform float Scale_Freq_Y_Mult;

uniform float Rot_Angle;
uniform float Rot_Freq_Mult;

uniform float Random_Seed;

// --- NOISE & WIGGLE FUNCTIONS ---

// Simple 1D Hash for pseudo-randomness
float hash(float n) { 
    return fract(sin(n) * 1e4); 
}

// 1D Value Noise (Upgraded with Smootherstep)
float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    
    // Ken Perlin's "Smootherstep" formula for silkier, less mechanical transitions
    float u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    
    return mix(hash(i), hash(i + 1.0), u) * 2.0 - 1.0; // Returns -1.0 to 1.0
}

// Fractal Brownian Motion (Mimics the organic feel of After Effects Wiggle)
float aeWiggleNoise(float x) {
    float v = 0.0;
    float a = 0.5; // Amplitude of the first octave
    
    // 2 Octaves gives that subtle, organic secondary shake AE is known for
    for (int i = 0; i < 2; ++i) {
        v += a * noise(x);
        x = x * 2.0 + 100.0; // Double the frequency, shift the phase
        a *= 0.5; // Halve the amplitude for the secondary detail
    }
    
    // Reduced intensity for subtle random shake
    return v * 0.15; 
}

// Core Wiggle Logic
float wiggleVal(float t, float seed, float type) {
    // Offset time using the seed to ensure unique waves for every parameter
    float phaseOffset = seed * 13.753; // Smaller, more predictable offset
    
    if (type > 0.5) {
        // Type 1: Consistent Amplitude (Sine wave)
        // REDUCED BASE AMPLITUDE: Lowered from 0.25 to 0.12 so the sine wave
        // displacement feels more in line with the random noise displacement.
        return sin((t * 1.57079632679) + phaseOffset) * 0.12; 
    } else {
        // Type 0: Smooth Random (AE-style fBm Noise)
        // The random noise still needs a slightly faster progression to feel like a "shake"
        return aeWiggleNoise(t * 3.0 + phaseOffset); 
    }
}

// --- MAIN RENDER ---

void main() {
    vec2 uv = vUv;
    float aspect = resolution.x / resolution.y;
    
    // Base time adjusted by Global Frequency
    float t = time * Global_Frequency;
    float amp = Global_Amplitude;

    // 1. CALCULATE WIGGLE OFFSETS
    
    // Position Offset (in pixels)
    float p_x = 0.0, p_y = 0.0;
    if (Pos_Separate_Dimension > 0.5) {
        p_x = wiggleVal(t * Pos_Freq_X_Mult, Random_Seed + 1.1, Wiggle_Type) * Pos_X * amp;
        p_y = wiggleVal(t * Pos_Freq_Y_Mult, Random_Seed + 1.2, Wiggle_Type) * Pos_Y * amp;
    } else {
        // If not separate, use X values for both, but different seeds so they don't move diagonally
        p_x = wiggleVal(t * Pos_Freq_X_Mult, Random_Seed + 1.1, Wiggle_Type) * Pos_X * amp;
        p_y = wiggleVal(t * Pos_Freq_X_Mult, Random_Seed + 1.2, Wiggle_Type) * Pos_X * amp;
    }

    // Scale Offset (Percentage -> Decimal)
    float s_x = 1.0, s_y = 1.0;
    if (Scale_Separate_Dimension > 0.5) {
        s_x += wiggleVal(t * Scale_Freq_X_Mult, Random_Seed + 2.1, Wiggle_Type) * (Scale_X / 100.0) * amp;
        s_y += wiggleVal(t * Scale_Freq_Y_Mult, Random_Seed + 2.2, Wiggle_Type) * (Scale_Y / 100.0) * amp;
    } else {
        // Uniform scaling applies the exact same randomized value to both X and Y
        float s_uni = wiggleVal(t * Scale_Freq_X_Mult, Random_Seed + 2.1, Wiggle_Type) * (Scale_X / 100.0) * amp;
        s_x += s_uni;
        s_y += s_uni;
    }
    
    // Prevent scale from hitting exactly 0 to avoid division errors
    if (abs(s_x) < 0.001) s_x = 0.001 * sign(s_x);
    if (abs(s_y) < 0.001) s_y = 0.001 * sign(s_y);

    // Rotation Offset (Degrees -> Radians)
    float r_ang = wiggleVal(t * Rot_Freq_Mult, Random_Seed + 3.1, Wiggle_Type) * Rot_Angle * amp;
    float rad = r_ang * 3.14159265359 / 180.0;

    // 2. APPLY TRANSFORMATIONS (UV Mapping)
    
    // Convert AE pixel Anchor Point to normalized UV space (0.0 to 1.0)
    vec2 norm_anchor = Anchor_Point / resolution;
    
    // Adjust for Aspect Ratio so rotation doesn't warp/squash the texture
    uv.x *= aspect;
    norm_anchor.x *= aspect;

    // Move UV origin to the Anchor Point
    uv -= norm_anchor;

    // A. Apply Scale (Shaders read dest -> src, so we divide by scale)
    uv /= vec2(s_x, s_y);

    // B. Apply Rotation (Negative rad applies a clockwise rotation natively)
    float c = cos(-rad);
    float s = sin(-rad);
    mat2 rotMatrix = mat2(c, -s, s, c);
    uv *= rotMatrix;

    // C. Apply Position Translation
    // Convert the pixel offset to normalized space
    vec2 translation = vec2(p_x, p_y) / resolution;
    translation.x *= aspect; // Adjust translation to our aspect-corrected space
    
    // Subtract translation to move the image layer in the expected direction
    uv -= translation;

    // Restore the UV origin
    uv += norm_anchor;

    // Restore the Aspect Ratio
    uv.x /= aspect;

    // Apply Panzoid's buffer UV scale requirement
    uv *= uvScale;

    // Output final rendered pixel
    gl_FragColor = texture2D(tDiffuse, uv);
}
