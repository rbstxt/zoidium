precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Panzoid custom properties
uniform float Amount_Of_Noise; // 0.0 - 100.0
uniform float Noise_Type;      // 0.0 = Mono, 1.0 = Color
uniform float Clipping;        // 0.0 = Off, 1.0 = On

// Built-in Panzoid uniform for animation
uniform float time; // Time in seconds

// Random generator with time-based seed
float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + time * 10.0) * 43758.5453);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    float noiseAmount = Amount_Of_Noise / 100.0;

    vec3 noiseColor;
    if (Noise_Type > 0.5) {
        noiseColor = vec3(
            rand(vUvScaled + vec2(0.123, 0.456)),
            rand(vUvScaled + vec2(0.789, 0.101)),
            rand(vUvScaled + vec2(0.112, 0.131))
        );
    } else {
        float n = rand(vUvScaled * 1000.0);
        noiseColor = vec3(n);
    }

    vec3 resultColor = texel.rgb + (noiseColor - 0.5) * noiseAmount;

    if (Clipping > 0.5) {
        resultColor = clamp(resultColor, 0.0, 1.0);
    }

    gl_FragColor = vec4(resultColor, texel.a);
}
