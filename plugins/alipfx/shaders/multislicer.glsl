precision highp float;
precision highp int;

// Panzoid Built-in Variables
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec2 uvScale;
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom MultiSlicer Properties
uniform float Shift;
uniform float Width;
uniform float Number_of_Slices;
uniform vec2 Anchor_Point;
uniform float Angle;
uniform float Seed;

// Pseudo-random function based on slice index
float rand(float n) {
    return fract(sin(n) * 43758.5453123);
}

void main() {
    // 1. Get exact pixel coordinates
    vec2 pixelPos = vUv * resolution;

    // 2. Offset by Anchor Point
    vec2 pos = pixelPos - Anchor_Point;

    // 3. Rotation Math
    float rad = radians(Angle);
    float c = cos(rad);
    float s = sin(rad);
    
    mat2 rot = mat2(c, -s, s, c);
    vec2 rotatedPos = rot * pos;

    // 4. Slicing Math
    float maxDim = max(resolution.x, resolution.y) * 2.0;
    float safeSlices = max(Number_of_Slices, 1.0);
    float sliceThickness = maxDim / safeSlices;

    float sliceIndex = floor(rotatedPos.y / sliceThickness);

    // 5. Apply Random Shift per slice
    float randomVal = rand(sliceIndex + (Seed * 123.456));
    float currentShift = Shift * (randomVal * 2.0 - 1.0);
    rotatedPos.x -= currentShift;

    // 6. Calculate Width Masking (The Fix)
    // Find where the current pixel sits vertically inside its specific slice
    float localY = mod(rotatedPos.y, sliceThickness);
    
    // Treat Width as a percentage (e.g., 100.0 = full thickness, 50.0 = half thickness)
    float visibleThickness = sliceThickness * (Width / 100.0);

    // 7. Inverse Rotation
    mat2 invRot = mat2(c, s, -s, c);
    vec2 newPos = invRot * rotatedPos;
    newPos += Anchor_Point;

    // 8. Convert back to Normalized UVs
    vec2 finalUv = newPos / resolution;

    // 9. Mask and Render
    // If the pixel falls outside the canvas OR outside the "Width" of the slice, make it transparent
    if (finalUv.x < 0.0 || finalUv.x > 1.0 || finalUv.y < 0.0 || finalUv.y > 1.0 || localY > visibleThickness) {
        gl_FragColor = vec4(0.0);
    } else {
        gl_FragColor = texture2D(tDiffuse, finalUv * uvScale);
    }
}
