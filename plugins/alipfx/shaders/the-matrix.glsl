precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

// --- PANZOID CUSTOM PROPERTIES ---
uniform float Time;        // Dynamic number to drive upward speed
uniform float Frequency;   // Controls stream density (e.g., 0.15)
uniform float Alpha_mode;  // Checkbox / Toggle for transparency mode (0.0 = Off, 1.0 = On)

varying vec2 vUv;
varying vec2 vUvScaled;

// Simple random hash function
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main()
{
    // Grab whatever background/text layer is underneath
    vec4 baseTex = texture2D(tDiffuse, vUvScaled);

    // Grid resolution: X is columns, Y is vertical character stacking
    vec2 gridResolution = vec2(40.0, 25.0);
    vec2 st = vUv * gridResolution;
    
    vec2 ipos = floor(st); // Column and Row integer ID
    vec2 fpos = fract(st); // Local 0.0 to 1.0 position inside a text block

    // Give each vertical column its own unique speed multiplier
    float colRandom = hash(vec2(ipos.x, 55.33));
    float speed = 4.0 + colRandom * 4.0;
    
    // Animate coordinates downward to make the visual texture stream UPWARD
    float movingY = st.y - (Time * speed);
    float iposY = floor(movingY);
    
    // --- FREQUENCY & SPARSITY ---
    float packetId = floor(movingY / 12.0); 
    float spawnChance = hash(vec2(ipos.x, packetId));
    float visibility = step(1.0 - Frequency, spawnChance);

    // Make the digital characters morph/flicker over time
    float changeTime = floor(Time * 15.0 + colRandom * 20.0);
    float charRandom = hash(vec2(ipos.x, iposY + changeTime));
    
    // Procedural Glyph Generator (Creates matrix-style blocky code characters)
    float glyph = 0.0;
    vec2 subGrid = floor(fpos * 3.5); 
    float subHash = hash(subGrid + vec2(charRandom));
    if (subHash > 0.4 && fpos.x > 0.1 && fpos.x < 0.9 && fpos.y > 0.1 && fpos.y < 0.9) {
        glyph = 1.0;
    }

    // Upward fade trail: Brightest at the top head, fading out downwards
    float trail = fract(movingY * 0.08);
    
    // Intense glowing head at the tip of the climbing stream
    float headGlow = step(0.92, trail) * 2.5;
    
    // Calculate alpha channels for the effect (Feather logic is gone!)
    float finalAlpha = trail * hash(vec2(ipos.x, iposY)) * glyph * visibility;
    float finalGlow = headGlow * glyph * visibility;

    // Build the Matrix Green color profile
    vec3 matrixColor = vec3(0.0, 0.9, 0.25) * finalAlpha;       // Main code stream
    matrixColor += vec3(0.7, 1.0, 0.8) * finalGlow;             // Bright white-green tip
    matrixColor += vec3(0.0, 0.25, 0.05) * trail * 0.2 * visibility; // Soft column glow

    // Composite color additively over background elements
    vec3 finalOutColor = baseTex.rgb + matrixColor;

    // --- ALPHA / TRANSPARENCY MODE LOGIC ---
    float outAlpha = baseTex.a;
    
    if (Alpha_mode > 0.5) {
        // Find the total visibility strength of the matrix effect itself
        float matrixAlphaMax = clamp(finalAlpha + finalGlow, 0.0, 1.0);
        
        // If the background pixel is completely black, turn it transparent
        if (baseTex.rgb == vec3(0.0)) {
            outAlpha = matrixAlphaMax;
        } else {
            outAlpha = max(baseTex.a, matrixAlphaMax);
        }
    }

    // Output the final pixel with transparency adjustments
    gl_FragColor = vec4(finalOutColor, outAlpha);
}
