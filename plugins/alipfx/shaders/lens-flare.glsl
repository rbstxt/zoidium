precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// Custom properties
uniform vec2 Flare_Center;        // Position in pixels
uniform float Flare_Brightness;   // Intensity
uniform int Lens_Type;            // 0=Zoom, 1=35mm, 2=105mm
uniform float Blend_With_Original;// Inverted opacity (0 = full flare, 1 = no flare)

uniform vec2 resolution;

void main() {
    vec4 baseColor = texture2D(tDiffuse, vUvScaled);

    // Normalize center for resolution
    vec2 uv = vUvScaled;
    vec2 center = Flare_Center / resolution;

    // Distance from flare center
    vec2 diff = uv - center;
    float dist = length(diff);

    // Base glow (gentle falloff)
    float glow = Flare_Brightness / (dist * 1.5 + 0.05);

    // Lens type streak variation
    float streak = 0.0;
    if (Lens_Type == 0) streak = exp(-dist * 6.0);
    else if (Lens_Type == 1) streak = exp(-dist * 3.0);
    else if (Lens_Type == 2) streak = exp(-dist * 4.5);

    // Combine flare components
    vec3 flareColor = vec3(glow + streak);

    // Invert Blend_With_Original for flare opacity
    float flareOpacity = 1.0 - Blend_With_Original;

    // Apply inverted opacity
    flareColor *= flareOpacity;

    // Final blend: original + flare
    vec3 combinedColor = baseColor.rgb + flareColor;

    gl_FragColor = vec4(combinedColor, 1.0);
}
