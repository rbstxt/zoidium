precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// Custom Panzoid properties (declare these in your effect settings)
uniform float Color_Steps;      // Controls color flattening (Lower = more chunk clay look)
uniform float Clay_Depth;       // Strength of the 3D matte emboss/shading
uniform float Texture_Scale;    // Scale of the fingerprint/clay mold wrinkles
uniform float Texture_Strength; // Intensity of the physical surface displacement

// Procedural wave function to mimic thumbprints and molded clay ridges
float clayTexture(vec2 p) {
    float n = sin(p.x * 0.4) * cos(p.y * 0.4);
    n += 0.5 * sin(p.x * 1.2 + p.y * 0.8);
    n += 0.25 * cos(p.x * 2.5 - p.y * 1.3);
    return n * 0.5 + 0.5;
}

void main()
{
    vec2 uv = vUvScaled;
    
    // 1. Organic UV Distortion (Creates the hand-molded, imperfect edges)
    vec2 texCoord = uv * Texture_Scale;
    float surfaceNoise = clayTexture(texCoord);
    
    // Displace texture coordinates slightly based on the clay texture layout
    vec2 distortedUV = uv + vec2(cos(surfaceNoise * 6.2831), sin(surfaceNoise * 6.2831)) * Texture_Strength * 0.02;
    
    // 2. Sample the original frame color
    vec4 color = texture2D(tDiffuse, distortedUV);
    
    // 3. Posterization (Quantize colors into flat blocks of clay)
    if (Color_Steps > 1.0) {
        color.rgb = floor(color.rgb * Color_Steps) / Color_Steps;
    }
    
    // 4. Pseudo-3D Shading & Edge Highlights
    // Look at adjacent pixels to calculate a luminance gradient (edge detection)
    vec2 pixelOffset = vec2(1.0) / resolution;
    float centerLuma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    
    float rightLuma = dot(texture2D(tDiffuse, distortedUV + vec2(pixelOffset.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float topLuma   = dot(texture2D(tDiffuse, distortedUV + vec2(0.0, pixelOffset.y)).rgb, vec3(0.299, 0.587, 0.114));
    
    float deltaX = centerLuma - rightLuma;
    float deltaY = centerLuma - topLuma;
    
    // Derive surface variations from the texture to mix with edge shadows
    float gradX = clayTexture(texCoord + vec2(0.1, 0.0)) - surfaceNoise;
    float gradY = clayTexture(texCoord + vec2(0.0, 0.1)) - surfaceNoise;
    
    // Combine edges and texture irregularities for the final bump map
    float finalEdgeX = deltaX + gradX * 0.15;
    float finalEdgeY = deltaY + gradY * 0.15;
    
    // Create an directional light source coming from the top-left
    float lightEmboss = (finalEdgeX + finalEdgeY) * Clay_Depth;
    
    // Apply the lighting overlay to the flat clay colors
    color.rgb += vec3(lightEmboss);
    
    // Ensure colors stay within bounds
    color.rgb = clamp(color.rgb, 0.0, 1.0);
    
    gl_FragColor = color;
}
