precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

uniform vec2 resolution;
uniform vec2 uvScale;

uniform vec2 Center;    // AE PIXELS center (e.g. 960,540 on 1920x1080)
uniform float Amount;   // blur strength
uniform float Zoom;     // 0=Standard, 1=Brightest, 2=Darkest (use float for Panzoid compatibility)

void main() {
    vec2 uv = vUvScaled;

    // Optimization: Skip calculation if Amount is effectively zero
    if (Amount <= 0.0) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
    }

    // Convert AE pixel center -> normalized UV -> scaled UV (same space as vUvScaled)
    vec2 centerScaled = (Center / resolution) * uvScale;

    vec2 dir = uv - centerScaled;

    // Safety: clamp sample count; loop hard-limited to 100
    int samples = int(clamp(ceil(Amount * 20.0), 1.0, 100.0));

    vec4 color = vec4(0.0);
    float weightSum = 0.0;

    for (int i = 0; i < 100; i++) {
        if (i >= samples) break;

        float t = float(i) / max(float(samples - 1), 1.0); // avoid division by zero

        // Samples pixels closer to the center, creating an outward "Forward Zoom" trail
        vec2 sampleUV = uv - dir * t * Amount * 0.02;

        vec4 texel = texture2D(tDiffuse, sampleUV);

        // Linear fade for smoother trails
        float weight = 1.0 - t;

        color += texel * weight;
        weightSum += weight;
    }

    color /= max(weightSum, 1e-6);

    // Apply Blend Modes (Standard / Brightest / Darkest)
    int mode = int(floor(Zoom + 0.5));
    vec3 original = texture2D(tDiffuse, uv).rgb;

    if (mode == 1) {
        color.rgb = max(color.rgb, original);
    } else if (mode == 2) {
        color.rgb = min(color.rgb, original);
    }

    gl_FragColor = color;
}
