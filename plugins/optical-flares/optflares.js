"use strict";

// OpenZoid Optical Flares - 3D flare object (numeric PZ.object3d type 13).
//
// The flare lives in a 3D scene layer. Its source is a 3D point: the flare's
// own world position (Object 3D), a light in the same layer (Light), or a
// screen offset kept for projects saved before the object was 3D (Screen 2D).
//
// Each frame has two phases:
//   update(time)   evaluates properties at `time` and fills the element uniforms.
//                  It reads property values only.
//   render hook    runs when the layer's pass draws the flare quad, after every
//                  object of the layer has been updated. It projects the source
//                  through the camera drawing the pass (position, rotation, FOV,
//                  aspect and any camera override all apply), then sets the
//                  source, centre, depth and brightness uniforms.
//
// The flare is one screen-space quad drawn by the layer's own render pass. The
// quad's depth is the source depth, so with Occlude on, scene geometry in front
// of the source hides the flare through the depth buffer. No raycasts or mesh
// caches are involved, and nothing is carried from one render to the next.

var PZ = PZ || {};

(function () {
    var math = PZ.opticalflares.math;

    var MAX_ELEMENTS = 24;
    var DEG = Math.PI / 180;
    var DEFAULT_RESOLUTION = [1920, 1080];

    // Live flare objects in the open project. The plugin manager asks this
    // through isInUse() so the pack cannot be disabled under a project that
    // still uses it.
    var liveFlares = new Set();

    /* ------------------------------------------------------------------ */
    /* Property helpers                                                   */
    /* ------------------------------------------------------------------ */

    function number(name, value, extra) {
        var def = { dynamic: true, name: name, type: PZ.property.type.NUMBER, value: value };
        if (extra) for (var k in extra) def[k] = extra[k];
        return def;
    }

    function option(name, value, items, dynamic) {
        return {
            dynamic: dynamic !== false,
            name: name,
            type: PZ.property.type.OPTION,
            value: value,
            items: items,
        };
    }

    function vector2(name, value) {
        return {
            dynamic: true,
            name: name,
            type: PZ.property.type.VECTOR2,
            value: value,
            spaceChar: "x",
            step: 1,
            decimals: 1,
        };
    }

    function color(name, rgb) {
        return {
            dynamic: true,
            group: true,
            name: name,
            type: PZ.property.type.COLOR,
            objects: [
                { dynamic: true, name: name + ".R", type: PZ.property.type.NUMBER, value: rgb[0], min: 0, max: 1 },
                { dynamic: true, name: name + ".G", type: PZ.property.type.NUMBER, value: rgb[1], min: 0, max: 1 },
                { dynamic: true, name: name + ".B", type: PZ.property.type.NUMBER, value: rgb[2], min: 0, max: 1 },
            ],
        };
    }

    function asset(name) {
        return {
            name: name,
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: null,
        };
    }

    function clampIndex(value, max) {
        return Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    }

    /* ------------------------------------------------------------------ */
    /* Lens object catalogue                                              */
    /* ------------------------------------------------------------------ */

    // Type indexes are stored in projects and read by the shader: keep order.
    var ELEMENT_TYPES = [
        { key: "glow", name: "Glow", scale: 100, distance: 5, aspect: 1, color: [1, 1, 1], seed: 5000 },
        { key: "multiiris", name: "Multi Iris", scale: 60, distance: 38.5, aspect: 1, color: [0.62, 0.72, 0.95], seed: 5100 },
        { key: "iris", name: "Iris", scale: 85, distance: 75, aspect: 1, color: [0.56, 0.62, 0.72], seed: 5200 },
        { key: "streak", name: "Streak", scale: 90, distance: 0, aspect: 6, color: [0.55, 0.72, 1], seed: 5300 },
        { key: "shimmer", name: "Shimmer", scale: 60, distance: 0, aspect: 1, color: [1, 1, 1], seed: 5400 },
        { key: "glint", name: "Glint", scale: 55, distance: 0, aspect: 1, color: [1, 1, 1], seed: 5500 },
        { key: "spikeball", name: "Spike Ball", scale: 55, distance: 0, aspect: 1, color: [0.92, 0.94, 1], seed: 5600 },
        { key: "sparkle", name: "Sparkle", scale: 70, distance: 0, aspect: 1, color: [0.85, 0.9, 1], seed: 5700 },
        { key: "ring", name: "Ring", scale: 85, distance: 120, aspect: 1, color: [0.9, 1, 0.95], seed: 5800 },
        { key: "hoop", name: "Hoop", scale: 150, distance: 95, aspect: 1.8, color: [1, 1, 1], seed: 5900 },
        { key: "caustic", name: "Caustic", scale: 90, distance: 110, aspect: 1, color: [0.85, 0.88, 0.92], seed: 6000 },
        { key: "lensorbs", name: "Lens Orbs", scale: 100, distance: 150, aspect: 1, color: [0.82, 0.84, 0.9], seed: 6100 },
    ];

    var ELEMENT_TYPE_ITEMS = ELEMENT_TYPES.map(function (t) {
        return t.name;
    }).join(";");

    var TEXTURE_ITEMS = "None;Soft;Hex;Ring;Streak;Spikes;Orbs;Custom 1;Custom 2;Custom 3";
    var MATTE_ITEMS = "None;Circle;Square;Hexagon;Triangle;Star";
    var BLEND_ITEMS = "Add;Screen;Normal";

    /* ------------------------------------------------------------------ */
    /* Shader                                                             */
    /* ------------------------------------------------------------------ */

    // Vertex: the quad covers the screen. Its depth is the projected source depth
    // (uDepth), and vP is the fragment position in layout units.
    var VERTEX_SHADER = [
        "uniform float uViewAspect;",
        "uniform float uDepth;",
        "varying vec2 vP;",
        "void main() {",
        "vP = vec2(position.x * uViewAspect, position.y);",
        "gl_Position = vec4(position.xy, uDepth, 1.0);",
        "}",
    ].join("\n");

    var FRAGMENT_SHADER = [
        "precision highp float;",
        "#define MAX_ELEMENTS " + MAX_ELEMENTS,
        "varying vec2 vP;",
        "uniform vec2 uSource;",
        "uniform vec2 uCenter;",
        "uniform float uBrightness;",
        "uniform float uGain;",
        "uniform float uScale;",
        "uniform float uAspect;",
        "uniform float uRotation;",
        "uniform float uEvolution;",
        "uniform float uTime;",
        "uniform float uFlickerAmount;",
        "uniform float uFlickerSpeed;",
        "uniform float uGpu;",
        "uniform float uColorMode;",
        "uniform float uRenderMode;",
        "uniform float uBlendGlobal;",
        "uniform vec3 uTint;",
        "uniform float uElementCount;",
        "uniform vec4 eDataA[MAX_ELEMENTS];",
        "uniform vec4 eDataB[MAX_ELEMENTS];",
        "uniform vec4 eDataC[MAX_ELEMENTS];",
        "uniform vec4 eDataD[MAX_ELEMENTS];",
        "uniform vec3 eColor[MAX_ELEMENTS];",
        "uniform sampler2D uCustom1;",
        "uniform sampler2D uCustom2;",
        "uniform sampler2D uCustom3;",
        "const float PI = 3.14159265;",
        "float hash11(float p) {",
        "p = fract(p * 0.1031);",
        "p *= p + 33.33;",
        "p *= p + p;",
        "return fract(p);",
        "}",
        "float vnoise(vec2 p) {",
        "vec2 i = floor(p);",
        "vec2 f = fract(p);",
        "f = f * f * (3.0 - 2.0 * f);",
        "float a = hash11(i.x + i.y * 57.0);",
        "float b = hash11(i.x + 1.0 + i.y * 57.0);",
        "float c = hash11(i.x + (i.y + 1.0) * 57.0);",
        "float d = hash11(i.x + 1.0 + (i.y + 1.0) * 57.0);",
        "return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);",
        "}",
        "float polyDist(vec2 p, float sides) {",
        "float l = length(p);",
        "if (l < 0.00001) return 0.0;",
        "float ang = atan(p.y, p.x);",
        "float seg = 2.0 * PI / sides;",
        "return cos(floor(0.5 + ang / seg) * seg - ang) * l;",
        "}",
        "float matteShapeDist(int shape, vec2 p) {",
        "if (shape == 1) return length(p);",
        "if (shape == 2) return max(abs(p.x), abs(p.y));",
        "if (shape == 3) return polyDist(p, 6.0);",
        "if (shape == 4) return polyDist(p, 3.0);",
        "if (shape == 5) {",
        "float l = length(p);",
        "if (l < 0.00001) return 0.0;",
        "float ang = atan(p.y, p.x);",
        "float spike = pow(abs(cos(2.5 * ang)), 2.0);",
        "return polyDist(p, 5.0) * (1.0 + 1.6 * spike);",
        "}",
        "return 1e6;",
        "}",
        "vec3 lensTexture(int mode, vec2 q, float falloff, float illumination) {",
        "float ill = max(illumination, 0.01);",
        "float r = length(q) / ill;",
        "if (mode == 0) return vec3(1.0);",
        "if (mode == 1) return vec3(smoothstep(1.0, 0.0, r));",
        "if (mode == 2) return vec3(smoothstep(1.0, 0.1, polyDist(q, 6.0) / ill));",
        "if (mode == 3) return vec3(exp(-pow((r - 0.75) * (5.0 * max(falloff, 0.05)), 2.0)));",
        "if (mode == 4) {",
        "vec2 s = vec2(q.x / ill * 0.25, q.y / ill * 3.0);",
        "return vec3(exp(-s.x * s.x * 2.0) * exp(-s.y * s.y * 2.0));",
        "}",
        "if (mode == 5) {",
        "if (length(q) < 0.00001) return vec3(1.0);",
        "float ang = atan(q.y, q.x);",
        "float spikes = pow(abs(cos(ang * 5.0)), 8.0);",
        "return vec3((spikes + 0.25) * exp(-r * 2.0));",
        "}",
        "if (mode == 6) {",
        "float dots = 0.0;",
        "for (int k = 0; k < 5; k++) {",
        "float fk = float(k);",
        "vec2 o = vec2(sin(fk * 2.4) * 0.7, cos(fk * 1.7) * 0.7);",
        "dots += exp(-pow(length(q - o) * 4.0, 2.0));",
        "}",
        "return vec3(dots);",
        "}",
        "return vec3(1.0);",
        "}",
        "void main() {",
        "vec2 P = vP;",
        "vec2 axis = uCenter - uSource;",
        "float axisLen = length(axis);",
        "if (axisLen < 0.000001) { axis = vec2(0.7071, -0.7071); axisLen = 0.0; }",
        // Source and centre coincide: every element anchors on the source, so
        // the non-glow elements fade out instead of stacking into a white blob.
        "float axisFade = smoothstep(0.0, 0.02, axisLen);",
        "float baseAngle = atan(axis.y, axis.x) + uRotation;",
        "vec2 dir = vec2(cos(baseAngle), sin(baseAngle));",
        "float baseSize = 0.3 * uScale;",
        "float quality = mix(1.0, 2.0, uGpu);",
        "float time = uTime;",
        "vec3 col = vec3(0.0);",
        "for (int i = 0; i < MAX_ELEMENTS; i++) {",
        "if (float(i) >= uElementCount) break;",
        "vec4 A = eDataA[i];",
        "vec4 B = eDataB[i];",
        "vec4 C = eDataC[i];",
        "vec4 D = eDataD[i];",
        "if (D.w < 0.5) continue;",
        "float seed = A.z;",
        "float opacity = A.w;",
        "float aspect = max(A.y, 0.01);",
        "float rotation = B.x + uEvolution;",
        "float animate = B.z;",
        "float distance = B.y;",
        "int etype = int(D.z + 0.5);",
        "int blend = int(D.y + 0.5);",
        "int texMode = int(B.w + 0.5);",
        "int matteShape = int(D.x + 0.5);",
        "vec2 anchor = uSource + dir * axisLen * distance;",
        "vec2 dr = P - anchor;",
        "float ca = cos(rotation);",
        "float sa = sin(rotation);",
        "vec2 rot = vec2(ca * dr.x + sa * dr.y, -sa * dr.x + ca * dr.y);",
        "float size = max(baseSize * A.x, 0.001);",
        "vec2 q = vec2(rot.x / (size * aspect * uAspect), rot.y / size);",
        "vec3 c = vec3(0.0);",
        "vec3 ecol = eColor[i];",
        "if (etype == 0) {",
        "float r = length(q);",
        "float core = exp(-r * r * 90.0);",
        "float mid = exp(-r * r * 14.0);",
        "float halo = exp(-r * r * 3.0);",
        "c = ecol * (core * 1.5 + mid * 0.7 + halo * 0.55);",
        "} else if (etype == 1) {",
        "for (int j = 0; j < 7; j++) {",
        "float fj = float(j);",
        "float t = distance + (fj - 3.0) * 0.13 * (0.7 + 0.6 * hash11(seed + fj * 3.7));",
        "vec2 a2 = uSource + dir * axisLen * t;",
        "vec2 d2 = P - a2;",
        "vec2 r2 = vec2(ca * d2.x + sa * d2.y, -sa * d2.x + ca * d2.y);",
        "float sc = max(size * (0.09 + 0.36 * exp(-fj * 0.24)), 0.001);",
        "vec2 q2 = r2 / sc;",
        "float rr = length(q2);",
        "float pd = polyDist(q2, 6.0);",
        "float core2 = exp(-rr * rr * 16.0);",
        "float edge2 = exp(-pow((pd - 0.92) * 6.0, 2.0)) * 0.4;",
        "float halo2 = exp(-rr * rr * 2.0) * 0.34;",
        "vec3 mc = mix(vec3(1.0), ecol, 0.65) * (0.75 + 0.25 * hash11(seed + fj * 5.1));",
        "c += mc * (core2 * 1.8 + edge2 + halo2);",
        "}",
        "} else if (etype == 2) {",
        "float pd = polyDist(q, 6.0);",
        "float soft = smoothstep(1.55, 0.35, pd);",
        "float rim = exp(-pow((pd - 1.0) * 4.0, 2.0)) * 0.35;",
        "c = ecol * (soft * 0.32 + rim * 0.18);",
        "} else if (etype == 3) {",
        "float streakAngle = baseAngle + rotation;",
        "float cs = cos(streakAngle);",
        "float ss = sin(streakAngle);",
        "vec2 sq = vec2(cs * dr.x + ss * dr.y, -ss * dr.x + cs * dr.y);",
        "vec2 qs = vec2(sq.x / (size * aspect * uAspect), sq.y / size);",
        "float core = exp(-qs.y * qs.y * 70.0) * exp(-qs.x * qs.x * 1.05);",
        "float halo = exp(-qs.y * qs.y * 10.0) * exp(-qs.x * qs.x * 0.45);",
        "float hot = exp(-(qs.x * qs.x + qs.y * qs.y) * 50.0);",
        "c = ecol * (core * 1.7 + halo * 0.55 + hot * 1.2);",
        "} else if (etype == 4) {",
        "float r = length(q);",
        "if (r > 0.00001) {",
        "float ang = atan(q.y, q.x);",
        "float a1 = pow(abs(cos(ang * 13.0 + seed * 17.0)), 26.0 / quality);",
        "float a2 = pow(abs(cos(ang * 27.0 - seed * 23.0)), 42.0 / quality);",
        "float a3 = pow(abs(cos(ang * 41.0 + seed * 31.0)), 64.0 / quality);",
        "float rays = (a1 + a2 * 0.7 + a3 * 0.5) * exp(-r * 1.35);",
        "float core = exp(-r * r * 30.0) * 0.9 + exp(-r * r * 4.0) * 0.35;",
        "c = ecol * (rays * 1.6 + core);",
        "}",
        "} else if (etype == 5) {",
        "float r = length(q);",
        "if (r > 0.00001) {",
        "float ang = atan(q.y, q.x);",
        "float longRays = pow(abs(cos(2.0 * ang + seed * 6.0)), 90.0 / quality);",
        "float shortRays = pow(abs(cos(4.0 * ang + seed * 6.0 + 0.6)), 150.0 / quality);",
        "float rays = (longRays + shortRays * 0.55) * exp(-r * 1.1);",
        "float core = exp(-r * r * 55.0) * 1.2 + exp(-r * r * 10.0) * 0.45;",
        "c = ecol * (rays * 1.8 + core);",
        "}",
        "} else if (etype == 6) {",
        "float r = length(q);",
        "if (r > 0.00001) {",
        "float ang = atan(q.y, q.x);",
        "float s1 = pow(abs(cos(ang * 11.0 + seed * 13.0)), 60.0 / quality);",
        "float s2 = pow(abs(cos(ang * 19.0 - seed * 7.0 + 1.7)), 85.0 / quality);",
        "float s3 = pow(abs(cos(ang * 29.0 + seed * 29.0 + 3.1)), 110.0 / quality);",
        "float rays = (s1 + s2 * 0.7 + s3 * 0.45) * exp(-r * (1.1 + 0.5 * abs(sin(ang * 7.0 + seed * 11.0))));",
        "float core = exp(-r * r * 40.0) * 0.9 + exp(-r * r * 6.0) * 0.3;",
        "c = ecol * (rays * 1.7 + core);",
        "}",
        "} else if (etype == 7) {",
        "for (int j = 0; j < 36; j++) {",
        "float fj = float(j);",
        "float h1 = hash11(seed * 0.37 + fj * 1.37);",
        "float h2 = hash11(seed * 0.71 + fj * 2.71);",
        "float h3 = hash11(seed * 0.53 + fj * 3.93);",
        "float rad = sqrt(h1) * 1.6;",
        "float pa = h2 * 6.2831;",
        "vec2 p2 = vec2(cos(pa), sin(pa)) * rad;",
        "vec2 d2 = (q - p2) / (0.025 + 0.085 * h3);",
        "float dd = dot(d2, d2);",
        "float tw = animate > 0.5 ? (0.45 + 0.55 * sin(time * (1.0 + 3.0 * h3) + h2 * 20.0)) : 0.8;",
        "float cross1 = exp(-abs(d2.x) * 2.5) * exp(-abs(d2.y) * 0.5);",
        "float cross2 = exp(-abs(d2.y) * 2.5) * exp(-abs(d2.x) * 0.5);",
        "c += ecol * (exp(-dd * 1.4) * (0.35 + 0.5 * tw) + (cross1 + cross2) * 0.18 * tw);",
        "}",
        "c *= 1.5;",
        "} else if (etype == 8) {",
        "float r = length(q);",
        "float rr = exp(-pow((r - 0.786) * 24.0, 2.0));",
        "float gg = exp(-pow((r - 0.8) * 26.0, 2.0));",
        "float bb = exp(-pow((r - 0.814) * 24.0, 2.0));",
        "float ringGlow = exp(-pow((r - 0.8) * 6.0, 2.0)) * 0.22;",
        "c = ecol * (gg * 1.35 + ringGlow) + vec3(rr, gg, bb) * 0.24;",
        "} else if (etype == 9) {",
        "float r = length(q);",
        "float ang = 0.0;",
        "if (r > 0.00001) ang = atan(q.y, q.x);",
        "vec3 rainbow = 0.55 + 0.45 * cos(ang + vec3(0.0, 2.09, 4.18) + time * 0.4 * animate);",
        "float band = exp(-pow((r - 0.88) * 6.0, 2.0));",
        "float inner = exp(-pow((r - 0.79) * 10.0, 2.0)) * 0.55;",
        "float bright = 0.85 + 0.15 * sin(ang * 3.0 + seed);",
        "c = rainbow * (band + inner) * bright * 1.25;",
        "} else if (etype == 10) {",
        "float r = length(q);",
        "if (r < 1.2) {",
        "float ang = 0.0;",
        "if (r > 0.00001) ang = atan(q.y, q.x);",
        "float disc = smoothstep(1.05, 0.9, r);",
        "float star = pow(abs(cos(2.0 * ang + seed * 3.0)), 6.0);",
        "float blades = pow(abs(cos(3.0 * ang - seed * 2.0 + 0.7)), 10.0);",
        "float pattern = 0.34 + 0.26 * star + 0.12 * blades;",
        "float rim = exp(-pow((r - 0.92) * 9.0, 2.0)) * 0.5;",
        "c = ecol * (disc * pattern + rim);",
        "}",
        "} else {",
        "for (int j = 0; j < 10; j++) {",
        "float fj = float(j);",
        "float h1 = hash11(seed * 0.43 + fj * 1.71);",
        "float h2 = hash11(seed * 0.67 + fj * 2.33);",
        "float h3 = hash11(seed * 0.91 + fj * 3.17);",
        "float rad = sqrt(h1) * 1.15;",
        "float pa = h2 * 6.2831;",
        "vec2 p2 = vec2(cos(pa), sin(pa)) * rad;",
        "float orbR = 0.28 + 0.5 * h3;",
        "float d2 = length(q - p2) / orbR;",
        "float bokeh = smoothstep(1.0, 0.8, d2) * (0.3 + 0.35 * h2);",
        "float orbRim = exp(-pow((d2 - 0.92) * 9.0, 2.0)) * 0.14;",
        "c += ecol * (bokeh + orbRim);",
        "}",
        "c *= 1.3;",
        "}",
        "c *= lensTexture(texMode, q, C.y, C.x * 0.01);",
        "if (texMode >= 7) {",
        "vec2 uv = q * 0.5 + 0.5;",
        "vec3 ct = vec3(0.0);",
        "if (texMode == 7) ct = texture2D(uCustom1, uv).rgb;",
        "else if (texMode == 8) ct = texture2D(uCustom2, uv).rgb;",
        "else ct = texture2D(uCustom3, uv).rgb;",
        "c *= (ct.r + ct.g + ct.b) / 3.0 * 1.5;",
        "}",
        "if (matteShape > 0) {",
        "float md = matteShapeDist(matteShape, q);",
        "float start = C.z * 0.01;",
        "float fade = max(C.w, 0.001) * 0.01;",
        "c *= 1.0 - smoothstep(start, start + fade, md);",
        "}",
        "c *= (etype == 0) ? 1.0 : axisFade;",
        "c *= opacity;",
        "if (blend == 0) {",
        "col += c;",
        "} else if (blend == 1) {",
        "col = 1.0 - (1.0 - col) * (1.0 - clamp(c, 0.0, 1.0));",
        "} else {",
        "float a = clamp(max(max(c.r, c.g), c.b), 0.0, 1.0);",
        "col = c + col * (1.0 - a);",
        "}",
        "}",
        "float flick = 1.0 - uFlickerAmount * (0.5 + 0.5 * sin(time * max(uFlickerSpeed, 0.001) * 6.2831 + vnoise(vec2(time * 3.0, 0.0)) * 6.0));",
        "col *= clamp(flick, 0.0, 1.0);",
        "if (uColorMode > 1.5) {",
        "col = vec3(dot(col, vec3(0.299, 0.587, 0.114))) * uTint;",
        "} else if (uColorMode < 0.5) {",
        "col *= uTint;",
        "}",
        "col *= uBrightness * uGain;",
        "float alpha = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);",
        "float outAlpha = (uRenderMode > 0.5 || uBlendGlobal > 1.5) ? alpha : 1.0;",
        "gl_FragColor = vec4(col, outAlpha);",
        "}",
    ].join("\n");

    function whiteTexture() {
        var texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        texture.minFilter = texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return texture;
    }

    /* ------------------------------------------------------------------ */
    /* Flare stack element                                                */
    /* ------------------------------------------------------------------ */

    var elementDefinitions = {
        elementType: option("Type", 0, ELEMENT_TYPE_ITEMS),
        enabled: option("Enabled", 1, "off;on", true),
        distance: number("Distance", 0, { min: -300, max: 500, step: 1, decimals: 1, vstep: 10 }),
        rotation: number("Rotation", 0, { step: 1, decimals: 1, vstep: 15 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        animate: option("Animate", 1, "off;on", true),
        // Solo previews one element alone: when any element has Solo on, only
        // the soloed elements render. Stored like Enabled, so it is undoable,
        // saved with the project and a pure function of data and time.
        solo: option("Solo", 0, "off;on", true),
    };

    var commonDefinitions = {
        scale: number("Scale", 100, { min: 0, max: 1000, step: 0.1, decimals: 1 }),
        scaleOffset: option("Scale With Distance", 0, "off;on", true),
        aspectRatio: number("Aspect Ratio", 1, { min: 0.01, max: 20, step: 0.01, decimals: 2 }),
        blendMode: option("Blend Mode", 0, BLEND_ITEMS, true),
        color: color("Color", [1, 1, 1]),
        globalSeed: number("Element Seed", 1000, { min: 0, max: 10000, step: 1, decimals: 0, vstep: 50 }),
    };

    var matteDefinitions = {
        shape: option("Shape", 0, MATTE_ITEMS, true),
        startRange: number("Start Range", 25, { min: 0, max: 500, step: 0.5, decimals: 1 }),
        fadeAmount: number("Fade Amount", 25, { min: 0, max: 500, step: 0.5, decimals: 1 }),
    };

    var lensDefinitions = {
        textureImage: option("Texture Image", 1, TEXTURE_ITEMS, true),
        illuminationRadius: number("Illumination Radius", 100, { min: 1, max: 500, step: 0.5, decimals: 1 }),
        falloff: number("Falloff", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
    };

    // Full description of one element type, used for new elements and presets.
    function spec(type, overrides) {
        var def = ELEMENT_TYPES[type];
        var out = {
            type: type,
            scale: def.scale,
            distance: def.distance,
            aspect: def.aspect,
            texture: 0,
            color: def.color,
            seed: def.seed,
            rotation: 0,
            opacity: 100,
            blend: 0,
            enabled: 1,
        };
        if (overrides) for (var k in overrides) out[k] = overrides[k];
        return out;
    }

    // CM3's dynamic load appends keyframes. Elements initialize defaults so
    // they can be used by the picker immediately; replace those defaults when
    // loading saved data or a preset rather than leaving duplicate frame zero.
    function loadProperties(list, data) {
        function reset(node) {
            if (node instanceof PZ.propertyList) {
                for (var key of Object.keys(node)) reset(node[key]);
            } else if (node) {
                if (node.keyframes) node.keyframes.splice(0, node.keyframes.length);
                if (node.objects) for (var child of node.objects) reset(child);
            }
        }
        reset(list);
        list.load(data);
    }

    function applySpec(element, s) {
        var p = element.properties;
        p.element.elementType.set(s.type, 0);
        p.name.set(ELEMENT_TYPES[s.type].name, 0);
        p.element.distance.set(s.distance, 0);
        p.element.rotation.set(s.rotation || 0, 0);
        p.element.opacity.set(s.opacity, 0);
        p.element.enabled.set(s.enabled, 0);
        p.element.animate.set(1, 0);
        p.element.solo.set(0, 0);
        p.globalParams.scale.set(s.scale, 0);
        p.globalParams.scaleOffset.set(0, 0);
        p.globalParams.aspectRatio.set(s.aspect, 0);
        p.globalParams.blendMode.set(s.blend || 0, 0);
        p.globalParams.color.set(s.color.slice(), 0);
        p.globalParams.globalSeed.set(s.seed, 0);
        p.matteBox.shape.set(0, 0);
        p.matteBox.startRange.set(25, 0);
        p.matteBox.fadeAmount.set(25, 0);
        p.lensTexture.textureImage.set(s.texture, 0);
        p.lensTexture.illuminationRadius.set(100, 0);
        p.lensTexture.falloff.set(0.5, 0);
    }

    var optflaresElement = class extends PZ.object {
        static create(subType) {
            var element = new optflaresElement();
            applySpec(element, spec(clampIndex(subType, ELEMENT_TYPES.length - 1)));
            return element;
        }
        constructor() {
            super();
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create({ visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Glow" }),
                    element: new PZ.propertyList(elementDefinitions),
                    globalParams: new PZ.propertyList(commonDefinitions),
                    matteBox: new PZ.propertyList(matteDefinitions),
                    lensTexture: new PZ.propertyList(lensDefinitions),
                },
                this
            );
            this.properties.load(null);
            Object.defineProperty(this.properties.element, "displayName", { value: "Element Settings", writable: true });
            Object.defineProperty(this.properties.globalParams, "displayName", { value: "Common Settings", writable: true });
            Object.defineProperty(this.properties.matteBox, "displayName", { value: "Matte Box Controls", writable: true });
            Object.defineProperty(this.properties.lensTexture, "displayName", { value: "Lens Texture", writable: true });
            // Serialize every child list, not only those parented to this list.
            Object.defineProperty(this.properties, "toJSON", {
                value: function () {
                    var result = {};
                    var keys = Object.keys(this);
                    for (var k = 0; k < keys.length; k++) result[keys[k]] = this[keys[k]];
                    return result;
                },
                writable: true,
            });
            this.children = [this.properties];
        }
        // The element type is stored in the Type property, so undo and redo of
        // that property keep the type in step.
        get type() {
            return this.properties ? clampIndex(this.properties.element.elementType.get(0), ELEMENT_TYPES.length - 1) : 0;
        }
        set type(value) {
            if (this.properties) this.properties.element.elementType.set(clampIndex(value, ELEMENT_TYPES.length - 1), 0);
        }
        load(e) {
            loadProperties(this.properties, e && e.properties);
            if (!this.properties.name.get().length) {
                this.properties.name.set(ELEMENT_TYPES[this.type].name);
            }
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {}
    };

    optflaresElement.prototype.defaultName = "Element";

    /* ------------------------------------------------------------------ */
    /* Presets                                                            */
    /* ------------------------------------------------------------------ */

    var PRESETS = [
        { key: "default", name: "Default Lens Flare" },
        { key: "anamorphic", name: "Anamorphic Blue" },
        { key: "sparkle", name: "Sparkle Burst" },
        { key: "cinematic", name: "Cinematic Warm" },
        { key: "scifi", name: "Sci-Fi Plasma" },
    ];

    var PRESET_STACKS = {
        default: [
            spec(0, { scale: 100, distance: 5 }),
            spec(0, { scale: 139.5, distance: 15, opacity: 80 }),
            spec(1, { scale: 50, distance: 38.5, color: [0.62, 0.72, 0.95] }),
            spec(1, { scale: 203.5, distance: 11.5, color: [0.7, 0.8, 1], opacity: 80 }),
            spec(1, { scale: 224.5, distance: 9.5, color: [1, 1, 1], opacity: 65 }),
            spec(1, { scale: 50, distance: 107, color: [0.55, 0.7, 1] }),
            spec(1, { scale: 90, distance: 60, color: [0.6, 0.75, 1], opacity: 70 }),
            spec(2, { scale: 85, distance: 75, color: [0.56, 0.62, 0.72] }),
            spec(3, { scale: 90, distance: 0, aspect: 6, color: [0.55, 0.72, 1], opacity: 90 }),
            spec(3, { scale: 50, distance: 0, aspect: 3.2, color: [0.85, 0.9, 1], opacity: 80 }),
            spec(4, { scale: 60, distance: 0 }),
            spec(5, { scale: 55, distance: 0 }),
            spec(6, { scale: 45, distance: 0, opacity: 80 }),
            spec(8, { scale: 85, distance: 130, color: [0.9, 1, 0.95], opacity: 70 }),
            spec(11, { scale: 100, distance: 150, color: [0.82, 0.84, 0.9], opacity: 90 }),
        ],
        anamorphic: [
            spec(0, { scale: 60, color: [0.8, 0.88, 1] }),
            spec(3, { scale: 110, aspect: 9, color: [0.3, 0.55, 1], opacity: 95 }),
            spec(3, { scale: 70, aspect: 5, color: [0.7, 0.85, 1], opacity: 75, rotation: 0.5 }),
            spec(3, { scale: 40, aspect: 3, color: [1, 1, 1], opacity: 60 }),
            spec(1, { scale: 45, distance: 115, color: [0.4, 0.6, 1] }),
            spec(9, { scale: 80, distance: 40, aspect: 3, color: [0.5, 0.7, 1], opacity: 45 }),
        ],
        sparkle: [
            spec(7, { scale: 60 }),
            spec(4, { scale: 55, color: [1, 0.95, 0.85] }),
            spec(6, { scale: 60, color: [0.85, 0.9, 1] }),
            spec(5, { scale: 40, color: [1, 0.9, 0.75] }),
            spec(8, { scale: 40, distance: 120, color: [0.6, 1, 0.8] }),
            spec(11, { scale: 60, distance: 150 }),
        ],
        cinematic: [
            spec(0, { scale: 90, color: [1, 0.9, 0.72] }),
            spec(2, { scale: 70, distance: 75, color: [1, 0.75, 0.45] }),
            spec(1, { scale: 45, distance: 105, color: [1, 0.72, 0.4] }),
            spec(3, { scale: 70, aspect: 5, color: [1, 0.6, 0.3], opacity: 60 }),
            spec(9, { scale: 55, distance: 75, aspect: 1.8, opacity: 50, color: [1, 0.85, 0.6] }),
            spec(11, { scale: 55, distance: 170, color: [1, 0.8, 0.6] }),
        ],
        scifi: [
            spec(9, { scale: 70, distance: 60, aspect: 1.4 }),
            spec(8, { scale: 45, distance: 105, color: [0.4, 0.9, 1] }),
            spec(10, { scale: 35, distance: 130, color: [0.5, 0.85, 1] }),
            spec(5, { scale: 45, color: [0.7, 0.95, 1] }),
            spec(0, { scale: 50, color: [0.6, 0.9, 1] }),
            spec(1, { scale: 40, distance: 85, color: [0.5, 0.9, 1] }),
        ],
    };

    // Serialized element records for a preset. Used by load() and by the
    // options window, so both paths build identical elements.
    function presetData(key) {
        var list = PRESET_STACKS[key] || PRESET_STACKS.default;
        return list.map(function (s) {
            var element = optflaresElement.create(s.type);
            applySpec(element, s);
            return JSON.parse(JSON.stringify(element));
        });
    }

    function presetKeyFor(objectType) {
        var preset = typeof objectType === "number" ? PRESETS[objectType] : null;
        return preset ? preset.key : "default";
    }

    /* ------------------------------------------------------------------ */
    /* Optical Flares object                                              */
    /* ------------------------------------------------------------------ */

    var flareSetupDefinitions = {
        positionXY: vector2("2D Position", [0, 0]),
        centerPosition: vector2("Center Position", [0, 0]),
        brightness: number("Flare Brightness", 70, { min: 0, max: 1000, step: 0.5, decimals: 1 }),
        scale: number("Flare Scale", 75, { min: 0, max: 1000, step: 0.5, decimals: 1 }),
        // Restored from the donor editor: folds into the same distance factor
        // as the Global switch below, so either switch enables the effect.
        // Off by default, so existing projects render unchanged.
        scaleOffset: option("Scale Offset", 0, "off;on", true),
        rotationOffset: number("Rotation Offset", 0, { step: 1, decimals: 1, vstep: 15 }),
        color: color("Flare Color", [1, 1, 1]),
        colorMode: option("Color Mode", 0, "Tint;RGB;Alpha", true),
        animationEvolution: number("Animation Evolution", 0, { step: 1, decimals: 1, vstep: 15 }),
        gpu: option("High Quality", 1, "off;on", true),
    };

    var positioningDefinitions = {
        sourceType: option("Source", 1, "Screen (2D);Object 3D;Light", true),
        lightIndex: number("Light Index", 0, { min: 0, max: 32, step: 1, decimals: 0 }),
        occlude: option("Occlude", 0, "off;on", true),
        // Restored from the donor editor so its projects keep the value.
        // Occlusion here is per pixel through the depth buffer, so Fade has
        // no render effect; 100 matches the current full-occlusion look.
        fade: number("Fade Amount", 100, { min: 0, max: 100, step: 1, decimals: 0 }),
        margin: number("Edge Margin", 0.25, { min: 0, max: 2, step: 0.01, decimals: 2 }),
        distanceFalloff: number("Distance Falloff", 0, { min: 0, max: 2, step: 0.01, decimals: 2 }),
        referenceDistance: number("Reference Distance", 10, { min: 0.01, max: 1000, step: 0.1, decimals: 1 }),
    };

    var flickerDefinitions = {
        amount: number("Amount", 0, { min: 0, max: 100, step: 0.5, decimals: 1 }),
        speed: number("Speed", 2, { min: 0, max: 20, step: 0.1, decimals: 1 }),
    };

    var customLayerDefinitions = {
        layer1: asset("Custom Layer 1"),
        layer2: asset("Custom Layer 2"),
        layer3: asset("Custom Layer 3"),
    };

    var motionBlurDefinitions = {
        renderMode: option("Render Mode", 0, "On Black;Transparent", true),
    };

    // Applies to every element of the stack. Element-level names are kept
    // distinct from these so each label is unique in the property panel.
    var globalDefinitions = {
        scale: number("Element Scale", 100, { min: 0, max: 1000, step: 0.1, decimals: 1 }),
        scaleOffset: option("Element Scale With Distance", 0, "off;on", true),
        aspectRatio: number("Element Aspect Ratio", 1, { min: 0.01, max: 20, step: 0.01, decimals: 2 }),
        blendMode: option("Element Blend Mode", 0, BLEND_ITEMS, true),
        color: color("Element Color", [1, 1, 1]),
        globalSeed: number("Seed", 5000, { min: 0, max: 10000, step: 1, decimals: 0, vstep: 50 }),
    };

    // Default position of a new flare. The default CM3 camera sits at Z 80 with
    // a 60 degree vertical fov on a 16:9 frame, so the half height at the
    // origin's depth is tan(30) * 80 = 46.19 and the half width is 82.13. This
    // point projects 62% of the way from the centre to the upper-left corner
    // (NDC -0.62, 0.62), so the element chain runs across the frame. Saved
    // positions are unaffected.
    var NEW_FLARE_POSITION = [-50.9, 28.6, 0];

    var transformDefinitions = {
        position: {
            dynamic: true,
            group: true,
            name: "Position",
            type: PZ.property.type.VECTOR3,
            objects: [
                { dynamic: true, name: "Position.X", type: PZ.property.type.NUMBER, value: NEW_FLARE_POSITION[0] },
                { dynamic: true, name: "Position.Y", type: PZ.property.type.NUMBER, value: NEW_FLARE_POSITION[1] },
                { dynamic: true, name: "Position.Z", type: PZ.property.type.NUMBER, value: NEW_FLARE_POSITION[2] },
            ],
        },
        rotation: {
            dynamic: true,
            group: true,
            name: "Rotation",
            type: PZ.property.type.VECTOR3,
            scaleFactor: DEG,
            objects: [
                { dynamic: true, name: "Rotation.X", type: PZ.property.type.NUMBER, value: 0, scaleFactor: DEG },
                { dynamic: true, name: "Rotation.Y", type: PZ.property.type.NUMBER, value: 0, scaleFactor: DEG },
                { dynamic: true, name: "Rotation.Z", type: PZ.property.type.NUMBER, value: 0, scaleFactor: DEG },
            ],
        },
        scale: {
            dynamic: true,
            group: true,
            name: "Scale",
            type: PZ.property.type.VECTOR3,
            linkRatio: true,
            objects: [
                { dynamic: true, name: "Scale.X", type: PZ.property.type.NUMBER, value: 1, min: 0.001, step: 0.1, decimals: 3 },
                { dynamic: true, name: "Scale.Y", type: PZ.property.type.NUMBER, value: 1, min: 0.001, step: 0.1, decimals: 3 },
                { dynamic: true, name: "Scale.Z", type: PZ.property.type.NUMBER, value: 1, min: 0.001, step: 0.1, decimals: 3 },
            ],
        },
    };

    // Shared by the source lookup and the render hook. Renders the quad's
    // source uniforms without reading any state from a previous frame.
    function worldPosition(object3d) {
        if (!object3d || !object3d.threeObj) return null;
        var node = object3d.threeObj;
        if (typeof node.updateWorldMatrix === "function") {
            node.updateWorldMatrix(true, false);
        } else {
            // CM3 ships THREE r91, before updateWorldMatrix was introduced.
            // Refresh the ancestor chain as well as the source's local matrix.
            while (node.parent) node = node.parent;
            node.updateMatrixWorld(true);
        }
        var e = object3d.threeObj.matrixWorld.elements;
        return [e[12], e[13], e[14]];
    }

    // Rewrite uniforms from the camera drawing the color pass. The runtime
    // preserves this callback around CM3's velocity traversal.
    function hookRender(quad, onRender) {
        var previous = quad.onBeforeRender;
        quad.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
            onRender(camera);
            if (typeof previous === "function") {
                previous.call(this, renderer, scene, camera, geometry, material, group);
            }
        };
    }

    PZ.object3d.optflares = class extends PZ.object3d {
        constructor() {
            super();
            this.objectType = 0;
            this.threeObj = new THREE.Object3D();
            this.threeObj.frustumCulled = false;
            this.stack = new PZ.objectList(this, PZ.object3d.optflares.element);
            this.stack.name = "Stack";
            this.children.push(this.stack);

            var positioning = new PZ.propertyList({
                sourceType: positioningDefinitions.sourceType,
                lightIndex: positioningDefinitions.lightIndex,
                distanceFalloff: positioningDefinitions.distanceFalloff,
                referenceDistance: positioningDefinitions.referenceDistance,
                margin: positioningDefinitions.margin,
                foreground: new PZ.propertyList({
                    occlude: positioningDefinitions.occlude,
                    fade: positioningDefinitions.fade,
                }),
                flicker: new PZ.propertyList(flickerDefinitions),
                customLayers: new PZ.propertyList(customLayerDefinitions),
            });

            this.properties.addAll({
                flareSetup: new PZ.propertyList(flareSetupDefinitions),
                positioning: positioning,
                motionBlur: new PZ.propertyList(motionBlurDefinitions),
                global: new PZ.propertyList(globalDefinitions),
                position: PZ.property.create(transformDefinitions.position),
                rotation: PZ.property.create(transformDefinitions.rotation),
                scale: PZ.property.create(transformDefinitions.scale),
            });
            var groups = {
                flareSetup: "Flare Setup",
                positioning: "Source",
                motionBlur: "Motion Blur",
                global: "Global Parameters",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            var subgroupNames = {
                foreground: "Occlusion",
                flicker: "Flicker",
                customLayers: "Custom Layers",
            };
            for (var sub in subgroupNames) {
                Object.defineProperty(positioning[sub], "displayName", { value: subgroupNames[sub], writable: true });
            }

            this.material = null;
            this.quad = null;
            this._whiteTexture = null;
            this._customTextures = { uCustom1: null, uCustom2: null, uCustom3: null };
            this._customValues = {};
            this._dataA = new Float32Array(MAX_ELEMENTS * 4);
            this._dataB = new Float32Array(MAX_ELEMENTS * 4);
            this._dataC = new Float32Array(MAX_ELEMENTS * 4);
            this._dataD = new Float32Array(MAX_ELEMENTS * 4);
            this._dataColor = new Float32Array(MAX_ELEMENTS * 3);
            // Per-frame values from update(); read by the render hook.
            this._frame = {
                sourceType: 1,
                screenSource: [0, 0],
                center: [0, 0],
                light: null,
                brightness: 1,
                scale: 1,
                margin: 0.25,
                reference: 10,
                falloff: 0,
                occlude: false,
                resolution: DEFAULT_RESOLUTION,
            };
        }
        load(e) {
            this.unloadStack();
            if (e && typeof e === "object" && typeof e.objectType === "number") {
                this.objectType = e.objectType;
            }
            loadProperties(this.properties, e && e.properties);
            // A saved stack is authoritative, even when empty. Presets only seed
            // a brand-new object, which has no stack field yet.
            if (e && typeof e === "object" && Array.isArray(e.stack)) {
                for (var k = 0; k < e.stack.length; k++) {
                    var element = new PZ.object3d.optflares.element();
                    this.stack.push(element);
                    element.loading = element.load(e.stack[k]);
                }
            } else {
                this.stack.push.apply(this.stack, this.elementsFor(presetKeyFor(this.objectType)));
            }
            liveFlares.add(this);
            this.ensureMaterial();
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, objectType: this.objectType, properties: this.properties, stack: this.stack };
        }
        isLive() {
            return liveFlares.has(this);
        }
        unload() {
            liveFlares.delete(this);
            this.unloadStack();
            this.releaseCustomTextures();
            if (this.quad && this.quad.parent) this.quad.parent.remove(this.quad);
            if (this.underQuad && this.underQuad.parent) this.underQuad.parent.remove(this.underQuad);
            if (this.quad && this.quad.geometry) this.quad.geometry.dispose();
            if (this.material) this.material.dispose();
            if (this.underMaterial) this.underMaterial.dispose();
            this.underMaterial = null;
            this.underQuad = null;
            if (this._whiteTexture) this._whiteTexture.dispose();
            this.material = null;
            this.quad = null;
            this._whiteTexture = null;
        }
        unloadStack() {
            for (var i = 0; i < this.stack.length; i++) this.stack[i].unload();
            this.stack.splice(0, this.stack.length);
        }
        elementsFor(key) {
            return presetData(key).map(function (data) {
                var element = new PZ.object3d.optflares.element();
                element.load(data);
                return element;
            });
        }
        applyPreset(key) {
            this.unloadStack();
            this.stack.push.apply(this.stack, this.elementsFor(key));
        }
        ensureMaterial() {
            if (this.material) return;
            if (!this._whiteTexture) this._whiteTexture = whiteTexture();
            var vector4 = function (array) {
                return { type: "v4", value: array };
            };
            this.material = new THREE.ShaderMaterial({
                uniforms: {
                    uSource: { type: "v2", value: new THREE.Vector2(0, 0) },
                    uCenter: { type: "v2", value: new THREE.Vector2(0, 0) },
                    uViewAspect: { type: "f", value: 16 / 9 },
                    uDepth: { type: "f", value: 0 },
                    uBrightness: { type: "f", value: 0 },
                    uGain: { type: "f", value: 1 },
                    uScale: { type: "f", value: 1 },
                    uAspect: { type: "f", value: 1 },
                    uRotation: { type: "f", value: 0 },
                    uEvolution: { type: "f", value: 0 },
                    uTime: { type: "f", value: 0 },
                    uFlickerAmount: { type: "f", value: 0 },
                    uFlickerSpeed: { type: "f", value: 2 },
                    uGpu: { type: "f", value: 1 },
                    uColorMode: { type: "f", value: 0 },
                    uRenderMode: { type: "f", value: 0 },
                    uBlendGlobal: { type: "f", value: 0 },
                    uTint: { type: "v3", value: new THREE.Vector3(1, 1, 1) },
                    uElementCount: { type: "f", value: 0 },
                    eDataA: vector4(this._dataA),
                    eDataB: vector4(this._dataB),
                    eDataC: vector4(this._dataC),
                    eDataD: vector4(this._dataD),
                    eColor: { type: "v3", value: this._dataColor },
                    uCustom1: { type: "t", value: this._whiteTexture },
                    uCustom2: { type: "t", value: this._whiteTexture },
                    uCustom3: { type: "t", value: this._whiteTexture },
                },
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor,
                blendDst: THREE.OneFactor,
                blendEquation: THREE.AddEquation,
            });
            this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.material);
            this.quad.__zoidiumOpticalFlareQuad = true;
            this.quad.frustumCulled = false;
            this.quad.matrixAutoUpdate = false;
            this.quad.renderOrder = 9999;
            var self = this;
            hookRender(this.quad, function (camera) {
                self.prepareFrame(camera);
            });
            this.threeObj.add(this.quad);
            // Foreground fade: the depth-tested quad draws the flare at "fade"
            // strength and this untested quad draws the rest underneath it, so
            // occluded pixels keep (1 - fade) of the flare and visible pixels
            // add up to full strength. It shares every uniform except uGain.
            var underUniforms = Object.assign({}, this.material.uniforms, { uGain: { type: "f", value: 0 } });
            this.underMaterial = new THREE.ShaderMaterial({
                uniforms: underUniforms,
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                transparent: true,
                depthTest: false,
                depthWrite: false,
            });
            this.underQuad = new THREE.Mesh(this.quad.geometry, this.underMaterial);
            this.underQuad.frustumCulled = false;
            this.underQuad.matrixAutoUpdate = false;
            this.underQuad.renderOrder = 9998;
            this.underQuad.visible = false;
            hookRender(this.underQuad, function (camera) {
                self.prepareFrame(camera);
            });
            this.threeObj.add(this.underQuad);
            this.applyGlobalBlending(0);
        }
        applyGlobalBlending(mode) {
            if (!this.material) return;
            this.material.uniforms.uBlendGlobal.value = mode;
            if (this._appliedBlend === mode) return;
            this._appliedBlend = mode;
            this.material.blending = THREE.CustomBlending;
            this.material.blendSrc = THREE.OneFactor;
            this.material.blendDst = THREE.OneFactor;
            this.material.blendEquation = THREE.AddEquation;
            if (mode === 1) {
                this.material.blendDst = THREE.OneMinusSrcColorFactor;
            } else if (mode === 2) {
                this.material.blending = THREE.NormalBlending;
            }
            this.material.needsUpdate = true;
            if (this.underMaterial) {
                this.underMaterial.blending = this.material.blending;
                this.underMaterial.blendSrc = this.material.blendSrc;
                this.underMaterial.blendDst = this.material.blendDst;
                this.underMaterial.blendEquation = this.material.blendEquation;
                this.underMaterial.needsUpdate = true;
            }
        }
        releaseCustomTextures() {
            var project = this.tryGetParentOfType(PZ.project);
            for (var key in this._customTextures) {
                var texture = this._customTextures[key];
                if (texture) {
                    this.disposeCustomTexture(key);
                    if (project) project.assets.unload(texture);
                    this._customTextures[key] = null;
                }
                this._customValues[key] = undefined;
            }
            if (this.material && this._whiteTexture) {
                this.material.uniforms.uCustom1.value = this._whiteTexture;
                this.material.uniforms.uCustom2.value = this._whiteTexture;
                this.material.uniforms.uCustom3.value = this._whiteTexture;
            }
        }
        disposeCustomTexture(key) {
            var uniform = this.material && this.material.uniforms[key];
            if (uniform && uniform.value && uniform.value !== this._whiteTexture) {
                uniform.value.dispose();
                uniform.value = this._whiteTexture;
            }
        }
        updateCustomTexture(property, uniformName, time) {
            var project = this.tryGetParentOfType(PZ.project);
            var value = property ? property.get(time) : null;
            if (this._customValues[uniformName] === value) return;
            var old = this._customTextures[uniformName];
            if (old) {
                this.disposeCustomTexture(uniformName);
                if (project) project.assets.unload(old);
                this._customTextures[uniformName] = null;
            }
            this._customValues[uniformName] = value;
            if (value && project) {
                this._customTextures[uniformName] = new PZ.asset.image(project.assets.load(value));
            }
            var texture = this._customTextures[uniformName];
            this.material.uniforms[uniformName].value = texture ? texture.getTexture(true) : this._whiteTexture;
        }
        findLight(index) {
            var layer = this.tryGetParentOfType(PZ.layer);
            if (!layer || !layer.objects) return null;
            var lights = [];
            layer.objects.forEachItemOfType(PZ.object3d.light, function (light) {
                lights.push(light);
            });
            if (!lights.length) return null;
            return lights[Math.max(0, Math.min(lights.length - 1, Math.round(index || 0)))] || null;
        }
        // Phase 1: property values at `time`. Nothing here depends on the
        // camera or on other objects' transforms.
        update(time) {
            this.ensureMaterial();
            var props = this.properties;
            var setup = props.flareSetup;
            var positioning = props.positioning;
            var frame = this._frame;

            if (props.position) {
                var position = props.position.get(time);
                this.threeObj.position.set(position[0], position[1], position[2]);
            }
            if (props.rotation) {
                var rotation = props.rotation.get(time);
                this.threeObj.rotation.set(rotation[0], rotation[1], rotation[2]);
            }
            if (props.scale) {
                var scale = props.scale.get(time);
                this.threeObj.scale.set(scale[0], scale[1], scale[2]);
            }

            var layer = this.tryGetParentOfType(PZ.layer);
            var resolution = DEFAULT_RESOLUTION;
            if (layer && layer.properties && layer.properties.resolution) {
                var res = layer.properties.resolution.get(time);
                if (res && res.length === 2 && res[0] > 0 && res[1] > 0) resolution = res;
            }
            var sequence = this.tryGetParentOfType(PZ.sequence);
            var rate = sequence && sequence.properties.rate ? Math.max(1, sequence.properties.rate.get(time)) : 30;

            var sourceType = Math.round(positioning.sourceType.get(time));
            frame.sourceType = sourceType;
            frame.resolution = resolution;
            frame.center = math.offsetToLayout(setup.centerPosition.get(time), resolution[1]);
            frame.screenSource = math.offsetToLayout(setup.positionXY.get(time), resolution[1]);
            frame.light = sourceType === 2 ? this.findLight(positioning.lightIndex.get(time)) : null;
            frame.occlude = sourceType !== 0 && positioning.foreground.occlude.get(time) === 1;
            frame.fade = Math.max(0, Math.min(100, Number(positioning.foreground.fade.get(time)) || 0)) / 100;
            frame.margin = Math.max(0, positioning.margin.get(time));
            frame.reference = positioning.referenceDistance.get(time);
            frame.falloff = Math.max(0, positioning.distanceFalloff.get(time));
            frame.brightness = setup.brightness.get(time) / 100;
            frame.scale = (setup.scale.get(time) / 100) * (props.global.scale.get(time) / 100);

            var u = this.material.uniforms;
            u.uCenter.value.set(frame.center[0], frame.center[1]);
            u.uScale.value = frame.scale;
            u.uAspect.value = Math.max(0.01, props.global.aspectRatio.get(time));
            u.uRotation.value = setup.rotationOffset.get(time) * DEG;
            u.uEvolution.value = setup.animationEvolution.get(time) * DEG;
            u.uTime.value = time / rate;
            u.uFlickerAmount.value = positioning.flicker.amount.get(time) / 100;
            u.uFlickerSpeed.value = positioning.flicker.speed.get(time);
            u.uGpu.value = setup.gpu.get(time) === 1 ? 1 : 0;
            u.uColorMode.value = Math.round(setup.colorMode.get(time));
            u.uRenderMode.value = Math.round(props.motionBlur.renderMode.get(time));
            var tint = setup.color.get(time);
            u.uTint.value.set(tint[0], tint[1], tint[2]);
            this.applyGlobalBlending(Math.round(props.global.blendMode.get(time)));

            this.updateCustomTexture(positioning.customLayers.layer1, "uCustom1", time);
            this.updateCustomTexture(positioning.customLayers.layer2, "uCustom2", time);
            this.updateCustomTexture(positioning.customLayers.layer3, "uCustom3", time);

            var count = Math.min(this.stack.length, MAX_ELEMENTS);
            var dataA = this._dataA;
            var dataB = this._dataB;
            var dataC = this._dataC;
            var dataD = this._dataD;
            var dataColor = this._dataColor;
            var rootOffset = props.global.scaleOffset.get(time) === 1 || setup.scaleOffset.get(time) === 1;
            var seedBase = props.global.globalSeed.get(time) * 0.001;
            var globalColor = props.global.color.get(time);
            var anySolo = false;
            for (var s = 0; s < count; s++) {
                if (this.stack[s].properties.element.solo.get(time) === 1) {
                    anySolo = true;
                    break;
                }
            }
            var anyEnabled = false;
            for (var i = 0; i < count; i++) {
                var element = this.stack[i];
                var p = element.properties;
                var distance = p.element.distance.get(time);
                var elementScale = p.globalParams.scaleOffset.get(time) === 1 ? 1 / (1 + Math.max(0, distance) / 100) : 1;
                var offsetFactor = rootOffset ? 1 / (1 + Math.max(0, distance) / 100) : 1;
                var o = i * 4;
                dataA[o] = (p.globalParams.scale.get(time) / 100) * elementScale * offsetFactor;
                dataA[o + 1] = Math.max(0.01, p.globalParams.aspectRatio.get(time));
                dataA[o + 2] = (p.globalParams.globalSeed.get(time) + seedBase) * 0.001;
                dataA[o + 3] = p.element.opacity.get(time) / 100;
                dataB[o] = p.element.rotation.get(time) * DEG;
                dataB[o + 1] = distance / 100;
                dataB[o + 2] = p.element.animate.get(time) === 1 ? 1 : 0;
                dataB[o + 3] = Math.round(p.lensTexture.textureImage.get(time));
                dataC[o] = p.lensTexture.illuminationRadius.get(time);
                dataC[o + 1] = p.lensTexture.falloff.get(time);
                dataC[o + 2] = p.matteBox.startRange.get(time);
                dataC[o + 3] = p.matteBox.fadeAmount.get(time);
                dataD[o] = Math.round(p.matteBox.shape.get(time));
                dataD[o + 1] = Math.round(p.globalParams.blendMode.get(time));
                dataD[o + 2] = Math.round(p.element.elementType.get(time));
                var enabled = p.element.enabled.get(time) === 1;
                var solod = p.element.solo.get(time) === 1;
                var visible = enabled && (!anySolo || solod);
                dataD[o + 3] = visible ? 1 : 0;
                anyEnabled = anyEnabled || visible;
                var elementColor = p.globalParams.color.get(time);
                dataColor[i * 3] = elementColor[0] * globalColor[0];
                dataColor[i * 3 + 1] = elementColor[1] * globalColor[1];
                dataColor[i * 3 + 2] = elementColor[2] * globalColor[2];
            }
            u.uElementCount.value = count;
            this.quad.visible = anyEnabled;
            // Decided here (not in the render hook) so it applies to this frame.
            if (this.underQuad) this.underQuad.visible = anyEnabled && frame.occlude && frame.fade < 1;
        }
        // Phase 2, from the render hook of the quad: the camera drawing the
        // pass and the world transforms of this frame. Everything is recomputed
        // on every call.
        prepareFrame(camera) {
            var frame = this._frame;
            var u = this.material.uniforms;
            var resolution = frame.resolution;
            var aspect = resolution[0] / resolution[1];
            var state = null;
            if (frame.sourceType === 0) {
                state = { source: frame.screenSource, depth: null, fade: 1, scale: 1 };
            } else if (camera && camera.matrixWorldInverse && camera.projectionMatrix) {
                var world = frame.sourceType === 2
                    ? worldPosition(frame.light)
                    : worldPosition(this);
                if (world) {
                    state = math.screenState({
                        world: world,
                        view: camera.matrixWorldInverse.elements,
                        proj: camera.projectionMatrix.elements,
                        aspect: aspect,
                        margin: frame.margin,
                        reference: frame.reference,
                        falloff: frame.falloff,
                    });
                }
            }
            u.uViewAspect.value = aspect;
            if (state) {
                u.uSource.value.set(state.source[0], state.source[1]);
                u.uDepth.value = state.depth != null ? Math.max(-1, Math.min(1, state.depth)) : 0;
                u.uBrightness.value = frame.brightness * state.fade;
                u.uScale.value = frame.scale * state.scale;
            } else {
                u.uBrightness.value = 0;
                u.uScale.value = frame.scale;
            }
            // Depth test only for 3D sources; the quad is at the source depth.
            var occluding = frame.occlude && state !== null && state.depth != null;
            this.material.depthTest = occluding;
            var fade = occluding ? (frame.fade != null ? frame.fade : 1) : 1;
            u.uGain.value = fade;
            if (this.underMaterial) {
                this.underMaterial.uniforms.uGain.value = occluding ? 1 - fade : 0;
            }
        }
        async prepare() {
            var keys = ["uCustom1", "uCustom2", "uCustom3"];
            for (var i = 0; i < keys.length; i++) {
                var texture = this._customTextures[keys[i]];
                if (texture) await texture.loading;
            }
        }
    };

    PZ.object3d.optflares.element = optflaresElement;
    PZ.object3d.optflares.prototype.defaultName = "Optical Flares";
    PZ.object3d.optflares.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Optical Flares" },
    };

    if (PZ.ui && PZ.ui.objectTypes) {
        PZ.ui.objectTypes.set(
            optflaresElement,
            ELEMENT_TYPES.map(function (t, index) {
                return { name: t.name, desc: t.name + " lens object.", type: index };
            })
        );
    }

    PZ.opticalflares.ELEMENT_TYPES = ELEMENT_TYPES;
    PZ.opticalflares.PRESETS = PRESETS;
    PZ.opticalflares.presetData = presetData;
    PZ.opticalflares.spec = spec;
    PZ.opticalflares.isInUse = function () {
        return liveFlares.size > 0;
    };
    PZ.opticalflares.liveCount = function () {
        return liveFlares.size;
    };
})();
