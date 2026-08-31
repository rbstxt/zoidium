precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Built-in Panzoid uniforms
uniform vec2 resolution;

// Custom properties (dynamic)
uniform float Drops;          // Number of raindrops
uniform float Size;           // Raindrop size
uniform float Scene_Depth;    // Z-axis spread
uniform float Speed;          // Fall speed
uniform float Wind;           // Wind angle in degrees
uniform float Wind_Variation; // Wind variation %
uniform float Spread;         // Global chaos
uniform vec3 Color;           // Rain color
uniform float Opacity;        // Rain opacity
uniform float Time;           // Animation time

// Random generator
float rand(float n) {
    return fract(sin(n) * 43758.5453123);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUvScaled);

    vec2 uv = vUvScaled; // normalized UV (0.0 to 1.0)
    float rainAlpha = 0.0;

    // Loop through raindrops (limited for performance)
    for (int i = 0; i < 200; i++) {
        if (float(i) >= Drops) break;

        float seed = float(i);
        float x = rand(seed * 12.9898);
        float y = rand(seed * 78.233);
        float z = rand(seed * 45.164) * Scene_Depth;

        // Depth factor for perspective scaling
        float depthFactor = 1.0 / (1.0 + z * 0.01);
        float dropSize = (Size / resolution.x) * depthFactor;
        float dropLength = (Size * 0.02) * depthFactor;
        float dropSpeed = Speed * depthFactor;

        // Depth-based opacity: farther drops fade out
        float depthOpacity = mix(1.0, 0.2, z / Scene_Depth);

        // Compute wind angle with variation
        float baseAngle = radians(Wind);
        float angleOffset = radians((rand(seed * 99.9) - 0.5) * 2.0 * Wind_Variation);
        float finalAngle = baseAngle + angleOffset;

        // Fall direction based on varied angle
        vec2 fallDir = vec2(sin(finalAngle), -cos(finalAngle));

        // Apply motion along varied direction
        x += fallDir.x * dropSpeed * Time / resolution.x;
        y += fallDir.y * dropSpeed * Time / resolution.y;

        // Apply global chaos (Spread) independent of wind
        float spreadAngle = radians((rand(seed * 77.7) - 0.5) * 360.0);
        vec2 spreadDir = vec2(cos(spreadAngle), sin(spreadAngle));
        x += spreadDir.x * Spread * Time / resolution.x;
        y += spreadDir.y * Spread * Time / resolution.y;

        // Wrap around
        x = mod(x, 1.0);
        y = mod(y, 1.0);

        // Rotate streak based on varied angle
        mat2 rotation = mat2(cos(finalAngle), -sin(finalAngle),
                              sin(finalAngle),  cos(finalAngle));
        vec2 diff = rotation * (uv - vec2(x, y));

        // Compute streak intensity with depth-based blur
        float blurFactor = mix(0.0, 0.003, z / Scene_Depth); // farther = blurrier
        float streak = smoothstep(dropSize + blurFactor, 0.0, abs(diff.x)) *
                       smoothstep(dropLength + blurFactor, 0.0, abs(diff.y));

        // Apply depth opacity
        rainAlpha += streak * depthOpacity;
    }

    // Clamp and apply Opacity as intensity multiplier
    rainAlpha = clamp(rainAlpha * Opacity, 0.0, 1.0);

    vec4 rainColor = vec4(Color, rainAlpha);
    gl_FragColor = mix(texel, rainColor, rainAlpha);
}
