precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;

// Custom properties linked from the Panzoid UI
uniform float Progress; 
uniform float Angle;    
uniform float Thickness; 
uniform float Intensity; 
uniform vec3 Slash_color; 

void main()
{
    // 1. Sample original footage
    vec4 baseColor = texture2D(tDiffuse, vUvScaled);

    // 2. Center UVs and rotate by Angle (degrees to radians)
    vec2 uv = vUv - 0.5;
    float angleRad = Angle * 0.0174532925;
    float s = sin(angleRad);
    float c = cos(angleRad);
    vec2 rotatedUv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

    float distY = abs(rotatedUv.y);
    float distX = rotatedUv.x;

    // --- PHASE 1: SLASH SHOOTING MOTION (Progress 0.0 to 0.25) ---
    float slashPhase = clamp(Progress / 0.25, 0.0, 1.0);
    float headPos = mix(-1.5, 1.5, slashPhase);
    float strokeMask = 1.0 - smoothstep(headPos - 0.4, headPos, distX);

    // Fix: Tiny fade-in guarantees no glow bleeding at Progress 0.0
    float slashFadeIn = smoothstep(0.0, 0.01, Progress); 
    float slashFadeOut = 1.0 - smoothstep(0.18, 0.35, Progress);
    float slashVisibility = strokeMask * slashFadeIn * slashFadeOut;

    // Core & glow calculations
    float slashCore = 1.0 - smoothstep(0.0, Thickness, distY);
    float slashGlow = 1.0 - smoothstep(0.0, Thickness * 5.0, distY);
    float totalSlash = (slashCore + (slashGlow * 0.5)) * Intensity * slashVisibility;
    vec3 finalSlashColor = Slash_color * totalSlash;

    // --- PHASE 2: DOUBLE-SIDED EXPANDING CUT (Progress 0.18 to 1.0) ---
    float cutPhase = clamp((Progress - 0.18) / 0.82, 0.0, 1.0);
    
    // Fix: Start cutWidth at -0.01 instead of 0.0 so the center line is fully solid at Progress 0
    float cutWidth = mix(-0.01, 1.2, cutPhase);
    float footageAlpha = smoothstep(cutWidth - 0.005, cutWidth + 0.005, distY);

    // Output masked footage with the animated slash overlay
    vec3 finalColor = (baseColor.rgb * footageAlpha) + finalSlashColor;
    float finalAlpha = max(baseColor.a * footageAlpha, totalSlash);

    gl_FragColor = vec4(finalColor, finalAlpha);
}
