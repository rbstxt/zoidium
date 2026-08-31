precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 uvScale;
uniform vec2 resolution; // Fetches the layer's pixel dimensions
varying vec2 vUv;
varying vec2 vUvScaled;

// Custom Properties
uniform vec2 Upper_Left;
uniform vec2 Upper_Right;
uniform vec2 Lower_Left;
uniform vec2 Lower_Right;

// Helper function: 2D Cross Product
float cross2d(vec2 a, vec2 b) {
    return a.x * b.y - a.y * b.x;
}

// Converts After Effects pixel coordinates (Top-Left origin)
// to Panzoid WebGL UV coordinates (Bottom-Left origin)
vec2 pixelToUV(vec2 pixelCoords) {
    return vec2(pixelCoords.x / resolution.x, 1.0 - (pixelCoords.y / resolution.y));
}

// Inverse Bilinear Interpolation
vec2 invBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 e = b - a;
    vec2 f = c - a;
    vec2 g = a - b + d - c;
    vec2 h = p - a;

    float k2 = cross2d(g, f);
    float k1 = cross2d(e, f) + cross2d(h, g);
    float k0 = cross2d(h, e);

    if (abs(k2) < 0.0001) {
        float v = -k0 / k1;
        float denomX = e.x + g.x * v;
        float denomY = e.y + g.y * v;
        float u = (abs(denomX) > abs(denomY)) ? (h.x - f.x * v) / denomX : (h.y - f.y * v) / denomY;
        return vec2(u, v);
    }

    float w = k1 * k1 - 4.0 * k0 * k2;
    if (w < 0.0) return vec2(-1.0); 

    w = sqrt(w);

    float v1 = (-k1 - w) / (2.0 * k2);
    float v2 = (-k1 + w) / (2.0 * k2);

    float denomX1 = e.x + g.x * v1;
    float denomY1 = e.y + g.y * v1;
    float u1 = (abs(denomX1) > abs(denomY1)) ? (h.x - f.x * v1) / denomX1 : (h.y - f.y * v1) / denomY1;

    float denomX2 = e.x + g.x * v2;
    float denomY2 = e.y + g.y * v2;
    float u2 = (abs(denomX2) > abs(denomY2)) ? (h.x - f.x * v2) / denomX2 : (h.y - f.y * v2) / denomY2;

    bool b1 = (v1 >= 0.0 && v1 <= 1.0 && u1 >= 0.0 && u1 <= 1.0);
    bool b2 = (v2 >= 0.0 && v2 <= 1.0 && u2 >= 0.0 && u2 <= 1.0);

    vec2 res = vec2(-1.0);
    if (b1) res = vec2(u1, v1);
    else if (b2) res = vec2(u2, v2);

    return res;
}

void main() {
    // Convert AE pixel coordinates to Panzoid UV mapping
    // a = Bottom Left, b = Bottom Right, c = Top Left, d = Top Right
    vec2 p0 = pixelToUV(Lower_Left);
    vec2 p1 = pixelToUV(Lower_Right);
    vec2 p2 = pixelToUV(Upper_Left);
    vec2 p3 = pixelToUV(Upper_Right);

    vec2 uvMap = invBilinear(vUv, p0, p1, p2, p3);

    // Render transparent if outside the mapped quadrilateral 
    if (uvMap.x < 0.0 || uvMap.y < 0.0 || uvMap.x > 1.0 || uvMap.y > 1.0) {
        gl_FragColor = vec4(0.0);
    } else {
        vec4 texel = texture2D(tDiffuse, uvMap * uvScale);
        gl_FragColor = texel;
    }
}
