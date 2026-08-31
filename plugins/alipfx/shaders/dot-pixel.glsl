precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom properties from Panzoid
uniform vec2 Image_Center;
uniform float Dimension_Factor;
uniform float Outer_Roundness;
uniform float Inner_Radius;
uniform float Shading;
uniform float Shading_Type;  // 0 = Sphere, 1 = Ring
uniform float Fill_Background;  // 0 = Disabled, 1 = Enabled
uniform vec3 BG_Color;

// Helper function to convert UV to pixel coordinates
vec2 uvToPixel(vec2 uv) {
    return uv * resolution;
}

// Helper function to convert pixel coordinates to UV
vec2 pixelToUv(vec2 pixel) {
    return pixel / resolution;
}

void main()
{
    // Get the current pixel position in screen space
    vec2 pixelPos = uvToPixel(vUvScaled);

    // The center point in pixel coordinates
    vec2 centerPixel = Image_Center;

    // Calculate the relative position from the center
    vec2 relPos = pixelPos - centerPixel;

    // Dimension Factor determines the size of each pixel block
    // Higher Dimension Factor = larger blocks
    float blockSize = max(Dimension_Factor, 1.0);

    // Calculate which block this pixel belongs to
    // Using floor to create the pixelation effect
    vec2 blockIndex = floor(relPos / blockSize);
    vec2 blockCenter = (blockIndex + 0.5) * blockSize + centerPixel;

    // Calculate the position within the block (0 to 1 range within block)
    vec2 withinBlock = (relPos - blockIndex * blockSize) / blockSize;
    vec2 centeredWithinBlock = withinBlock - 0.5;

    // Distance from center of block (0 to ~0.707 at corners)
    float distFromBlockCenter = length(centeredWithinBlock);

    // Sample the original image at the block center to get the color
    vec2 blockCenterUv = pixelToUv(blockCenter);
    vec4 texel = texture2D(tDiffuse, blockCenterUv);

    // Calculate outer radius threshold
    // Outer Roundness: higher value = smaller circles
    // When Outer Roundness is 0, circles fill the entire block (touching neighbors)
    // When Outer Roundness increases, circles get smaller
    // The default in AE was 16 with block size 12, giving rings

    // Map Outer Roundness to an actual radius
    // At 0, radius is 0.5 (fills block, touching neighbors)
    // As Outer Roundness increases, radius decreases
    float outerRadius = max(0.5 - Outer_Roundness / (2.0 * blockSize), 0.0);

    // Alternative interpretation: Outer Roundness directly controls the gap
    // Let's match the video behavior:
    // At Outer_Roundness = 16, blockSize = 12: we see distinct circles with gaps
    // At Outer_Roundness = 0, blockSize = 6: circles are larger, almost touching

    // The outer radius in block-space (0 to 0.5)
    // When blockSize is small, same Outer_Roundness should give same visual gap
    float outerRadiusBlock = max(0.5 - Outer_Roundness / (2.0 * max(blockSize, 1.0)), 0.0);

    // Inner radius in block-space
    // Inner Radius controls the hole in the ring
    // Higher Inner Radius = larger hole = thinner ring
    float innerRadiusBlock = min(Inner_Radius / (2.0 * max(blockSize, 1.0)), outerRadiusBlock);

    // Determine if this pixel is inside the circle/ring
    float inCircle = step(distFromBlockCenter, outerRadiusBlock);
    float inHole = step(distFromBlockCenter, innerRadiusBlock);
    float inRing = inCircle * (1.0 - inHole);

    // Calculate shading
    float shadingValue = 0.0;
    if (Shading > 0.0) {
        if (Shading_Type < 0.5) {
            // Sphere shading - creates 3D sphere look
            // Based on distance from center, creating a gradient
            float normalizedDist = distFromBlockCenter / max(outerRadiusBlock, 0.001);
            // Sphere shading: brighter in center, darker at edges
            // Using sqrt(1 - r^2) for hemisphere projection
            if (normalizedDist < 1.0) {
                shadingValue = sqrt(1.0 - normalizedDist * normalizedDist) * Shading;
            }
        } else {
            // Ring shading - shading only on the ring itself
            // Creates a 3D tube/ring appearance
            float normalizedDist = distFromBlockCenter / max(outerRadiusBlock, 0.001);
            float ringCenter = (outerRadiusBlock + innerRadiusBlock) / (2.0 * max(outerRadiusBlock, 0.001));
            float ringWidth = (outerRadiusBlock - innerRadiusBlock) / max(outerRadiusBlock, 0.001);

            if (normalizedDist > innerRadiusBlock / max(outerRadiusBlock, 0.001) && 
                normalizedDist < 1.0) {
                // Cross-section of a tube
                float tubeDist = abs(normalizedDist - (outerRadiusBlock + innerRadiusBlock) / (2.0 * outerRadiusBlock));
                tubeDist = tubeDist / max((outerRadiusBlock - innerRadiusBlock) / (2.0 * outerRadiusBlock), 0.001);
                if (tubeDist < 1.0) {
                    shadingValue = sqrt(1.0 - tubeDist * tubeDist) * Shading;
                }
            }
        }
    }

    // Apply shading to color
    vec3 finalColor = texel.rgb;
    if (Shading > 0.0) {
        if (Shading_Type < 0.5) {
            // Sphere: multiply by shading (darker at edges)
            finalColor = finalColor * (0.5 + 0.5 * shadingValue);
        } else {
            // Ring: add shading highlight
            finalColor = finalColor + vec3(shadingValue * 0.5);
        }
    }

    // Output color
    vec4 outputColor;
    if (inRing > 0.5) {
        outputColor = vec4(finalColor, texel.a);
    } else {
        // Outside the ring
        if (Fill_Background > 0.5) {
            outputColor = vec4(BG_Color, 1.0);
        } else {
            outputColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
    }

    gl_FragColor = outputColor;
}
