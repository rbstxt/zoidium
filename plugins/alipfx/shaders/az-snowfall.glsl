precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Built-in Panzoid uniforms
uniform vec2 resolution;

// Custom properties (dynamic)
uniform float Flakes;            // Number of snowflakes
uniform float Size;              // Base size
uniform float Size_Variation;    // Variation % (Size)
uniform float Scene_Depth;       // Z-axis spread
uniform float Speed;             // Fall speed
uniform float Speed_Variation;   // Variation % (Speed)
uniform float Wind;              // Wind angle in degrees
uniform float Wind_Variation;    // Variation % (Wind)
uniform float Spread;            // Global chaos
uniform float Wiggle_Amount;     // Wiggle amplitude
uniform float Wiggle_Variation;  // Variation % (Amount)
uniform float Wiggle_Frequency;  // Base wiggle frequency
uniform float Frequency_Variation; // Variation % (Frequency)
uniform float Stochastic_Wiggle; // 0 = off, 1 = on
uniform float Flake_Flatness;    // Flatness %
uniform vec3 Color;              // Snow color
uniform float Opacity;           // Snow opacity
uniform float Time;              // Animation time

// Random generator
float rand(float n) {
    return fract(sin(n) * 43758.5453123);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    vec2 uv = vUvScaled;
    float snowAlpha = 0.0;

    for (int i = 0; i < 300; i++) {
        if (float(i) >= Flakes) break;

        float seed = float(i);
        float x = rand(seed * 12.9898);
        float y = rand(seed * 78.233);
        float z = rand(seed * 45.164) * Scene_Depth;

        // Depth factor
        float depthFactor = 1.0 / (1.0 + z * 0.01);
        float sizeVariation = 1.0 + (rand(seed * 55.5) - 0.5) * (Size_Variation / 100.0);
        float flakeSize = (Size / resolution.x) * depthFactor * sizeVariation;
        float flakeLength = flakeSize * (Flake_Flatness / 100.0);
        float speedVariation = 1.0 + (rand(seed * 66.6) - 0.5) * (Speed_Variation / 100.0);
        float flakeSpeed = Speed * depthFactor * speedVariation;

        // Depth-based opacity
        float depthOpacity = mix(1.0, 0.3, z / Scene_Depth);

        // ✅ Wind fix: full directional control + chaotic variation
        float baseAngle = radians(Wind);
        float angleOffset = radians((rand(seed * 99.9) - 0.5) * 2.0 * Wind_Variation);
        float finalAngle = baseAngle + angleOffset;
        vec2 fallDir = vec2(sin(finalAngle), -cos(finalAngle));

        // Apply motion along wind direction
        x += fallDir.x * flakeSpeed * Time / resolution.x;
        y += fallDir.y * flakeSpeed * Time / resolution.y;

        // Spread chaos (independent of wind)
        float spreadAngle = radians((rand(seed * 77.7) - 0.5) * 360.0);
        vec2 spreadDir = vec2(cos(spreadAngle), sin(spreadAngle));
        x += spreadDir.x * Spread * Time / resolution.x;
        y += spreadDir.y * Spread * Time / resolution.y;

        // Realistic wiggle drift (horizontal sway + slight vertical jitter)
        float wiggleAmp = Wiggle_Amount * (1.0 + (rand(seed * 88.8) - 0.5) * (Wiggle_Variation / 100.0));
        float freqVariation = 1.0 + (rand(seed * 101.1) - 0.5) * (Frequency_Variation / 100.0);
        float wigglePhase = Time * Wiggle_Frequency * freqVariation + seed;

        // Horizontal sway
        x += sin(wigglePhase) * wiggleAmp / resolution.x;

        // Slight vertical jitter for realism
        if (Stochastic_Wiggle > 0.5) {
            y += (rand(seed * 222.2) - 0.5) * wiggleAmp * 0.2 / resolution.y;
        }

        // Wrap around
        x = mod(x, 1.0);
        y = mod(y, 1.0);

        // Rotate flake based on wind angle
        mat2 rotation = mat2(cos(finalAngle), -sin(finalAngle),
                              sin(finalAngle),  cos(finalAngle));
        vec2 diff = rotation * (uv - vec2(x, y));

        // ✅ Depth-based blur: farther flakes appear softer
        float blurFactor = mix(0.0, 0.004, z / Scene_Depth);

        // Compute flake intensity with blur
        float flake = smoothstep(flakeSize + blurFactor, 0.0, abs(diff.x)) *
                      smoothstep(flakeLength + blurFactor, 0.0, abs(diff.y));

        snowAlpha += flake * depthOpacity;
    }

    snowAlpha = clamp(snowAlpha * Opacity, 0.0, 1.0);
    vec4 snowColor = vec4(Color, snowAlpha);
    gl_FragColor = mix(texel, snowColor, snowAlpha);
}
