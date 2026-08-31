precision highp float;
precision highp int;

// Panzoid Built-in Uniforms
uniform sampler2D tDiffuse;
uniform vec2 resolution;
varying vec2 vUvScaled;

// 9 Custom Properties (Configured as Floats / Colors)
uniform float Preset;
uniform vec3 Dark_Ink;
uniform vec3 Light_Ink;
uniform vec3 Paper;
uniform float Effect_Intensity;
uniform float Tone_Lift;
uniform float Halftone_Size;
uniform float Misregister;
uniform float Print_Roughness;

// Pseudo-random noise generator for organic print texture
float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Halftone screen generator function
float halftoneScreen(vec2 uv, float scale, float angle, float intensity) {
    float s = sin(angle);
    float c = cos(angle);
    vec2 rotUv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
    
    vec2 st = rotUv * scale;
    vec2 f = fract(st) - 0.5;
    float dist = length(f);
    
    // Smooth thresholding creates clean anti-aliased print dots
    float radius = intensity * 0.7071;
    return smoothstep(radius + 0.04, radius - 0.04, dist);
}

void main() {
    // Sample the source pixel
    vec4 texel = texture2D(tDiffuse, vUvScaled);
    
    // Initialize color channels with Custom parameter values
    vec3 darkColor = Dark_Ink;
    vec3 lightColor = Light_Ink;
    vec3 paperColor = Paper;
    
    // 1:1 Vayce.app Palette Presets Map
    float p = floor(Preset + 0.5);
    if (p == 1.0) {         // Fluoro Pink / Blue
        darkColor = vec3(0.137, 0.341, 1.0);
        lightColor = vec3(1.0, 0.282, 0.722);
        paperColor = vec3(0.973, 0.945, 0.890);
    } else if (p == 2.0) {  // Sunflower / Black
        darkColor = vec3(0.067, 0.067, 0.067);
        lightColor = vec3(1.0, 0.694, 0.0);
        paperColor = vec3(0.969, 0.937, 0.875);
    } else if (p == 3.0) {  // Aqua / Red
        darkColor = vec3(0.878, 0.294, 0.204);
        lightColor = vec3(0.157, 0.827, 0.761);
        paperColor = vec3(0.969, 0.945, 0.910);
    } else if (p == 4.0) {  // Purple / Kelly Green
        darkColor = vec3(0.353, 0.216, 1.0);
        lightColor = vec3(0.275, 0.780, 0.259);
        paperColor = vec3(0.965, 0.945, 0.906);
    } else if (p == 5.0) {  // Teal / Orange
        darkColor = vec3(0.063, 0.314, 0.341);
        lightColor = vec3(1.0, 0.416, 0.153);
        paperColor = vec3(0.973, 0.941, 0.878);
    } else if (p == 6.0) {  // Navy / Coral
        darkColor = vec3(0.094, 0.165, 0.341);
        lightColor = vec3(1.0, 0.420, 0.420);
        paperColor = vec3(0.984, 0.941, 0.902);
    } else if (p == 7.0) {  // Forest / Warm Red
        darkColor = vec3(0.078, 0.294, 0.208);
        lightColor = vec3(0.859, 0.294, 0.224);
        paperColor = vec3(0.961, 0.937, 0.890);
    } else if (p == 8.0) {  // Violet / Sun
        darkColor = vec3(0.325, 0.200, 0.843);
        lightColor = vec3(1.0, 0.788, 0.200);
        paperColor = vec3(0.984, 0.945, 0.898);
    }

    // Apply layer misregistration offsets
    vec2 misregVec = vec2(0.006, 0.004) * Misregister;
    vec2 uvDark = vUvScaled - misregVec;
    vec2 uvLight = vUvScaled + misregVec;

    // Separate ink layers and evaluate luminance
    vec4 texDark = texture2D(tDiffuse, clamp(uvDark, 0.0, 1.0));
    vec4 texLight = texture2D(tDiffuse, clamp(uvLight, 0.0, 1.0));
    
    float lumDark = dot(texDark.rgb, vec3(0.299, 0.587, 0.114));
    float lumLight = dot(texLight.rgb, vec3(0.299, 0.587, 0.114));

    // Generate high-frequency noise from Print Roughness
    float noise = rand(vUvScaled * resolution) * 2.0 - 1.0;
    float grain = noise * Print_Roughness * 0.25;

    // Calculate dynamic ink placement thresholds mapped to Tone Lift
    // Dark ink targets the shadows
    float inkDark = clamp((1.0 - lumDark) - Tone_Lift * 0.6 + grain * 0.4, 0.0, 1.0);
    
    // INVERTED FIX: Light ink targets the mid-to-bright areas, but preserves absolute whites as paper
    float rawInkLight = clamp(lumLight * 1.5 - 0.2 - Tone_Lift * 0.3, 0.0, 1.0);
    float whiteMask = smoothstep(0.85, 0.98, lumLight);
    float inkLight = clamp(mix(rawInkLight, 0.0, whiteMask) + grain * 0.4, 0.0, 1.0);

    // Dynamic dot scale mapping (higher value = chunkier, larger print screen dots)
    float aspect = resolution.x / resolution.y;
    vec2 aspectUv = vUvScaled * vec2(aspect, 1.0);
    float frequency = 160.0 / (0.02 + Halftone_Size * 4.5);

    // Compute angled screens (45° and 15°) to prevent modern moiré patterns
    float dotDark = halftoneScreen(aspectUv, frequency, 0.7854, inkDark);
    float dotLight = halftoneScreen(aspectUv, frequency, 0.2618, inkLight);

    // Layer ink distributions sequentially onto the textured paper stock background
    vec3 paperComposite = paperColor + vec3(grain * 0.03);
    vec3 mixedPass = mix(paperComposite, lightColor, dotLight);
    vec3 finalColor = mix(mixedPass, darkColor, dotDark);

    // Apply overall effect intensity slider overlay match
    gl_FragColor = vec4(mix(texel.rgb, finalColor, Effect_Intensity), texel.a);
}
