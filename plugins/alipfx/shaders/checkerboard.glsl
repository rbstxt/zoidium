precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

uniform vec2 Anchor;
uniform int Size_from;
uniform vec2 Corner_Point;
uniform float Width;
uniform float Height;
uniform float Feather_Width;
uniform float Feather_Height;
uniform vec3 Color;
uniform float Opacity;
uniform int Blending_mode;

varying vec2 vUvScaled;

// Convert RGB to HSL
vec3 rgbToHsl(vec3 color) {
    float maxC = max(max(color.r, color.g), color.b);
    float minC = min(min(color.r, color.g), color.b);
    float delta = maxC - minC;

    float h = 0.0;
    if (delta > 0.0) {
        if (maxC == color.r) {
            h = mod((color.g - color.b) / delta, 6.0);
        } else if (maxC == color.g) {
            h = (color.b - color.r) / delta + 2.0;
        } else {
            h = (color.r - color.g) / delta + 4.0;
        }
        h /= 6.0;
    }
    float l = (maxC + minC) * 0.5;
    float s = (delta == 0.0) ? 0.0 : delta / (1.0 - abs(2.0 * l - 1.0));
    return vec3(h, s, l);
}

// Convert HSL to RGB
vec3 hslToRgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;

    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c / 2.0;

    vec3 rgb;
    if (h < 1.0/6.0) rgb = vec3(c, x, 0.0);
    else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
    else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
    else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
    else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
    else rgb = vec3(c, 0.0, x);

    return rgb + m;
}

// Blending modes
vec4 blendModes(vec4 base, vec4 blend, int mode) {
    if (mode == 0) return blend; // None
    if (mode == 1) return mix(base, blend, blend.a); // Normal
    if (mode == 2) return vec4(blend.rgb * base.a, base.a); // Stencil Alpha
    if (mode == 3) return base + blend; // Add
    if (mode == 4) return base * blend; // Multiply
    if (mode == 5) return 1.0 - (1.0 - base) * (1.0 - blend); // Screen
    if (mode == 6) return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(0.5, base.r)); // Overlay
    if (mode == 7) return mix(2.0 * blend * base, base + blend - 2.0 * base * blend, step(0.5, blend.r)); // Soft Light
    if (mode == 8) return mix(2.0 * base * blend, base + blend - 2.0 * base * blend, step(0.5, base.r)); // Hard Light
    if (mode == 9) return base / (1.0 - blend); // Color Dodge
    if (mode == 10) return 1.0 - (1.0 - base) / blend; // Color Burn
    if (mode == 11) return min(base, blend); // Darken
    if (mode == 12) return max(base, blend); // Lighten
    if (mode == 13) return abs(base - blend); // Difference
    if (mode == 14) return base + blend - 2.0 * base * blend; // Exclusion

    // Advanced HSL-based modes
    vec3 baseHSL = rgbToHsl(base.rgb);
    vec3 blendHSL = rgbToHsl(blend.rgb);

    if (mode == 15) return vec4(hslToRgb(vec3(blendHSL.x, baseHSL.y, baseHSL.z)), base.a); // Hue
    if (mode == 16) return vec4(hslToRgb(vec3(baseHSL.x, blendHSL.y, baseHSL.z)), base.a); // Saturation
    if (mode == 17) return vec4(hslToRgb(vec3(blendHSL.x, blendHSL.y, baseHSL.z)), base.a); // Color
    if (mode == 18) return vec4(hslToRgb(vec3(baseHSL.x, baseHSL.y, blendHSL.z)), base.a); // Luminosity

    return blend;
}

void main() {
    vec2 uv = vUvScaled;

    float cellWidth = max(Width, 1.0);
    float cellHeight = (Size_from == 2) ? max(Height, 1.0) : cellWidth;

    if (Size_from == 0) {
        cellWidth = max(abs(Corner_Point.x - Anchor.x), 1.0);
        cellHeight = max(abs(Corner_Point.y - Anchor.y), 1.0);
    }

    float xIndex = floor((uv.x * resolution.x - Anchor.x) / cellWidth);
    float yIndex = floor((uv.y * resolution.y - Anchor.y) / cellHeight);
    float checker = mod(xIndex + yIndex, 2.0);

    // Correct feather logic (soften edges without shrinking)
    float edgeX = abs(fract((uv.x * resolution.x - Anchor.x) / cellWidth) - 0.5);
    float edgeY = abs(fract((uv.y * resolution.y - Anchor.y) / cellHeight) - 0.5);

    float fx = 1.0 - smoothstep(0.5 - 0.01 * Feather_Width, 0.5, edgeX);
    float fy = 1.0 - smoothstep(0.5 - 0.01 * Feather_Height, 0.5, edgeY);
    float feather = fx * fy;

    vec4 baseTexel = texture2D(tDiffuse, uv);
    vec4 checkerColor = vec4(Color, Opacity) * (checker < 1.0 ? 1.0 : 0.0);

    if (Feather_Width > 0.0 || Feather_Height > 0.0) {
        checkerColor *= feather; // Apply softness without shrinking
    }

    if (Blending_mode == 0) {
        gl_FragColor = checkerColor;
        return;
    }

    gl_FragColor = blendModes(baseTexel, checkerColor, Blending_mode);
}
