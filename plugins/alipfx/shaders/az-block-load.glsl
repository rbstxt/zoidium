precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

// Dynamic Properties
uniform float Completion;
uniform float Scans;

// Checkbox Properties
uniform bool Start_Cleared;
uniform bool Bilinear;

// Function to handle soft/bilinear block blending
vec4 getBilinearBlock(vec2 uv, vec2 pixelSize) {
    vec2 st = uv / pixelSize - 0.5;
    vec2 i = floor(st);
    vec2 f = fract(st);
    
    // Get the centers of the 4 nearest blocks
    vec2 p00 = clamp((i + vec2(0.5, 0.5)) * pixelSize, 0.0, 1.0) * uvScale;
    vec2 p10 = clamp((i + vec2(1.5, 0.5)) * pixelSize, 0.0, 1.0) * uvScale;
    vec2 p01 = clamp((i + vec2(0.5, 1.5)) * pixelSize, 0.0, 1.0) * uvScale;
    vec2 p11 = clamp((i + vec2(1.5, 1.5)) * pixelSize, 0.0, 1.0) * uvScale;
    
    // Sample the textures at those block centers
    vec4 col00 = texture2D(tDiffuse, p00);
    vec4 col10 = texture2D(tDiffuse, p10);
    vec4 col01 = texture2D(tDiffuse, p01);
    vec4 col11 = texture2D(tDiffuse, p11);
    
    // Interpolate the colors
    return mix(mix(col00, col10, f.x), mix(col01, col11, f.x), f.y);
}

// Function to resolve what the image looks like at a specific "Scan Pass"
vec4 getColorForPass(float pass) {
    float S = max(1.0, floor(Scans)); // Ensure at least 1 pass
    
    // If the pass has exceeded the scan count, it is perfectly loaded
    if (pass >= S) {
        return texture2D(tDiffuse, vUvScaled);
    }
    
    // Initial unloaded state
    if (pass <= 0.0) {
        if (Start_Cleared) {
            return vec4(0.0); // Completely invisible
        }
        // If Start_Cleared is false, do not return early! 
        // Let it fall through to generate the massive blocks.
    }
    
    // Calculate the block size dynamically based on how many passes are left
    // We clamp the pass to 0.0 so negative passes don't break the math
    float blocksLeft = S - max(pass, 0.0);
    float blockSize = pow(2.0, blocksLeft + 2.0); // e.g., 32x32 -> 16x16 -> 8x8 -> Clear
    
    // Create the pixel grid relative to the current buffer resolution
    vec2 pixelSize = max(vec2(1.0) / resolution, blockSize / resolution);
    
    if (Bilinear) {
        return getBilinearBlock(vUv, pixelSize);
    } else {
        // Nearest neighbor snap (sharp edges)
        vec2 blockUv = floor(vUv / pixelSize) * pixelSize + (pixelSize * 0.5);
        return texture2D(tDiffuse, clamp(blockUv, 0.0, 1.0) * uvScale);
    }
}

void main() {
    // Normalize completion from 0-100 down to 0.0-1.0
    float comp = clamp(Completion / 100.0, 0.0, 1.0);
    float S = max(1.0, floor(Scans));
    
    // Map total completion against the number of defined scans
    float scan_progress = comp * S;
    
    // Determine the current full pass index, and how far along the vertical sweep we are
    float current_pass = floor(scan_progress);
    float y_progress = fract(scan_progress);
    
    float active_pass = current_pass;
    
    // AE's CC Block Load sweeps vertically from Top to Bottom
    // vUv.y is 1.0 at the top, 0.0 at the bottom.
    // If the fragment is above the sweeping threshold, it advances to the next pass
    if (vUv.y > 1.0 - y_progress) {
        active_pass += 1.0;
    }
    
    // Output the computed block load fragment
    gl_FragColor = getColorForPass(active_pass);
}
