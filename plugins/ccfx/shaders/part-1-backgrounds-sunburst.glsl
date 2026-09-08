precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- User Variables ---

// Rotation: The base rotation of the sunburst in degrees.
uniform float rotation; 

// Rotation Offset: Additional static rotation in degrees to control start point.
uniform float rotation_offset;

// Speed: Animation speed. Multiplies with time.
uniform float speed; 

// Dashes: How many rays the sunburst has.
uniform float dashes; 

// Progress: Thickness of the rays (0.0 to 1.0).
uniform float progress; 

// Scale: Controls width (x) and height (y) stretch.
uniform vec2 scale;

// Center: The origin point of the sunburst (0.0 to 1.0). 
// Default: vec2(0.5, 0.5)
uniform vec2 center;

// Swirl: How much to twist the rays. 
// 0.0 = Straight rays. Higher values = More curve.
uniform float swirl;

// Color 1: Color of the odd number rays (Visible).
uniform vec3 color1; 

// Color 2: Color of the even number rays (Transparent Background).
uniform vec3 color2; 

// Time uniform for animation
uniform float uTime;

void main()
{
    // 1. Offset UVs by the Center position
    // We subtract the 'center' uniform instead of hardcoded 0.5
    vec2 centeredUv = vUvScaled - center;

    // 2. Apply Scale
    // Divide by scale to stretch/squash
    centeredUv /= scale;

    // 3. Calculate Polar Coordinates
    // Angle: The direction of the pixel
    // Dist: The distance from the center (used for Swirl)
    float angle = atan(centeredUv.y, centeredUv.x);
    float dist = length(centeredUv);

    // 4. Apply Swirl
    // We modify the angle based on the distance.
    // Pixels further away get rotated more, creating a spiral effect.
    angle += dist * swirl;

    // 5. Apply Rotation Calculations
    // Convert degrees to radians for both rotation variables
    float totalRotation = radians(rotation) + radians(rotation_offset);
    
    // Add time-based animation
    float animOffset = totalRotation + (speed * uTime);
    
    // Apply offsets to the current angle
    float finalAngle = angle - animOffset;

    // 6. Normalize angle to 0.0 - 1.0 range
    // We divide by 2*PI (approx 6.2831853)
    float normalizedAngle = fract(finalAngle / 6.2831853);

    // 7. Generate the Sunburst Pattern
    // Frequency determined by dashes
    float fanFrequency = dashes; 
    
    // We use modulo logic via fract to repeat the pattern
    // The pattern repeats every (1.0 / dashes)
    float stepValue = fract(normalizedAngle * fanFrequency);

    // 8. Determine the Mask
    // 'step' returns 0.0 if stepValue < progress, 1.0 otherwise.
    // If stepValue < progress, it is the "Ray" (Color 1).
    // If stepValue > progress, it is the "Gap" (Color 2).
    float rayMask = step(progress, stepValue);
    
    // 9. Mix Colors
    // If rayMask is 0.0, we get Color 1. If 1.0, we get Color 2.
    vec3 finalColor = mix(color1, color2, rayMask);

    // 10. Output with Transparency
    // Invert rayMask for Alpha.
    // rayMask 0.0 (Color 1) becomes Alpha 1.0 (Visible)
    // rayMask 1.0 (Color 2) becomes Alpha 0.0 (Transparent)
    gl_FragColor = vec4(finalColor, 1.0 - rayMask);
}
