precision highp float;
precision highp int;

uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float time;
varying vec2 vUvScaled;

uniform float Transition_Dir;
uniform float Auto_Trans;
uniform float Wipe_Percent;     // 0..100
uniform float Tile_Shapes;
uniform float Shapes_Dir;
uniform float Edge_Softness;
uniform float Angle;
uniform float Frequency;
uniform float Rel_Width;
uniform float Rel_Wid_Pre_Rot;
uniform vec2  Shift_XY;
uniform float Morph_Shapes;
uniform float Grad_Add;
uniform float Grad_Angle;
uniform float Border_Width;
uniform vec3  Border_Color;
uniform float Border_Opacity;
uniform float Border_Softness;
uniform float Border_Shift;

#define PI 3.14159265359
#define SQRT3 1.73205080757

vec2 rotate(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c) * v;
}

float snapMenu(float x, float maxv) { return clamp(floor(x + 0.5), 0.0, maxv); }
float snapToggle(float x) { return step(0.5, floor(x + 0.5)); }

float norm01(float x) { return (x > 1.0) ? clamp(x / 100.0, 0.0, 1.0) : clamp(x, 0.0, 1.0); }

float edgeStep(float x, float soft) {
    if (soft <= 0.0) return 1.0 - step(0.0, x);
    return 1.0 - smoothstep(-soft, 0.0, x);
}

float ease01(float t) { return t * t * (3.0 - 2.0 * t); }

float expMix(float a, float b, float t){
    return exp(mix(log(max(a, 1e-12)), log(max(b, 1e-12)), t));
}

// snap 0..1 to N steps (50 steps requested)
float snap01Steps(float x, float steps) {
    x = clamp(x, 0.0, 1.0);
    return floor(x * steps + 0.5) / steps;   // nearest-step snapping
}

float sdTriangle(vec2 p, float r) {
    const float k = SQRT3;
    p.x = abs(p.x) - r;
    p.y = p.y + r/k;
    if (p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0*r, 0.0);
    return -length(p) * sign(p.y);
}

float sdHexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z*r, k.z*r), r);
    return length(p) * sign(p.y);
}

// true diamond (rotated square)
float sdDiamond(vec2 p, float r){
    return (abs(p.x) + abs(p.y)) - r;
}

vec4 hexGrid(vec2 uv) {
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;

    vec2 gv, id;
    if (dot(a, a) < dot(b, b)) { gv = a; id = uv - a; }
    else { gv = b; id = uv - b; }

    return vec4(gv, id);
}

void lattice60(vec2 p, out vec2 gv, out vec2 id) {
    float vv = (2.0 / SQRT3) * p.y;
    float uu = p.x - p.y / SQRT3;
    vec2 uv = vec2(uu, vv);

    vec2 cell = floor(uv);
    vec2 f = fract(uv) - 0.5;

    vec2 b1 = vec2(1.0, 0.0);
    vec2 b2 = vec2(0.5, SQRT3 * 0.5);

    gv = f.x * b1 + f.y * b2;
    id = cell;
}

float sdTriMesh(vec2 gv, float r) {
    float vv = (2.0 / SQRT3) * gv.y;
    float uu = gv.x - gv.y / SQRT3;
    vec2 f = vec2(uu, vv) + 0.5;

    float upper = step(1.0, f.x + f.y);
    vec2 f2 = mix(f, vec2(1.0) - f, upper);

    vec2 a = vec2(1.0, 0.0);
    vec2 b = vec2(0.5, SQRT3 * 0.5);
    vec2 cart = f2.x * a + f2.y * b;

    vec2 centroid = (a + b) / 3.0;
    vec2 pp = (cart - centroid) * SQRT3;

    return sdTriangle(pp, r);
}

// nearest-center square grid (used by stars + diamonds)
void gridNearest(vec2 p, out vec2 gv, out vec2 id){
    vec2 c = floor(p + 0.5);
    gv = p - c; // [-0.5..0.5]
    id = c;
}

void main() {
    // timing:
    // - Manual uses Wipe_Percent (snapped to 50 steps)
    // - Auto uses time in seconds, lasts 1 second, then holds (snapped to 50 steps)
    float tManual = snap01Steps(clamp(Wipe_Percent / 100.0, 0.0, 1.0), 50.0);

    // 1 second auto duration (no new control, just a constant)
    float tAuto = snap01Steps(clamp(time / 1.0, 0.0, 1.0), 50.0);

    float prog = (Auto_Trans > 0.5) ? tAuto : tManual;

    float shapeIdx = snapMenu(Tile_Shapes, 3.0);
    float growDir  = snapToggle(Shapes_Dir);
    float transDir = snapToggle(Transition_Dir);

    // aspect-correct space
    vec2 p = vUvScaled * (resolution / resolution.y);
    p -= Shift_XY / resolution.y;

    vec2 center = vec2(0.5) * (resolution / resolution.y);
    p -= center;
    p = rotate(p, radians(-Angle));
    p.x /= max(0.01, Rel_Wid_Pre_Rot);
    p *= max(0.1, Frequency);
    p.x /= max(0.01, Rel_Width);

    vec2 gv = vec2(0.0);
    vec2 id = vec2(0.0);

    // grid selection: diamonds use square grid
    if (shapeIdx < 0.5) {
        vec4 hg = hexGrid(p);
        gv = hg.xy;
        id = hg.zw;
    }
    else if (shapeIdx < 1.5) {
        lattice60(p, gv, id);          // Triangles
    }
    else if (shapeIdx < 2.5) {
        gridNearest(p, gv, id);        // Diamonds
    }
    else {
        gridNearest(p * 0.92, gv, id); // Stars
    }

    // ✅ FIXED: Gradient timing boundary calculation
    vec2 gradVec = vec2(cos(radians(Grad_Angle)), sin(radians(Grad_Angle)));
    float gradPos = dot(id, gradVec);
    float gradLen = Grad_Add;

    // Calculate maximum possible grid distance to safely map the 0% and 100% bounds
    float aspect = resolution.x / resolution.y;
    float maxUVDist = length(vec2(aspect * 0.5, 0.5));
    float shiftDist = length(Shift_XY / resolution.y);
    float maxGridDist = (maxUVDist + shiftDist) * max(0.1, Frequency) 
                      * (1.0 / max(0.01, Rel_Wid_Pre_Rot)) 
                      * (1.0 / max(0.01, Rel_Width)) + 5.0; // +5.0 padding

    float maxOffset = maxGridDist * 0.05 * abs(gradLen);
    
    // Stretch the progress range beyond 0..1 to perfectly encapsulate the max offset
    float mappedProg = prog * (1.0 + 2.0 * maxOffset) - maxOffset;

    float localProgress = clamp(
        mappedProg - (gradPos * 0.05 * gradLen),
        0.0, 1.0
    );

    // morph rotation
    gv = rotate(gv, radians(Morph_Shapes));

    float soft = Edge_Softness * 0.02;

    float trans = 0.0;
    float bMask = 0.0;

    if (shapeIdx < 0.5) {
        // Hex
        float d = sdHexagon(gv, 0.40);
        float RMAX = 1.20;
        float currentR = mix(RMAX * (1.0 - localProgress), localProgress * RMAX, growDir);
        float x = d + (0.60 - currentR);
        float mask = edgeStep(x, soft);
        trans = mix(1.0 - mask, mask, growDir);

        if (Border_Width > 0.0) {
            float bw = Border_Width * 0.01;
            float bs = Border_Softness * 0.02;
            float shift = Border_Shift * 0.01;
            float bDist = abs(x - shift);
            bMask = (bs <= 0.0) ? (1.0 - step(bw, bDist))
                                : (1.0 - smoothstep(bw, bw + bs, bDist));
        }

    } else if (shapeIdx < 1.5) {
        // Triangles
        float d = sdTriMesh(gv, 0.45);
        float RMAX = 1.20;
        float currentR = mix(RMAX * (1.0 - localProgress), localProgress * RMAX, growDir);
        float x = d + (0.60 - currentR);
        float mask = edgeStep(x, soft);
        trans = mix(1.0 - mask, mask, growDir);

        if (Border_Width > 0.0) {
            float bw = Border_Width * 0.01;
            float bs = Border_Softness * 0.02;
            float shift = Border_Shift * 0.01;
            float bDist = abs(x - shift);
            bMask = (bs <= 0.0) ? (1.0 - step(bw, bDist))
                                : (1.0 - smoothstep(bw, bw + bs, bDist));
        }

    } else if (shapeIdx < 2.5) {
        // Diamonds
        float d = sdDiamond(gv, 0.45);
        float RMAX = 1.20;
        float currentR = mix(RMAX * (1.0 - localProgress), localProgress * RMAX, growDir);
        float x = d + (0.60 - currentR);
        float mask = edgeStep(x, soft);
        trans = mix(1.0 - mask, mask, growDir);

        if (Border_Width > 0.0) {
            float bw = Border_Width * 0.01;
            float bs = Border_Softness * 0.02;
            float shift = Border_Shift * 0.01;
            float bDist = abs(x - shift);
            bMask = (bs <= 0.0) ? (1.0 - step(bw, bDist))
                                : (1.0 - smoothstep(bw, bw + bs, bDist));
        }

    } else {
        // Stars
        float u = mix(1.0 - localProgress, localProgress, growDir);
        u = clamp(u, 0.0, 1.0);
        float e = ease01(u);

        float pix = max(1.0 / max(resolution.y, 1.0), 1e-6) * max(Frequency, 0.1);
        float minSize = max(pix * 0.02, 1e-6);
        float maxSize = 12.0;
        float size = expMix(minSize, maxSize, e);

        vec2 sgv = rotate((gv / size) * 2.85, PI/6.0);
        float dStar = min(
            sdTriangle(sgv, 0.55),
            sdTriangle(rotate(sgv, PI/3.0), 0.55)
        );

        float starInside = edgeStep(dStar, soft);
        trans = mix(1.0 - starInside, starInside, growDir);

        if (Border_Width > 0.0) {
            float bw = Border_Width * 0.01;
            float bs = Border_Softness * 0.02;
            float shift = Border_Shift * 0.01;
            float bDist = abs(dStar - shift);
            bMask = (bs <= 0.0) ? (1.0 - step(bw, bDist))
                                : (1.0 - smoothstep(bw, bw + bs, bDist));
        }
    }

    float fgAmt = mix(1.0 - trans, trans, transDir);
    vec4 fg = texture2D(tDiffuse, vUvScaled);
    vec4 color = mix(vec4(0.0), fg, fgAmt);

    color.rgb = mix(color.rgb, Border_Color, bMask * Border_Opacity);
    color.a = max(color.a, bMask * Border_Opacity);

    gl_FragColor = color;
}
