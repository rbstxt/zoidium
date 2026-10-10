precision highp float;
precision highp int;

// Panzoid Built-in Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUv;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom Properties (Dynamic Numbers)
uniform float Oil_Amount;
uniform float Brush_Size;
uniform float Bristle_Length;
uniform float Bristle_Strength;
uniform float Bump_Depth;
uniform float Light_Intensity;
uniform float BG_Brush_Offset;
uniform float BG_Bump_Multiplier;
uniform float Glaze_Strength;
uniform float Glaze_Threshold;

// Helper: Sample texture with proper UV scaling
vec3 getTexel(vec2 uv) {
    return texture2D(tDiffuse, uv * uvScale).rgb;
}

// Helper: Simple hash function for procedural noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 uv = vUv;
    vec2 pixel = 1.0 / resolution;
    
    // Normalize parameters to 0.0 - 1.0 ranges
    float oilAmount = clamp(Oil_Amount / 100.0, 0.0, 1.0);
    float brushSize = max(1.0, Brush_Size);
    float bristleLength = clamp(Bristle_Length / 100.0, 0.0, 1.0);
    float bristleStrength = clamp(Bristle_Strength / 100.0, 0.0, 1.0);
    float bumpDepth = clamp(Bump_Depth / 100.0, 0.0, 1.0);
    float lightIntensity = clamp(Light_Intensity / 100.0, 0.0, 1.0);
    float bgBrushOffset = clamp(BG_Brush_Offset / 100.0, 0.0, 1.0);
    float bgBumpMult = clamp(BG_Bump_Multiplier / 100.0, 0.0, 1.0);
    float glazeStrength = clamp(Glaze_Strength / 100.0, 0.0, 1.0);
    float glazeThreshold = clamp(Glaze_Threshold / 255.0, 0.0, 1.0);

    vec2 radius = vec2(brushSize * pixel.x, brushSize * pixel.y);
    
    // ==========================================
    // 1. Calculate Gradient for Bristle Direction
    // ==========================================
    vec3 centerColor = getTexel(uv);
    vec3 rightColor = getTexel(uv + vec2(pixel.x, 0.0));
    vec3 bottomColor = getTexel(uv + vec2(0.0, pixel.y));
    
    float lumCenter = dot(centerColor, vec3(0.299, 0.587, 0.114));
    float lumRight = dot(rightColor, vec3(0.299, 0.587, 0.114));
    float lumBottom = dot(bottomColor, vec3(0.299, 0.587, 0.114));
    
    vec2 gradient = vec2(lumRight - lumCenter, lumBottom - lumCenter);
    vec2 bristleDir = length(gradient) > 0.001 ? normalize(gradient) : vec2(1.0, 0.0);
    
    // ==========================================
    // 2. Oil Painting Pass (Directional Brush)
    // ==========================================
    vec3 oilColor = vec3(0.0);
    float totalWeight = 0.0;
    
    int samples = 24; // Fixed sample count for GPU performance
    for (int i = 0; i < 24; i++) {
        float t = float(i) / 23.0 - 0.5;
        
        // Calculate stroke offset along the gradient
        vec2 strokeOffset = bristleDir * t * radius * bristleLength * 2.0;
        
        // Add random scatter inversely proportional to Bristle Strength
        vec2 scatter = vec2(hash(vec2(float(i), 0.0)) - 0.5, hash(vec2(0.0, float(i))) - 0.5);
        strokeOffset += scatter * radius * (1.0 - bristleStrength * 0.8);
        
        vec2 sampleUv = uv + strokeOffset;
        vec3 sampleColor = getTexel(sampleUv);
        
        // Intensity difference for color binning (Oil Amount controls tolerance)
        float sampleLum = dot(sampleColor, vec3(0.299, 0.587, 0.114));
        float diff = abs(sampleLum - lumCenter);
        float tolerance = 0.3 * (1.0 - oilAmount * 0.8);
        float weight = smoothstep(tolerance, 0.0, diff);
        
        oilColor += sampleColor * weight;
        totalWeight += weight;
    }
    
    vec3 paintedColor = totalWeight > 0.0 ? oilColor / totalWeight : centerColor;
    vec3 baseColor = mix(centerColor, paintedColor, oilAmount);
    
    // ==========================================
    // 3. Bump Mapping & Lighting
    // ==========================================
    float bumpScale = bumpDepth * 3.0;
    float n1 = hash(uv * 150.0);
    float n2 = hash(uv * 150.0 + vec2(1.0, 0.0));
    float n3 = hash(uv * 150.0 + vec2(0.0, 1.0));
    
    float bumpX = (n2 - n1) * bumpScale;
    float bumpY = (n3 - n1) * bumpScale;
    
    vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
    vec3 normal = normalize(vec3(-bumpX, -bumpY, 1.0));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float lighting = 0.6 + 0.4 * diffuse * lightIntensity;
    
    baseColor *= lighting;
    
    // ==========================================
    // 4. Background Brush & Glaze Overlay
    // ==========================================
    vec2 bgOffset = vec2(hash(uv * 70.0) - 0.5, hash(uv * 70.0 + 10.0) - 0.5) * bgBrushOffset * radius * 3.0;
    vec3 bgColor = getTexel(uv + bgOffset);
    
    // Apply secondary bump to background
    float bgBump = (hash(uv * 100.0 + bgOffset * 10.0) - 0.5) * bgBumpMult * 0.5;
    bgColor += bgBump;
    
    // Glaze mask based on luminance threshold
    float baseLum = dot(baseColor, vec3(0.299, 0.587, 0.114));
    float glazeMask = smoothstep(glazeThreshold - 0.05, glazeThreshold + 0.05, baseLum);
    
    vec3 finalColor = mix(baseColor, bgColor, glazeMask * glazeStrength);
    
    // Output final fragment
    gl_FragColor = vec4(finalColor, 1.0);
}
