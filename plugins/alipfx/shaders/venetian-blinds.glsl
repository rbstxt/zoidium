precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Custom Properties
uniform float Transition_Completion; // 0 to 100
uniform float Direction;             // Degrees
uniform float Width;                 // Slat thickness (Pixels)
uniform float Feather;               // Edge softness (Pixels)

void main() {
    vec2 uv = vUv;
    float aspect = resolution.x / resolution.y;
    
    // 1. Rotation (Matches AE Clockwise)
    float angle = radians(Direction);
    float s = sin(angle);
    float c = cos(angle);
    
    // Center, correct aspect, rotate
    vec2 centeredUv = uv - 0.5;
    centeredUv.x *= aspect;
    vec2 rotUv;
    rotUv.x = centeredUv.x * c - centeredUv.y * s;
    rotUv.y = centeredUv.x * s + centeredUv.y * c;
    
    // 2. Slat Grid Setup
    // Calculate slat size in UV space based on pixel Width
    // We strictly use the Y-resolution as the anchor to match pixel feel
    float slatSize = max(Width, 1.0) / resolution.y;
    
    // Create the repeating pattern
    // We add a large offset to prevent negative coordinate artifacts
    float val = (rotUv.x / slatSize) + 100.0; 
    float fraction = fract(val);
    
    // 3. Distance from Center (Symmetry)
    // This creates a V-shape: 0.0 at center, 0.5 at edges
    float dist = abs(fraction - 0.5);
    
    // 4. Normalized Feather
    // We calculate feather as a ratio of the slat width.
    // If Feather = Width, the gradient spans the whole slat.
    float fRatio = (Feather / max(Width, 1.0)) * 0.5;
    
    // 5. Smart Transition Logic
    // We map the 0-100 completion to a range that extends slightly BEYOND
    // the slat boundaries. This ensures that at 0%, the feather doesn't
    // cut into the image, and at 100%, it's fully gone.
    
    // The visual half-width of the slat (0.0 to 0.5)
    // We buffer the range by 'fRatio' so the gradient can exist off-slat
    float maxVisible = 0.5 + fRatio;
    float minVisible = 0.0 - fRatio;
    
    // Map completion to this extended range
    float progress = Transition_Completion / 100.0;
    float currentThreshold = mix(maxVisible, minVisible, progress);
    
    // 6. Create Mask
    // Use smoothstep to create the gradient around the threshold
    // We invert it because we want the center (dist 0) to be visible
    float mask = 1.0 - smoothstep(currentThreshold - fRatio, currentThreshold + fRatio, dist);

    // 7. Output
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = texel * mask;
}
