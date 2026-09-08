precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform float uTime; 

varying vec2 vUvScaled;

// Original variables
uniform float uAmplitude;      
uniform float uFrequency;      
uniform float uAngle;          
uniform float uDisplaceAngle;  
uniform float uPhaseStart;     
uniform float uPhaseSpeed;     

// New variables
uniform bool uMirrorEdges; // Toggle: True = Mirror/Motion Tile, False = Clamp

void main()
{
    float angleRad = radians(uAngle);
    float displaceRad = radians(uAngle + uDisplaceAngle);
    
    vec2 dir = vec2(cos(angleRad), sin(angleRad));
    vec2 displaceDir = vec2(cos(displaceRad), sin(displaceRad));
    
    float wavePos = dot(vUvScaled, dir) * uFrequency;
    float totalPhase = uPhaseStart + (uTime * uPhaseSpeed);
    
    float wave = sin(wavePos + totalPhase) * uAmplitude;
    
    // Calculate the distorted UV
    vec2 distortedUv = vUvScaled + (displaceDir * wave);
    
    // --- UV Handling (Mirror vs Clamp) ---
    vec2 finalUv;
    
    if (uMirrorEdges) {
        // Motion Tile Logic: Reflects the UVs back and forth
        // abs(1.0 - mod(abs(uv), 2.0)) creates a 0->1->0 mirrored loop
        finalUv = abs(mod(distortedUv - 1.0, 2.0) - 1.0);
    } else {
        // Simple Clamp Logic: Keeps UVs within [0.0, 1.0]
        finalUv = clamp(distortedUv, 0.0, 1.0);
    }
    
    vec4 texel = texture2D(tDiffuse, finalUv);
    gl_FragColor = texel;
}
