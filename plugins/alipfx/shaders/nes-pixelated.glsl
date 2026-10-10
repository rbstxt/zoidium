precision highp float;
precision highp int;

// Panzoid built-in uniforms & varyings
uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;

// Custom UI properties (Make sure to add these in your Panzoid properties panel!)
uniform float Pixel_Size;
uniform float Color_Count;

// Authentic 4x4 Bayer Dithering Matrix
float bayer4x4(vec2 p) {
    vec2 f = mod(p, 4.0);
    float m = 0.0;
    if (f.y < 2.0) {
        if (f.x < 2.0) { 
            m = (f.y == 0.0) ? ((f.x == 0.0) ? 0.0 : 8.0) : ((f.x == 0.0) ? 12.0 : 4.0); 
        } else { 
            m = (f.y == 0.0) ? ((f.x == 2.0) ? 2.0 : 10.0) : ((f.x == 2.0) ? 14.0 : 6.0); 
        }
    } else {
        if (f.x < 2.0) { 
            m = (f.y == 2.0) ? ((f.x == 0.0) ? 3.0 : 11.0) : ((f.x == 0.0) ? 15.0 : 7.0); 
        } else { 
            m = (f.y == 2.0) ? ((f.x == 2.0) ? 1.0 : 9.0) : ((f.x == 2.0) ? 13.0 : 5.0); 
        }
    }
    return m / 16.0;
}

void main() {
    // Safety fallback boundaries to avoid dividing by zero
    float size = max(Pixel_Size, 1.0);
    float colors = max(Color_Count, 2.0);

    // 1. Calculate retro grid mapping based on composition resolution
    vec2 pixelCount = resolution / size;
    
    // 2. Pixelate the UV coordinates
    vec2 uvPix = floor(vUv * pixelCount) / pixelCount;
    
    // 3. Coordinate positions for aligning the dither matrix pattern
    vec2 ditherPos = floor(vUv * pixelCount);

    // 4. Sample the layer using the newly scaled retro UVs
    vec4 texel = texture2D(tDiffuse, uvPix * uvScale);

    // 5. Apply retro 8-bit color dithering spread
    float bayerValue = bayer4x4(ditherPos) - 0.5;
    float spread = 1.0 / colors;
    vec3 ditheredColor = texel.rgb + (bayerValue * spread);

    // 6. Quantize (posterize) down to strict color depths
    vec3 finalColor = floor(ditheredColor * colors + 0.5) / colors;

    // Output the completed NES aesthetic layout
    gl_FragColor = vec4(finalColor, texel.a);
}
