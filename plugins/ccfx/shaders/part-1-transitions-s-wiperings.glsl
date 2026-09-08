// Background Color: Default: [1 0 0 1]
// The color to wipe to (Red by default). Format is R G B A.

precision highp float;
precision highp int;

uniform sampler2D tDiffuse; 
varying vec2 vUvScaled;

// --- User Variables ---
uniform float wipePercent;    // Default: 0, Range: 0 to 1
uniform float edgeSoftness;   // Default: 0, Range: 0 or greater
uniform float frequency;      // Default: 4, Range: 0.1 or greater
uniform float relWidth;       // Default: 1, Range: 0.1 or greater
uniform float shiftStripes;   // Default: 0, Range: -5 to 5
uniform vec2 center;          // Default: [0 0]
uniform float bulge;          // Default: 0, Range: -1 to 1
uniform float rotate;         // Default: 0
uniform float gradAdd;        // Default: 0, Range: -10 to 10
uniform float gradAngle;      // Default: 0
uniform float radialGrad;     // Default: 0

uniform vec4 backgroundColor; 

#define PI 3.14159265359

void main() {
    // 1. Normalize Coordinates
    vec2 p = vUvScaled - 0.5 - center;

    // 2. Apply Rotation
    float rad = radians(rotate);
    float c = cos(rad);
    float s = sin(rad);
    p = mat2(c, -s, s, c) * p;

    // 3. Apply Relative Width
    p.x /= max(0.001, relWidth); 

    // 4. Calculate Distance and Bulge
    float dist = length(p);
    float distExp = 1.0;
    if (bulge >= 0.0) {
        distExp = 1.0 + bulge; 
    } else {
        distExp = 1.0 / (1.0 + abs(bulge));
    }
    dist = pow(dist, distExp);

    // 5. Generate Ring Pattern (Range: 0.0 to 1.0)
    float rings = 0.5 + 0.5 * cos((dist * frequency * 2.0 * PI) + shiftStripes);

    // 6. Calculate Gradients
    float rGrad = dist * radialGrad;
    float gRad = radians(gradAngle);
    float lGrad = (p.x * cos(gRad) + p.y * sin(gRad)) * gradAdd;

    // 7. Combine for Master Timing Map
    float map = rings + rGrad + lGrad;

    // --- FIX: DYNAMIC RANGE SWEEP ---
    // Calculate the distance to the farthest possible corner based on the user's center offset.
    // This ensures we know exactly how far the gradient values stretch.
    vec2 maxCorner = vec2(0.5) + abs(center);
    float maxDist = length(maxCorner);

    // Calculate the maximum possible influence of the gradients
    float gradMag = (abs(radialGrad) * maxDist) + (abs(gradAdd) * maxDist);

    // Determine the absolute Minimum and Maximum values the "map" can possibly reach.
    // The rings are 0.0 to 1.0. The gradients subtract or add 'gradMag'.
    float mapMin = 0.0 - gradMag; 
    float mapMax = 1.0 + gradMag; 

    // Calculate the Threshold Range
    // We want the Wipe to travel from [Min - Softness] to [Max + Softness]
    // This guarantees the threshold fully clears the map at both ends.
    float startT = mapMin - edgeSoftness - 0.001;
    float endT = mapMax + edgeSoftness + 0.001;

    // Linearly interpolate the threshold based on wipePercent
    float threshold = mix(startT, endT, wipePercent);
    
    // 8. Compute Alpha
    // If map > threshold, we see Image (1.0). If map < threshold, we see Background (0.0).
    float alphaVal = smoothstep(threshold - edgeSoftness, threshold, map);

    // 9. Output Mix
    vec4 texFrom = texture2D(tDiffuse, vUvScaled);
    gl_FragColor = mix(backgroundColor, texFrom, vec4(alphaVal));
}
