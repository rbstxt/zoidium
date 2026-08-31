precision highp float;
precision highp int;

// Panzoid Default Uniforms & Varyings
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
varying vec2 vUv;
uniform vec2 resolution;

// Required Animation Uniform (Create a dynamic property called "Time" in Panzoid and animate it)
uniform float Time;

// All Mode/Dropdown Properties converted to floats to prevent Panzoid binding flicker
uniform float Preset;
uniform float Look_Strength;
uniform float Brightness;
uniform float Contrast;
uniform float Color_Temperature;
uniform vec3 Tint;
uniform float Curvature;
uniform float Screen_Type;
uniform float Screen_Texture;
uniform float Scanlines;
uniform float Glow;
uniform float Edge_Brightness;
uniform float Phosphor_Trail; 
uniform float Vignette;
uniform float Color_Bleed;
uniform float Analog_Noise;
uniform float Signal_Damage;
uniform float Warp;
uniform float Sync_Drift;
uniform float Blanking;
uniform float Shutter_Strength;
uniform float Shutter_Readout;
uniform float Render_Quality;
uniform float GPU_Rendering;

// --- Helper Functions ---

// Pseudo-random noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// CRT Curvature Distortion
vec2 applyCurvature(vec2 uv, float curveAmount) {
    vec2 cc = uv - 0.5;
    float dist = dot(cc, cc);
    return uv + cc * (dist * curveAmount);
}

// Color Temperature adjustments (Using internal integer casting)
vec3 applyColorTemp(vec3 col, int temp) {
    if (temp == 0) {
        // Warm 5000K 
        return col * vec3(1.1, 1.05, 0.9);
    } else if (temp == 2) {
        // Cool 9300K 
        return col * vec3(0.9, 0.95, 1.15);
    }
    // Neutral 6500K
    return col;
}

// Subpixel Mask Patterns (Screen Type)
vec3 getScreenMask(vec2 uv, int type, float textureStrength) {
    vec2 fragCoord = uv * resolution;
    vec3 mask = vec3(1.0);
    
    if (type == 0) { // Dot Triad
        float pos = mod(fragCoord.x + mod(fragCoord.y, 2.0), 3.0);
        if (pos < 1.0) mask = vec3(1.0, 0.5, 0.5);
        else if (pos < 2.0) mask = vec3(0.5, 1.0, 0.5);
        else mask = vec3(0.5, 0.5, 1.0);
    } 
    else if (type == 1) { // Aperture Grille
        float pos = mod(fragCoord.x, 3.0);
        if (pos < 1.0) mask = vec3(1.0, 0.3, 0.3);
        else if (pos < 2.0) mask = vec3(0.3, 1.0, 0.3);
        else mask = vec3(0.3, 0.3, 1.0);
    } 
    else if (type == 2) { // Slot Mask
        float posx = mod(fragCoord.x, 3.0);
        float posy = mod(fragCoord.y, 3.0);
        mask = vec3(0.8) + 0.2 * sin(posx * 3.14) * sin(posy * 3.14);
    }
    
    return mix(vec3(1.0), mask, textureStrength * Look_Strength);
}

void main() {
    // Locally convert floats to safe integers using rounding (+0.5) to stop flickering
    int int_Preset = int(Preset + 0.5);
    int act_Mask = int(Screen_Type + 0.5);
    int act_Temp = int(Color_Temperature + 0.5);
    int int_Quality = int(Render_Quality + 0.5);

    // Default variable copies for presets
    float act_Curvature = Curvature;
    float act_Scanlines = Scanlines;
    float act_Damage = Signal_Damage;
    float act_Noise = Analog_Noise;
    float act_Glow = Glow;
    float act_Bleed = Color_Bleed;

    // --- PRESET SELECTION OVERRIDES ---
    if (int_Preset == 1) { // Clean Monitor
        act_Curvature = 0.05; act_Scanlines = 0.3; act_Noise = 0.05; act_Damage = 0.0; act_Mask = 1;
    } else if (int_Preset == 2) { // Consumer TV
        act_Curvature = 0.15; act_Scanlines = 0.5; act_Temp = 2; act_Bleed = 0.4; act_Mask = 2;
    } else if (int_Preset == 3) { // Arcade 240p
        act_Curvature = 0.2; act_Scanlines = 1.0; act_Glow = 0.8; act_Mask = 0;
    } else if (int_Preset == 4) { // Trinitron Crisp
        act_Curvature = 0.02; act_Scanlines = 0.6; act_Glow = 0.3; act_Mask = 1;
    } else if (int_Preset == 5) { // Vintage Tube
        act_Curvature = 0.3; act_Temp = 0; act_Glow = 1.0; act_Bleed = 0.7;
    } else if (int_Preset == 6) { // Broadcast Fail
        act_Damage = 1.0; act_Noise = 0.5; act_Bleed = 0.8; act_Curvature = 0.1;
    } else if (int_Preset == 7) { // RF Damage
        act_Noise = 1.0; act_Damage = 0.8; act_Bleed = 1.0; act_Curvature = 0.15;
    }

    // --- UV SETUP & WARP ---
    vec2 uv = vUvScaled;
    
    // Sync Drift (Vertical rolling)
    float drift = act_Damage * Sync_Drift * Time * 0.5;
    uv.y = fract(uv.y + drift);
    
    // Warp and Geometry Instability
    uv.x += sin(uv.y * 10.0 + Time) * Warp * 0.02 * Look_Strength;

    // Apply Curvature
    vec2 curvedUV = applyCurvature(uv, act_Curvature * Look_Strength);

    // Cutoff for screen edges (Blanking)
    if (curvedUV.x < (0.0 + Blanking * 0.1) || curvedUV.x > (1.0 - Blanking * 0.1) || 
        curvedUV.y < (0.0 + Blanking * 0.1) || curvedUV.y > (1.0 - Blanking * 0.1)) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // --- SIGNAL SAMPLING (With Color Bleed) ---
    float bleedOffset = act_Bleed * 0.005 * Look_Strength;
    
    // Simulated Glitch/Damage displacement
    float glitchOffset = (hash(vec2(curvedUV.y, Time)) - 0.5) * act_Damage * 0.1 * step(0.95, hash(vec2(Time, 1.0)));
    
    vec4 texR = texture2D(tDiffuse, curvedUV + vec2(bleedOffset + glitchOffset, 0.0));
    vec4 texG = texture2D(tDiffuse, curvedUV + vec2(glitchOffset, 0.0));
    vec4 texB = texture2D(tDiffuse, curvedUV + vec2(-bleedOffset + glitchOffset, 0.0));
    
    vec3 col = vec3(texR.r, texG.g, texB.b);
// --- PHOSPHOR TRAIL ---
// Bright pixels leave a horizontal persistence trail.

if (Phosphor_Trail > 0.001)
{
    vec2 px = vec2(1.0 / resolution.x, 0.0);

    vec3 trail1 = texture2D(tDiffuse,
        curvedUV - px * 1.5).rgb;

    vec3 trail2 = texture2D(tDiffuse,
        curvedUV - px * 3.5).rgb;

    vec3 trail3 = texture2D(tDiffuse,
        curvedUV - px * 6.0).rgb;

    vec3 trail4 = texture2D(tDiffuse,
        curvedUV - px * 10.0).rgb;

    vec3 persistence =
        trail1 * 0.45 +
        trail2 * 0.30 +
        trail3 * 0.18 +
        trail4 * 0.07;

    float lum =
        dot(col,
        vec3(0.2126,0.7152,0.0722));

    persistence *= lum;

    col += persistence *
           Phosphor_Trail *
           Look_Strength *
           0.65;
}
    // --- FAKE GLOW / HALATION ---
    if (act_Glow > 0.0 && int_Quality > 0) {
        float g_off = 0.005 * act_Glow;
        vec3 glowCol = texture2D(tDiffuse, curvedUV + vec2(g_off, g_off)).rgb;
        glowCol += texture2D(tDiffuse, curvedUV + vec2(-g_off, g_off)).rgb;
        glowCol += texture2D(tDiffuse, curvedUV + vec2(g_off, -g_off)).rgb;
        glowCol += texture2D(tDiffuse, curvedUV + vec2(-g_off, -g_off)).rgb;
        float highlight =
    max(col.r,
    max(col.g,col.b));

float bloomMask =
    smoothstep(
        0.55,
        1.0,
        highlight
    );

col +=
    (glowCol / 4.0)
    * bloomMask
    * act_Glow
    * Look_Strength
    * 0.6;
    }

    // --- COLOR CORRECTION ---
    col = applyColorTemp(col, act_Temp);
    col *= Tint; 
    col = (col - 0.5) * (Contrast + 1.0) + 0.5; 
    col *= (Brightness + 1.0); 

    // --- SCREEN TEXTURE & SCANLINES ---
    vec3 mask = getScreenMask(curvedUV, act_Mask, Screen_Texture);
    col *= mask;

    float scanline = sin(curvedUV.y * resolution.y * 3.1415);
    scanline = smoothstep(0.0, 1.0, scanline * 0.5 + 0.5);
    col = mix(col, col * scanline, act_Scanlines * Look_Strength);

    // --- NOISE & SHUTTER BANDING ---
    float noiseAmount = hash(curvedUV * Time) * act_Noise * 0.2 * Look_Strength;
    col += vec3(noiseAmount);

    float shutterBanding = sin(curvedUV.y * 20.0 - Time * Shutter_Readout * 10.0);
    col += shutterBanding * Shutter_Strength * 0.1 * Look_Strength;

    // --- VIGNETTE & EDGE BRIGHTNESS ---
    vec2 cc = curvedUV - 0.5;
    float dist = dot(cc, cc);
// --- VIGNETTE & EDGE BRIGHTNESS ---

vec2 crtVignetteUV = curvedUV - 0.5;
float crtVignetteDist = dot(crtVignetteUV, crtVignetteUV);

// soft CRT vignette
float crtVignetteMask = 1.0 - smoothstep(0.15, 0.55, crtVignetteDist) * Vignette;
col *= crtVignetteMask;

// subtle center focus
float crtCenterFocus = 1.0 - smoothstep(0.10, 0.40, crtVignetteDist);

float crtEdgeLift = crtCenterFocus * Edge_Brightness * Look_Strength;
col += col * crtEdgeLift * 0.25;
// CRT beam focus loss near edges

float centerWeight =
    1.0 -
    smoothstep(
        0.15,
        0.45,
        dist
    );

float edgeBoost =
    centerWeight *
    Edge_Brightness *
    Look_Strength;

col += col * edgeBoost * 0.25;

    gl_FragColor = vec4(col, 1.0);
}
