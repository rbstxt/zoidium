precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;
uniform float time;

// Custom Properties from Panzoid UI
uniform int Test_signal;
uniform float Picture_gain;
uniform float Picture_threshold;
uniform float Audio_gain;
uniform float Signal_resolution;
uniform float Steps_per_loop;
uniform float Beam_point_density;
uniform float Trace_frequency;
uniform float Phosphor_fade_time;
uniform float Beam_width;
uniform float Brightness;
uniform float Intensity_flicker;
uniform float Curvature_gain;
uniform int Transparent;

// Pseudo-random generator for the analog beam flicker
float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Vintage CRT glass curvature distortion
vec2 applyCurvature(vec2 uv, float curve) {
    if (curve <= 0.0) return uv;
    uv = uv * 2.0 - 1.0;
    vec2 offset = abs(uv.yx) / (4.0 / curve);
    uv = uv + uv * offset * offset;
    uv = uv * 0.5 + 0.5;
    return uv;
}

void main() {
    // 1. Apply Screen Curvature
    vec2 uv = applyCurvature(vUvScaled, Curvature_gain);
    
    // Capture the original frame color for transparency overlay masking
    vec4 baseTexel = texture2D(tDiffuse, uv);

    // Handle out-of-bounds pixels from screen curvature distortion
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = (Transparent == 1) ? baseTexel : vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // 2. High-Frequency Analog Modulation (Simulating Audio Gain Ribbon Effect)
    // This creates the vertical zig-zag lines seen in the text contours
    float wavePhase = uv.x * Steps_per_loop * 0.1 + time * Trace_frequency;
    float analogJitter = sin(wavePhase) * (Audio_gain * 0.0015);
    vec2 sampleUv = uv + vec2(0.0, analogJitter);

    // 3. Edge Detection Signal Extraction
    vec2 texel = 1.0 / (resolution * max(Signal_resolution / 1000.0, 0.1));
    float bw = max(Beam_width, 0.1);
    
    vec4 t00 = texture2D(tDiffuse, sampleUv + vec2(-texel.x, -texel.y) * bw);
    vec4 t10 = texture2D(tDiffuse, sampleUv + vec2( 0.0,     -texel.y) * bw);
    vec4 t20 = texture2D(tDiffuse, sampleUv + vec2( texel.x, -texel.y) * bw);
    vec4 t01 = texture2D(tDiffuse, sampleUv + vec2(-texel.x,  0.0) * bw);
    vec4 t21 = texture2D(tDiffuse, sampleUv + vec2( texel.x,  0.0) * bw);
    vec4 t02 = texture2D(tDiffuse, sampleUv + vec2(-texel.x,  texel.y) * bw);
    vec4 t12 = texture2D(tDiffuse, sampleUv + vec2( 0.0,      texel.y) * bw);
    vec4 t22 = texture2D(tDiffuse, sampleUv + vec2( texel.x,  texel.y) * bw);

    vec4 sx = t00 + 2.0*t01 + t02 - (t20 + 2.0*t21 + t22);
    vec4 sy = t00 + 2.0*t10 + t20 - (t02 + 2.0*t12 + t22);
    float edge = length(sx) + length(sy);
    
    float signal = smoothstep(Picture_threshold, Picture_threshold + 0.2, edge) * Picture_gain;
    
    // 4. Test Signal Mode Override
    if (Test_signal == 1) {
        float testWave = sin(uv.x * Trace_frequency * 5.0 + time * 10.0) * 0.25 + 0.5;
        float dist = abs(uv.y - testWave + analogJitter);
        signal = smoothstep(Beam_width * 0.015, 0.0, dist) * Picture_gain;
    }

    // 5. Beam Density, Flicker & Sweep Decay Simulation
    float flicker = 1.0 - (Intensity_flicker * 0.05 * rand(vec2(time, uv.y)));
    float sweep = fract((uv.x + uv.y) * (Steps_per_loop * 0.001) - time * (Trace_frequency * 0.1));
    float fade = mix(1.0, sweep, clamp(Phosphor_fade_time / 100.0, 0.0, 1.0));
    
    // Create dotted/dashed vector structural properties via point density
    float densityPattern = abs(sin(uv.x * Beam_point_density));
    
    // Combine everything into a unified beam intensity value
    float intensity = signal * (Brightness * 0.1) * flicker * fade * densityPattern;
    intensity = clamp(intensity, 0.0, 1.0);

    // 6. Color Construction (White Core + Vibrant Green Phosphor Glow)
    vec3 phosphorGlow = vec3(0.2, 0.95, 0.55); // Rich mint green glow
    vec3 beamCore     = vec3(0.85, 1.0, 0.9);  // Hot white center core
    vec3 finalBeamColor = mix(phosphorGlow * intensity, beamCore, pow(intensity, 4.0)) * intensity;

    // 7. Output Layer Composite Routing
    if (Transparent == 1) {
        // Composites the oscilloscope lines directly on top of the original layer
        gl_FragColor = vec4(max(baseTexel.rgb, finalBeamColor), baseTexel.a);
    } else {
        // Keeps the background completely solid black
        gl_FragColor = vec4(finalBeamColor, 1.0);
    }
}
