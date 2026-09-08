precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --- Editable Uniforms ---
uniform float u_skewStrength;    
uniform float u_skewAngle;      // Now treated as DEGREES
uniform vec2 u_resolution;      
uniform vec2 u_tileOffset;      
uniform float u_mirrorEdges;    // 1.0 for mirrored, 0.0 for repeat

void main()
{
    // 1. Aspect Correction
    vec2 uv = vUvScaled - 0.5;
    float aspect = u_resolution.x / u_resolution.y;
    uv.x *= aspect;

    // 2. Calculate Skew
    // --- CHANGE: Convert degrees to radians here ---
    float angleRad = radians(u_skewAngle); 
    vec2 skewDir = vec2(cos(angleRad), sin(angleRad));
    
    vec2 perpDir = vec2(-skewDir.y, skewDir.x);
    float skewFactor = dot(uv, perpDir) * u_skewStrength;
    
    // 3. Displacement
    // We keep the original vUvScaled as the base to maintain orientation
    vec2 skewedUv = vUvScaled + (skewDir * skewFactor) + u_tileOffset;

    // 4. MIRROR TILE LOGIC (Fixed for Orientation)
    vec2 finalUv;

    if (u_mirrorEdges > 0.5) {
        // Improved Mirror Formula: 
        // This version ensures that at skewedUv = 0.5, finalUv is 0.5 (no flip)
        vec2 m = mod(skewedUv, 2.0);
        finalUv.x = m.x > 1.0 ? 2.0 - m.x : m.x;
        finalUv.y = m.y > 1.0 ? 2.0 - m.y : m.y;
        
        // Safety: ensure no edge-case values hit 1.0/0.0 exactly in a way that flips
        finalUv = clamp(finalUv, 0.001, 0.999);
    } else {
        // Standard Repeat
        finalUv = fract(skewedUv);
    }

    // 5. Sample the texture
    gl_FragColor = texture2D(tDiffuse, finalUv);
}
