precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom properties
uniform float Progress;
uniform float Pixel_Size; 
uniform float Reverse;  

void main()
{
    // 1. Calculate grid dimensions to perfectly match the screen aspect ratio
    float pSize = max(Pixel_Size, 1.0);
    float cols = ceil(resolution.x / pSize);
    float rows = ceil(resolution.y / pSize);
    
    // 2. Get the current block coordinates
    // We invert the Y axis (1.0 - vUv.y) so row 0 is at the absolute TOP of the screen
    float c = floor(vUv.x * cols);
    float r = floor((1.0 - vUv.y) * rows);
    
    // 3. Determine which "ring" of the spiral this block is in from the outer edge
    float ring = min(min(c, r), min(cols - 1.0 - c, rows - 1.0 - r));
    
    // 4. Calculate dimensions of the remaining inner area
    float innerW = cols - 2.0 * ring;
    float innerH = rows - 2.0 * ring;
    
    // Calculate the starting index of the current ring
    float totalBlocks = cols * rows;
    float startIndex = totalBlocks - (innerW * innerH);
    
    // 5. Calculate the exact sequence index around the current rectangular ring
    float offset = 0.0;
    if (r == ring) {
        // Top edge: wipes horizontally from left to right
        offset = c - ring;
    } else if (c == cols - 1.0 - ring) {
        // Right edge: wipes vertically downwards
        offset = (innerW - 1.0) + (r - ring);
    } else if (r == rows - 1.0 - ring) {
        // Bottom edge: wipes horizontally from right to left
        offset = (innerW - 1.0) + (innerH - 1.0) + ((cols - 1.0 - ring) - c);
    } else {
        // Left edge: wipes vertically upwards
        offset = 2.0 * (innerW - 1.0) + (innerH - 1.0) + ((rows - 1.0 - ring) - r);
    }
    
    // Normalize the index between 0.0 and 1.0
    float index = startIndex + offset;
    float normalizedIndex = (index + 0.5) / totalBlocks;
    
    // 6. Apply Transition Logic
    float mask;
    if (Reverse > 0.5) {
        // Center -> Outward wipe
        mask = step(normalizedIndex, 1.0 - Progress);
    } else {
        // Pokemon Style: Outside -> Inward wipe (Starts at Top-Left)
        mask = step(Progress, normalizedIndex);
    }
    
    // 7. Output
    vec4 texel = texture2D(tDiffuse, vUv * uvScale);
    gl_FragColor = vec4(texel.rgb, texel.a * mask);
}
