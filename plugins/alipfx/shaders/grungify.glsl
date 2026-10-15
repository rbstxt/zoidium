precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse; // Panzoid's default input texture

// Grungefy Parameters (Updated to match your exact capitalization)
uniform float Threshold; 
uniform float Interval;  
uniform float Overlap;   
uniform float Invert;    
uniform float Seed;      
uniform float time;      // Kept lowercase to match your screenshot

// Pseudo-random number generator
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    // Normalize threshold (Assuming UI input is 0-100)
    float thresh = Threshold / 100.0;
    
    // Calculate how many times to sample the image (Base + Overlap)
    int stacks = int(Overlap) + 1;
    float finalMask = 0.0;
    
    // Discretize time to create a "boiling" stop-motion grunge look (approx 12 FPS)
    float tStep = floor(time * 12.0);

    for(int i = 0; i < 20; i++) {
        if(i >= stacks) break; 
        
        float fi = float(i);
        
        // Create a unique seed based on the current stack, the base seed, and time
        vec2 seedVec = vec2(Seed + fi * 1.13, Seed - fi * 0.77 + tStep * 0.01);
        
        // Generate random rotations and offsets
        float angle = (random(seedVec) * 2.0 - 1.0) * 3.14159 * (Interval * 0.1);
        
        vec2 offset = vec2(
            random(seedVec + vec2(1.0, 0.0)),
            random(seedVec + vec2(0.0, 1.0))
        ) * 2.0 - 1.0;
        offset *= Interval * 0.05; 
        
        // Transform the UV coordinates (Rotate and Translate from the center)
        vec2 uv = vUv - 0.5;
        float s = sin(angle);
        float c = cos(angle);
        uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        uv += 0.5 + offset;
        
        // Clamp UVs to prevent edge wrapping artifacts
        uv = clamp(uv, 0.0, 1.0);
        
        // Sample the transformed image
        vec4 color = texture2D(tDiffuse, uv);
        
        // Convert to grayscale/luminance
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        
        // Binarize based on the threshold
        float binarized = step(thresh, luma);
        
        // Combine layers
        finalMask = max(finalMask, binarized);
    }
    
    // Invert the final result if enabled
    if(Invert > 0.5) {
        finalMask = 1.0 - finalMask;
    }
    
    // Output the final monochromatic grunge texture
    gl_FragColor = vec4(vec3(finalMask), 1.0);
}
