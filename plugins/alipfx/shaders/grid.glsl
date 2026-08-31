precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;

// Parameters
uniform vec2 Anchor;                // Anchor position
uniform int Size_from;              // 0 = Corner Point, 1 = Width, 2 = Width & Height
uniform vec2 Corner_Point;          // Used if Size_from = 0
uniform float Width;                // Used if Size_from = 1 or 2
uniform float Height;               // Used if Size_from = 2
uniform float Border;               // Thickness of grid lines
uniform float Feather_Width;        // Horizontal feather softness
uniform float Feather_Height;       // Vertical feather softness
uniform int Invert_grid;            // 0 = normal, 1 = inverted
uniform vec3 Color;                 // Grid color
uniform float Opacity;              // Opacity
uniform int Blending_mode;          // 0–18 blending modes

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

    // Determine cell size
    float cellWidth = max(Width, 1.0);
    float cellHeight = (Size_from == 2) ? max(Height, 1.0) : cellWidth;

    if (Size_from == 0) {
        cellWidth = max(abs(Corner_Point.x - Anchor.x), 1.0);
        cellHeight = max(abs(Corner_Point.y - Anchor.y), 1.0);
    }

    // Compute grid lines
    float posX = (uv.x * resolution.x - Anchor.x);
    float posY = (uv.y * resolution.y - Anchor.y);

    float distX = abs(fract(posX / cellWidth) - 0.5) * cellWidth;
    float distY = abs(fract(posY / cellHeight) - 0.5) * cellHeight;

    float lineX = step(distX, Border);
    float lineY = step(distY, Border);
    float grid = (Invert_grid == 1) ? (1.0 - max(lineX, lineY)) : max(lineX, lineY);

    // Feather softness
    float fx = smoothstep(0.0, Feather_Width, distX - Border);
    float fy = smoothstep(0.0, Feather_Height, distY - Border);
    float feather = 1.0 - (fx * fy);
    feather = clamp(feather, 0.3, 1.0); // Prevent full fade for visibility

    vec4 baseTexel = texture2D(tDiffuse, uv);
    vec4 gridColor = vec4(Color, Opacity) * grid * feather;

    if (Blending_mode == 0) {
        gl_FragColor = gridColor;
        return;
    }

    gl_FragColor = blendModes(baseTexel, gridColor, Blending_mode);
}
