precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

// This links to your custom dynamic number property "Pixel Size"
uniform float Pixel_Size;

void main()
{
    // --- 1. PIXELATION ---
    // Prevent division by zero if Pixel Size is set to 0
    float pSize = max(1.0, Pixel_Size);
    
    // Calculate the grid-snapped UV coordinates for the mosaic effect
    vec2 snappedUv = floor(vUv * resolution / pSize) * pSize / resolution;
    
    // Multiply by uvScale as required by Panzoid for proper buffer mapping
    vec2 finalUv = snappedUv * uvScale;
    
    // Sample the color of the current "blocky" pixel
    vec4 texel = texture2D(tDiffuse, finalUv);

    // --- 2. COMMODORE 64 COLOR QUANTIZATION ---
    // Define the classic 16 C64 colors (normalized to 0.0 - 1.0)
    vec3 c0  = vec3(0.000, 0.000, 0.000); // Black
    vec3 c1  = vec3(1.000, 1.000, 1.000); // White
    vec3 c2  = vec3(0.533, 0.000, 0.000); // Red
    vec3 c3  = vec3(0.667, 1.000, 0.933); // Cyan
    vec3 c4  = vec3(0.800, 0.267, 0.800); // Purple
    vec3 c5  = vec3(0.000, 0.800, 0.333); // Green
    vec3 c6  = vec3(0.000, 0.000, 0.667); // Blue
    vec3 c7  = vec3(0.933, 0.933, 0.467); // Yellow
    vec3 c8  = vec3(0.867, 0.533, 0.333); // Orange
    vec3 c9  = vec3(0.400, 0.267, 0.000); // Brown
    vec3 c10 = vec3(1.000, 0.467, 0.467); // Light Red
    vec3 c11 = vec3(0.200, 0.200, 0.200); // Dark Grey
    vec3 c12 = vec3(0.467, 0.467, 0.467); // Grey
    vec3 c13 = vec3(0.667, 1.000, 0.400); // Light Green
    vec3 c14 = vec3(0.000, 0.533, 1.000); // Light Blue
    vec3 c15 = vec3(0.733, 0.733, 0.733); // Light Grey

    // Find the closest C64 color to the original pixel color
    vec3 bestColor = c0;
    float minDistance = 10.0;
    float d;

    // Manually checking distances to ensure max compatibility on all GPUs
    d = distance(texel.rgb, c0);  if (d < minDistance) { minDistance = d; bestColor = c0; }
    d = distance(texel.rgb, c1);  if (d < minDistance) { minDistance = d; bestColor = c1; }
    d = distance(texel.rgb, c2);  if (d < minDistance) { minDistance = d; bestColor = c2; }
    d = distance(texel.rgb, c3);  if (d < minDistance) { minDistance = d; bestColor = c3; }
    d = distance(texel.rgb, c4);  if (d < minDistance) { minDistance = d; bestColor = c4; }
    d = distance(texel.rgb, c5);  if (d < minDistance) { minDistance = d; bestColor = c5; }
    d = distance(texel.rgb, c6);  if (d < minDistance) { minDistance = d; bestColor = c6; }
    d = distance(texel.rgb, c7);  if (d < minDistance) { minDistance = d; bestColor = c7; }
    d = distance(texel.rgb, c8);  if (d < minDistance) { minDistance = d; bestColor = c8; }
    d = distance(texel.rgb, c9);  if (d < minDistance) { minDistance = d; bestColor = c9; }
    d = distance(texel.rgb, c10); if (d < minDistance) { minDistance = d; bestColor = c10; }
    d = distance(texel.rgb, c11); if (d < minDistance) { minDistance = d; bestColor = c11; }
    d = distance(texel.rgb, c12); if (d < minDistance) { minDistance = d; bestColor = c12; }
    d = distance(texel.rgb, c13); if (d < minDistance) { minDistance = d; bestColor = c13; }
    d = distance(texel.rgb, c14); if (d < minDistance) { minDistance = d; bestColor = c14; }
    d = distance(texel.rgb, c15); if (d < minDistance) { minDistance = d; bestColor = c15; }

    // Output the final retro pixel
    gl_FragColor = vec4(bestColor, texel.a);
}
