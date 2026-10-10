precision highp float;
precision highp int;

// Panzoid Built-in Variables
uniform sampler2D tDiffuse;
varying vec2 vUv;
varying vec2 vUvScaled;
uniform vec2 uvScale;
uniform vec2 resolution;

// Custom Properties
uniform float Progress; 
uniform float Distortion; 
uniform float Feather; 
uniform float Reverse_Mode; // Toggle: 0.0 for Normal, 1.0 for Reverse

void main() {
    // 1. Correct the aspect ratio
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
    vec2 center = vec2(0.5, 0.5);
    
    // 2. Base distance from center
    float dist = distance((vUv - center) * aspect, vec2(0.0));
    float radius = Progress * 1.5; 
    
    // 3. Create the repeating ripples
    float wave = sin(dist * 40.0 - (Progress * 30.0));
    float rippleArea = smoothstep(0.5, 0.0, abs(dist - radius));
    
    // 4. Calculate the base distortion offset for the RGB split
    vec2 dir = normalize(vUv - center);
    vec2 baseOffset = dir * wave * rippleArea * Distortion;
    
    // 5. Displace the distance field for the alpha mask
    float maskDist = dist - (wave * rippleArea * Distortion * 2.5);
    
    // 6. Calculate the feathered alpha mask
    float edgeSoftness = max(0.001, Feather);
    float alphaMask = smoothstep(radius - edgeSoftness, radius + edgeSoftness, maskDist);
    
    // 7. REVERSE MODE LOGIC: Invert the mask if Reverse_Mode is set to 1.0
    alphaMask = mix(alphaMask, 1.0 - alphaMask, Reverse_Mode);
    
    // 8. Sample the Original Footage with the RGB split distortion
    vec4 texR = texture2D(tDiffuse, (vUv + baseOffset) * uvScale);
    vec4 texG = texture2D(tDiffuse, (vUv + baseOffset * 0.6) * uvScale);
    vec4 texB = texture2D(tDiffuse, (vUv + baseOffset * 0.2) * uvScale);
    vec3 color = vec3(texR.r, texG.g, texB.b);
    
    // 9. Output final pixel
    gl_FragColor = vec4(color, alphaMask);
}
