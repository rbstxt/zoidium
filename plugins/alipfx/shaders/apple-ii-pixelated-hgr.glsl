precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom Property: You will need to create a Dynamic Number property named "Pixel_Size"
uniform float Pixel_Size;

void main() {
    // 1. Setup fallback to prevent divide-by-zero crashes if Pixel_Size is set to 0
    float pSize = max(Pixel_Size, 2.0);

    // 2. Pixelation (Mosaic Effect)
    // Divide the screen into blocks based on resolution and user's Pixel_Size
    vec2 pixelCoord = floor(vUv * resolution / pSize) * pSize;
    vec2 pixelatedUv = pixelCoord / resolution;

    // Apply Panzoid's UV scaling to the newly pixelated UV map
    vec2 sampleUv = pixelatedUv * uvScale;

    // Sample the original texture footage at the pixelated coordinates
    vec4 texel = texture2D(tDiffuse, sampleUv);
    vec3 col = texel.rgb;

    // 3. Simulated CRT Dithering / Artifacting
    // Adds a slight checkerboard noise pattern to push border colors into alternating pixels
    vec2 ditherCoord = floor(vUv * resolution / pSize);
    float dither = (mod(ditherCoord.x + ditherCoord.y, 2.0) - 0.5) * 0.15;
    col += dither;

    // 4. Apple II HGR 6-Color Palette
    vec3 c_black  = vec3(0.00, 0.00, 0.00);
    vec3 c_white  = vec3(1.00, 1.00, 1.00);
    vec3 c_green  = vec3(0.08, 0.89, 0.22);
    vec3 c_violet = vec3(0.89, 0.22, 0.89);
    vec3 c_orange = vec3(0.96, 0.44, 0.11);
    vec3 c_blue   = vec3(0.11, 0.66, 0.96);

    // 5. Color Quantization (Nearest Neighbor Mapping)
    // Finds which Apple II color is mathematically closest to the current original pixel
    vec3 outColor = c_black;
    float minDist = distance(col, c_black);

    float d = distance(col, c_white);
    if(d < minDist) { minDist = d; outColor = c_white; }

    d = distance(col, c_green);
    if(d < minDist) { minDist = d; outColor = c_green; }

    d = distance(col, c_violet);
    if(d < minDist) { minDist = d; outColor = c_violet; }

    d = distance(col, c_orange);
    if(d < minDist) { minDist = d; outColor = c_orange; }

    d = distance(col, c_blue);
    if(d < minDist) { minDist = d; outColor = c_blue; }

    // Output the final mapped color, preserving original alpha transparency
    gl_FragColor = vec4(outColor, texel.a);
}
