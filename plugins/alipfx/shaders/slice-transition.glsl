precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution;

varying vec2 vUv;
varying vec2 vUvScaled;

// Custom dynamic properties defined in Panzoid UI
uniform float Progress;
uniform float Slice_Count;
uniform float Distortion;
uniform float Stagger;

void main()
{
    float count = max(Slice_Count, 1.0);
    
    // Calculate current vertical slice index
    float sliceIndex = floor(vUv.x * count);
    
    // Calculate normalized slice position (0.0 for first slice, 1.0 for last slice)
    float normalizedIndex = (count > 1.0) ? (sliceIndex / (count - 1.0)) : 0.0;
    
    // Stagger controls delay spread (1.0 = strict 1-by-1 sequence, 0.0 = all at once)
    float staggerAmount = clamp(Stagger, 0.0, 0.99);
    float delay = normalizedIndex * staggerAmount;
    float duration = 1.0 - staggerAmount;
    
    // Calculate individual slice progress based on current global Progress
    float sliceProgress = clamp((Progress - delay) / duration, 0.0, 1.0);
    
    // Alternating up/down directions for neighboring slices
    float direction = (mod(sliceIndex, 2.0) < 1.0) ? 1.0 : -1.0;
    
    // Calculate vertical displacement for this slice
    float shift = direction * sliceProgress * max(Distortion, 1.0);
    
    vec2 targetUv = vUv;
    targetUv.y += shift;
    
    // Render transparent black when shifted outside the frame bounds
    if (targetUv.y < 0.0 || targetUv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
        // Sample texture using Panzoid buffer scale multiplier
        gl_FragColor = texture2D(tDiffuse, targetUv * uvScale);
    }
}
