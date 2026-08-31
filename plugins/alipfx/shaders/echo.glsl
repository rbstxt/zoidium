precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUv;

// Echo parameters
uniform float echoTime;        // Time offset per echo
uniform int numEchoes;         // Number of echoes
uniform float startIntensity;  // Starting opacity
uniform float decay;           // Opacity decay per echo
uniform int echoOperator;      // Blend mode

vec4 blendColors(vec4 base, vec4 newColor, int mode) {
    if (mode == 0) return base + newColor; // Add
    if (mode == 1) return max(base, newColor); // Maximum
    if (mode == 2) return min(base, newColor); // Minimum
    if (mode == 3) return 1.0 - (1.0 - base) * (1.0 - newColor); // Screen
    if (mode == 4) return newColor; // Composite In Back
    if (mode == 5) return base; // Composite In Front
    if (mode == 6) return mix(base, newColor, newColor.a); // Blend
    return base;
}

void main() {
    vec4 finalColor = vec4(0.0);
    float intensity = startIntensity;

    for (int i = 0; i < 100; i++) {
        if (i >= numEchoes) break;

        // Static trailing offset based on echo index
        vec2 uvOffset = vUv - vec2(echoTime * float(i) * 0.1, 0.0); // Horizontal shift

        vec4 sampleColor = texture2D(tDiffuse, uvOffset) * intensity;

        finalColor = (i == 0) ? sampleColor : blendColors(finalColor, sampleColor, echoOperator);

        intensity *= decay; // Fade out each subsequent echo
    }

    gl_FragColor = finalColor;
}
