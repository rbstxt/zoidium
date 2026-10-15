precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
uniform vec2 resolution;

// Custom Properties
uniform float Progress;
uniform float Grid_Size;
uniform float Reverse;

const float SQRT3 = 1.73205080757;

void main() {
    float size = Grid_Size <= 0.0 ? 15.0 : Grid_Size;
    float prog = clamp(Progress, 0.0, 1.0);
    float rev = clamp(Reverse, 0.0, 1.0);

    // Aspect ratio correction for the grid
    float aspect = resolution.x / resolution.y;
    vec2 st = vUvScaled;
    st.x *= aspect;
    st *= size;

    // Skew coordinates into an equilateral triangle (isometric) grid
    vec2 skewed;
    skewed.y = st.y * (2.0 / SQRT3);
    skewed.x = st.x - skewed.y * 0.5;

    vec2 id = floor(skewed);
    vec2 f = fract(skewed);

    // Separate into alternating 60-degree triangles
    bool isTri1 = (f.x + f.y < 1.0);
    vec2 centroid = isTri1 ? vec2(0.3333333, 0.3333333) : vec2(0.6666667, 0.6666667);

    // --- Calculate True Circular Distance ---
    // Get the skewed center of the current triangle
    vec2 skewedCenter = id + centroid;
    
    // Convert back to true, un-skewed aspect coordinates
    vec2 stCenter;
    stCenter.y = skewedCenter.y * (SQRT3 / 2.0);
    stCenter.x = skewedCenter.x + skewedCenter.y * 0.5; 
    
    // Define the exact center of the screen in the same coordinate space
    vec2 screenCenter = vec2(0.5 * aspect, 0.5) * size;
    
    // Calculate standard Euclidean distance
    float dist = distance(stCenter, screenCenter);
    
    // Normalize the distance by the maximum distance to the screen corner
    float maxDist = distance(vec2(0.0, 0.0), vec2(0.5 * aspect, 0.5)) * size;
    float delay = dist / maxDist; 
    
    // Animation timing calculation
    float localAnim = clamp((prog - delay * 0.6) * 2.5, 0.0, 1.0);

    // --- Reverse Logic ---
    float targetScale = mix(1.0 - localAnim, localAnim, rev);
    float scale = max(targetScale, 0.0001);

    vec2 fScaled = (f - centroid) / scale + centroid;

    // Mask pixels outside the scaled equilateral triangle
    float mask = 1.0;
    if (isTri1) {
        if (fScaled.x < 0.0 || fScaled.y < 0.0 || (fScaled.x + fScaled.y) > 1.0) mask = 0.0;
    } else {
        if (fScaled.x > 1.0 || fScaled.y > 1.0 || (fScaled.x + fScaled.y) < 1.0) mask = 0.0;
    }

    // Clean up remaining artifacts at the absolute start/end of the animation
    if (rev < 0.5) {
        if (localAnim > 0.99) mask = 0.0;
    } else {
        if (localAnim < 0.01) mask = 0.0;
    }

    vec4 texel = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = vec4(texel.rgb, texel.a * mask);
}
