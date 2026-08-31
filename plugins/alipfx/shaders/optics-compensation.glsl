precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;
varying vec2 vUv;
varying vec2 vUvScaled;

uniform float Field_Of_View;
uniform float Reverse_Lens_Distortion;
uniform float FOV_Orientation;
uniform vec2 View_Center;
uniform float Optimal_Pixels;
uniform float Resize;

#define M_PI 3.14159265359

void main()
{
    vec2 uv = vUvScaled;
    vec2 centerUV = (View_Center / resolution) * uvScale;
    
    // UV to pixel space
    vec2 deltaUV = uv - centerUV;
    vec2 deltaPixel = deltaUV / uvScale * resolution;

    // maxR based on FOV orientation ONLY (no aspect correction)
    float maxR;
    if (FOV_Orientation < 0.5) {
        maxR = resolution.x * 0.5;      // Horizontal: half width
    }
    else if (FOV_Orientation < 1.5) {
        maxR = resolution.y * 0.5;      // Vertical: half height
    }
    else {
        maxR = length(resolution) * 0.5; // Diagonal: half diagonal
    }

    // Raw pixel distance (NOT aspect-corrected)
    float r = length(deltaPixel);
    float rNorm = r / (maxR + 0.0001);
    rNorm = clamp(rNorm, 0.0, 5.0);

    // FOV calibration
    float k = Field_Of_View / 230.0;
    vec2 distortedPixel;

    if (Field_Of_View == 0.0) {
        distortedPixel = deltaPixel;
    }
    else if (Reverse_Lens_Distortion < 0.5) {
        // BARREL
        float r2 = rNorm * rNorm;
        float distortion = 1.0 + k * r2 + k * k * r2 * r2 * 0.5;
        distortedPixel = deltaPixel * distortion;
    }
    else {
        // REVERSE
        if (Optimal_Pixels < 0.5) {
            float r2 = rNorm * rNorm;
            float distortion = 1.0 / (1.0 + k * r2 + k * k * r2 * r2 * 0.5);
            distortedPixel = deltaPixel * distortion;
        }
        else {
            // SPHERE
            float fovRad = Field_Of_View * M_PI / 180.0;
            float angle = rNorm * fovRad * 0.5;
            angle = clamp(angle, 0.0, M_PI * 0.499);
            float sinA = sin(angle);
            float cosA = cos(angle);
            float sphereR = sinA / (cosA + 0.0001);
            float distortion = sphereR / (angle + 0.0001);
            float intensity = clamp(Field_Of_View / 180.0, 0.0, 1.0);
            distortion = mix(1.0, distortion, intensity);
            distortedPixel = deltaPixel * distortion;
        }
    }

    // RESIZE
    if (Reverse_Lens_Distortion > 0.5 && Resize > 0.5) {
        float maxScale = (Resize < 1.5) ? 2.0 : (Resize < 2.5) ? 4.0 : 100.0;
        float zoomFactor = 1.0 + k * 0.5;
        zoomFactor = min(zoomFactor, maxScale);
        distortedPixel = distortedPixel * zoomFactor;
    }

    // Back to UV and sample
    vec2 distortedUV = (distortedPixel / resolution) * uvScale;
    vec2 resultUV = centerUV + distortedUV;

    vec4 color;
    if (resultUV.x < 0.0 || resultUV.x > uvScale.x ||
        resultUV.y < 0.0 || resultUV.y > uvScale.y) {
        color = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
        color = texture2D(tDiffuse, resultUV);
    }

    gl_FragColor = color;
}
