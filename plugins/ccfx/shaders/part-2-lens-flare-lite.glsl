precision highp float;

// --------------------------------------------------------------------------
// VARYINGS & INPUTS
// --------------------------------------------------------------------------
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;

// --------------------------------------------------------------------------
// UNIFIED EDITABLE PARAMETERS (UNIFORMS)
// --------------------------------------------------------------------------

// --- GLOBAL CONTROLS ---
// 0.0 = Anamorphic, 1.0 = Geometric, 2.0 = Orbs
uniform float uMode;             

uniform vec2 uResolution;        // Canvas resolution (width, height)
uniform vec2 uFlarePosition;     // 0.0 to 1.0 (0.5, 0.5 is center)
uniform float uFlareBrightness;  // Global Brightness Multiplier
uniform vec3 uFlareColor;        // Global Color Tint

// --- MODE 0 SPECIFIC (Anamorphic) ---
uniform float uAnamorphicStretch;    // Width. Range: 0.0 to 3.0 (Multiplied internally)
uniform float uAnamorphicHeight;     // NEW: Thickness. Range: 5.0 (Thick) to 50.0 (Thin)
uniform float uAnamorphicBrightness; // Brightness.
uniform float uGhostDispersal;       // Spread of ghosts.

// --- MODE 1 SPECIFIC (Geometric) ---
uniform float uTime;             

// --- MODE 2 SPECIFIC (Orbs) ---
uniform float uScale;            
uniform float uDistortion;       

// --------------------------------------------------------------------------
// MODE 0 HELPER FUNCTIONS (Anamorphic & Ghosts)
// --------------------------------------------------------------------------

vec3 genAnamorphicShape(vec2 uv, float stretch, float thickness, float brightness) {
    // 1. Safety max to prevent division by zero
    float safeStretch = max(stretch, 1.0); 
    float safeThickness = max(thickness, 1.0);

    vec2 scaledUv = uv;
    
    // 2. Horizontal Stretch
    scaledUv.x /= safeStretch; 
    
    // 3. Vertical Thickness (Height)
    // Controlled by the new uAnamorphicHeight uniform
    scaledUv.y *= safeThickness; 
    
    // 4. Gradient Generation
    // Increased base radius from 0.2 to 0.5 to allow longer tails
    float streak = smoothstep(0.5, 0.0, length(scaledUv));
    
    // 5. Sharpening
    // Reduced power from 4.0 to 3.0 to keep the streak visible longer
    streak = pow(streak, 3.0);
    
    return vec3(streak) * brightness;
}

vec3 lensflaresMode0(vec2 uv, vec2 pos, float dispersal) {
    vec2 mainVec = uv - pos;
    vec2 uvd = uv * (length(uv));
    float ang = atan(mainVec.y, mainVec.x);
    float dist = length(mainVec);
    dist = pow(dist, 0.1);

    // Sun Glow
    float f0 = 1.0 / (length(uv - pos) * 25.0 + 1.0);
    f0 = pow(f0, 2.0);
    f0 = f0 + f0 * (sin((ang + 1.0 / 18.0) * 12.0) * 0.1 + dist * 0.1 + 0.8);

    // Ghosts
    float f2  = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.8 * dispersal * pos), 2.0)), 0.0) * 0.25;
    float f22 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.85 * dispersal * pos), 2.0)), 0.0) * 0.23;
    float f23 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.9 * dispersal * pos), 2.0)), 0.0) * 0.21;

    vec2 uvx = mix(uv, uvd, -0.5);
    float f4  = max(0.01 - pow(length(uvx + 0.4 * dispersal * pos), 2.4), 0.0) * 6.0;
    float f42 = max(0.01 - pow(length(uvx + 0.45 * dispersal * pos), 2.4), 0.0) * 5.0;
    float f43 = max(0.01 - pow(length(uvx + 0.5 * dispersal * pos), 2.4), 0.0) * 3.0;

    uvx = mix(uv, uvd, -0.4);
    float f5  = max(0.01 - pow(length(uvx + 0.2 * dispersal * pos), 5.5), 0.0) * 2.0;
    float f52 = max(0.01 - pow(length(uvx + 0.4 * dispersal * pos), 5.5), 0.0) * 2.0;
    float f53 = max(0.01 - pow(length(uvx + 0.6 * dispersal * pos), 5.5), 0.0) * 2.0;

    uvx = mix(uv, uvd, -0.5);
    float f6  = max(0.01 - pow(length(uvx - 0.3 * dispersal * pos), 1.6), 0.0) * 6.0;
    float f62 = max(0.01 - pow(length(uvx - 0.325 * dispersal * pos), 1.6), 0.0) * 3.0;
    float f63 = max(0.01 - pow(length(uvx - 0.35 * dispersal * pos), 1.6), 0.0) * 5.0;

    vec3 lensflare = vec3(f2 + f4 + f5 + f6, f22 + f42 + f52 + f62, f23 + f43 + f53 + f63);
    return vec3(f0) + lensflare;
}

// --------------------------------------------------------------------------
// MODE 1 HELPER FUNCTIONS (Geometric)
// --------------------------------------------------------------------------
float rnd_float(float w) {
    float f = fract(sin(w) * 1000.0);
    return f;
}
float regShape(vec2 p, float N) {
    float f;
    float a = atan(p.x, p.y) + 0.2;
    float b = 6.28319 / N;
    f = smoothstep(0.5, 0.51, cos(floor(0.5 + a / b) * b - a) * length(p.xy));
    return f;
}
vec3 circleMode1(vec2 p, float size, float decay, vec3 colorInput, vec3 colorInput2, float dist, vec2 mouse) {
    float l = length(p + mouse * (dist * 4.0)) + size / 2.0;
    float c = max(0.01 - pow(length(p + mouse * dist), size * 1.4), 0.0) * 50.0;
    float c1 = max(0.001 - pow(l - 0.3, 1.0 / 40.0) + sin(l * 30.0), 0.0) * 3.0;
    float c2 = max(0.04 / pow(length(p - mouse * dist / 2.0 + 0.09) * 1.0, 1.0), 0.0) / 20.0;
    float s = max(0.01 - pow(regShape(p * 5.0 + mouse * dist * 5.0 + 0.9, 6.0), 1.0), 0.0) * 5.0;
    vec3 col = 0.5 + 0.5 * sin(colorInput);
    col = cos(vec3(0.44, 0.24, 0.2) * 8.0 + dist * 4.0) * 0.5 + 0.5;
    vec3 f = c * col; f += c1 * col; f += c2 * col; f += s * col;
    return f - 0.01;
}

// --------------------------------------------------------------------------
// MODE 2 HELPER FUNCTIONS (Orbs)
// --------------------------------------------------------------------------
#define ORB_FLARE_COUNT 6.0
vec2 GetDistOffset(vec2 uv, vec2 pxoffset) {
    vec2 tocenter = uv.xy;
    vec3 prep = normalize(vec3(tocenter.y, -tocenter.x, 0.0));
    float angle = length(tocenter.xy) * 2.221 * uDistortion;
    vec3 oldoffset = vec3(pxoffset, 0.0);
    vec3 rotated = oldoffset * cos(angle) + cross(prep, oldoffset) * sin(angle) + prep * dot(prep, oldoffset) * (1.0 - cos(angle));
    return rotated.xy;
}
float glareMode2(vec2 uv, vec2 pos, float size) {
    vec2 main = uv - pos;
    float ang = atan(main.y, main.x);
    float dist = length(main); dist = pow(dist, 0.1);
    float f0 = 1.0 / (length(uv - pos) * (1.0 / size * 16.0) + 1.0);
    return f0 + f0 * (sin((ang) * 8.0) * 0.2 + dist * 0.1 + 0.9);
}
vec3 flareMode2Calc(vec2 uv, vec2 pos, float dist, float size) {
    pos = GetDistOffset(uv, pos);
    float r = max(0.01 - pow(length(uv + (dist - 0.05) * pos), 2.4) * (1.0 / (size * 2.0)), 0.0) * 6.0;
    float g = max(0.01 - pow(length(uv +  dist         * pos), 2.4) * (1.0 / (size * 2.0)), 0.0) * 6.0;
    float b = max(0.01 - pow(length(uv + (dist + 0.05) * pos), 2.4) * (1.0 / (size * 2.0)), 0.0) * 6.0;
    return vec3(r, g, b);
}
vec3 flareMode2Color(vec2 uv, vec2 pos, float dist, float size, vec3 color) {
    return flareMode2Calc(uv, pos, dist, size) * color;
}
vec3 orbMode2(vec2 uv, vec2 pos, float dist, float size) {
    vec3 c = vec3(0.0);
    for(float i = 0.0; i < ORB_FLARE_COUNT; i += 1.0) {
        float j = i + 1.0;
        float offset = j / (j + 1.0);
        float colOffset = j / (ORB_FLARE_COUNT * 2.0);
        c += flareMode2Color(uv, pos, dist + offset, size / (j + 0.1), vec3(1.0 - colOffset, 1.0, 0.5 + colOffset));
    }
    c += flareMode2Color(uv, pos, dist + 0.5, 4.0 * size, vec3(1.0)) * 4.0;
    return c / 4.0;
}
vec3 ringMode2(vec2 uv, vec2 pos, float dist) {
    vec2 uvd = uv * (length(uv));
    float r = max(1.0 / (1.0 + 32.0 * pow(length(uvd + (dist - 0.05) * pos), 2.0)), 0.0) * 0.25;
    float g = max(1.0 / (1.0 + 32.0 * pow(length(uvd +  dist         * pos), 2.0)), 0.0) * 0.23;
    float b = max(1.0 / (1.0 + 32.0 * pow(length(uvd + (dist + 0.05) * pos), 2.0)), 0.0) * 0.21;
    return vec3(r, g, b);
}

// --------------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------------
void main() {
    float aspect = uResolution.x / uResolution.y;
    
    vec2 uv = vUvScaled - 0.5;
    uv.x *= aspect;
    
    vec2 mouse = uFlarePosition - 0.5;
    mouse.x *= aspect;

    vec4 original = texture2D(tDiffuse, vUvScaled);
    vec3 flareResult = vec3(0.0);

    // MODE 0: Anamorphic
    if (uMode < 0.5) { 
        // 1. Ghosts
        vec3 flare = lensflaresMode0(uv * 1.5, mouse * 1.5, uGhostDispersal);
        
        // 2. Anamorphic Streak
        vec3 anflare = genAnamorphicShape(
            uv - mouse, 
            2.0 * uAnamorphicStretch, 
            uAnamorphicHeight, 
            uAnamorphicBrightness
        );
        
        flareResult = (flare + anflare);
        
        // Tone mapping
        flareResult = pow(flareResult, vec3(1.0 / 2.2));
    
    // MODE 1: Geometric
    } else if (uMode < 1.5) {
        vec3 circColor = vec3(0.9, 0.2, 0.1); 
        vec3 circColor2 = vec3(0.3, 0.1, 0.5);

        flareResult = mix(vec3(0.0), vec3(0.0), uv.y) * 3.0 - 0.52 * sin(uTime / 0.4) * 0.1 + 0.2;
        
        for (float i = 0.0; i < 10.0; i += 1.0) {
            flareResult += circleMode1(uv, pow(rnd_float(i * 2000.0) * 1.0, 2.0) + 1.41, 0.0, circColor + i, circColor2 + i, rnd_float(i * 20.0) * 3.0 + 0.2 - 0.5, mouse);
        }
        
        float a = atan(uv.y - mouse.y, uv.x - mouse.x);
        flareResult += max(0.1 / pow(length(uv - mouse) * 5.0, 5.0), 0.0) * abs(sin(a * 5.0 + cos(a * 9.0))) / 20.0;
        flareResult += max(0.1 / pow(length(uv - mouse) * 10.0, 1.0 / 20.0), 0.0) + abs(sin(a * 3.0 + cos(a * 9.0))) / 8.0 * (abs(sin(a * 9.0))) / 1.0;
        flareResult += (max(0.1 / pow(length(uv - mouse) * 4.0, 1.0 / 2.0), 0.0) * 4.0) * vec3(0.2, 0.21, 0.3) * 4.0;
        
        flareResult *= exp(1.0 - length(uv - mouse)) / 5.0;

    // MODE 2: Orbs
    } else {
        flareResult = vec3(glareMode2(uv, mouse, uScale));
        flareResult += flareMode2Calc(uv, mouse, -3.0, 3.0 * uScale);
        flareResult += flareMode2Calc(uv, mouse, -1.0, uScale) * 3.0;
        flareResult += flareMode2Calc(uv, mouse,  0.5, 0.8 * uScale);
        flareResult += flareMode2Calc(uv, mouse, -0.4, 0.8 * uScale);
        flareResult += orbMode2(uv, mouse, 0.0, 0.5 * uScale);
        flareResult += ringMode2(uv, mouse, -1.0) * 0.5 * uScale;
        flareResult += ringMode2(uv, mouse,  1.0) * 0.5 * uScale;
    }

    // Color Tint & Global Brightness
    flareResult *= uFlareColor * uFlareBrightness;
    
    vec3 finalColor = original.rgb + flareResult;
    gl_FragColor = vec4(finalColor, original.a);
}
