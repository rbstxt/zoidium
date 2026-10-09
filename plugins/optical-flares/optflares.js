// OpenZoid Optical Flares — flare object (ported verbatim from optflares.js).
/*
 * optflares.js
 *
 * A Video Copilot "Optical Flares" style lens flare implemented as a native
 * PZ.object3d type so it lives inside a normal 3D Scene layer next to
 * Shape / Light / Camera / Particular objects.
 *
 * The effect controls mirror the After Effects plugin layout:
 *   Flare Setup > Options (Position XY, Center Position, Brightness, Scale,
 *   Scale Offset, Rotation Offset, Color, Color Mode, Animation Evolution,
 *   GPU), Positioning Mode (Source Type, Foreground Layers, Flicker, Custom
 *   Layers, Preview BG Layer) and Motion Blur (Render Mode).
 *
 * The flare itself is a stack of procedural "lens objects" (Glow, Streak,
 * Iris, Multi Iris, Shimmer, Glint, Spike Ball, Sparkle, Ring, Hoop, Caustic,
 * Lens Orbs) rendered by one screen-space shader pass. The stack is edited in
 * the Optical Flares Options window (see optflares-editor.js).
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    var MAX_ELEMENTS = 24;
    var DEG = Math.PI / 180;

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

    /* ------------------------------------------------------------------ */
    /* Lens object catalogue                                              */
    /* ------------------------------------------------------------------ */

    // type indexes are referenced by the shader and by saved projects
    var ELEMENT_TYPES = [
        { key: "glow", name: "Glow", scale: 100, distance: 5, aspect: 1, texture: 0, color: [1, 1, 1], seed: 5000 },
        { key: "multiiris", name: "Multi Iris", scale: 60, distance: 38.5, aspect: 1, texture: 0, color: [0.62, 0.72, 0.95], seed: 5100 },
        { key: "iris", name: "Iris", scale: 85, distance: 75, aspect: 1, texture: 0, color: [0.56, 0.62, 0.72], seed: 5200 },
        { key: "streak", name: "Streak", scale: 90, distance: 0, aspect: 6, texture: 0, color: [0.55, 0.72, 1], seed: 5300 },
        { key: "shimmer", name: "Shimmer", scale: 60, distance: 0, aspect: 1, texture: 0, color: [1, 1, 1], seed: 5400 },
        { key: "glint", name: "Glint", scale: 55, distance: 0, aspect: 1, texture: 0, color: [1, 1, 1], seed: 5500 },
        { key: "spikeball", name: "Spike Ball", scale: 55, distance: 0, aspect: 1, texture: 0, color: [0.92, 0.94, 1], seed: 5600 },
        { key: "sparkle", name: "Sparkle", scale: 70, distance: 0, aspect: 1, texture: 0, color: [0.85, 0.9, 1], seed: 5700 },
        { key: "ring", name: "Ring", scale: 85, distance: 120, aspect: 1, texture: 0, color: [0.9, 1, 0.95], seed: 5800 },
        { key: "hoop", name: "Hoop", scale: 150, distance: 95, aspect: 1.8, texture: 0, color: [1, 1, 1], seed: 5900 },
        { key: "caustic", name: "Caustic", scale: 90, distance: 110, aspect: 1, texture: 0, color: [0.85, 0.88, 0.92], seed: 6000 },
        { key: "lensorbs", name: "Lens Orbs", scale: 100, distance: 150, aspect: 1, texture: 0, color: [0.82, 0.84, 0.9], seed: 6100 },
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

    var VERTEX_SHADER = [
        "varying vec2 vUv;",
        "void main() {",
        "vUv = uv;",
        "gl_Position = vec4(position.xy, 0.0, 1.0);",
        "}",
    ].join("\n");

    var FRAGMENT_SHADER = [
        "precision highp float;",
        "#define MAX_ELEMENTS " + MAX_ELEMENTS,
        "varying vec2 vUv;",
        "uniform vec2 uResolution;",
        "uniform vec2 uLightPx;",
        "uniform vec2 uCenterPx;",
        "uniform float uBrightness;",
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
        "vec2 res = max(uResolution, vec2(1.0));",
        "vec2 P = vUv * res;",
        "vec2 axis = uCenterPx - uLightPx;",
        "float axisLen = length(axis);",
        "if (axisLen < 1.0) { axis = vec2(0.7071, -0.7071); axisLen = 1.0; }",
        "float baseAngle = atan(axis.y, axis.x) + uRotation;",
        "vec2 dir = vec2(cos(baseAngle), sin(baseAngle));",
        "float baseSize = res.y * 0.15 * uScale;",
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
        "vec2 anchor = uLightPx + dir * axisLen * distance;",
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
        "vec2 a2 = uLightPx + dir * axisLen * t;",
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
        "col *= uBrightness;",
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

    var elementPropertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Glow" },
    };

    var elementDefinitions = {
        elementType: option("Type", 0, ELEMENT_TYPE_ITEMS),
        enabled: option("Enabled", 1, "off;on", true),
        distance: number("Distance", 0, { min: -300, max: 500, step: 1, decimals: 1, vstep: 10 }),
        rotation: number("Rotation", 0, { step: 1, decimals: 1, vstep: 15 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        animate: option("Animate", 1, "off;on", true),
    };

    var commonDefinitions = {
        scale: number("Scale", 100, { min: 0, max: 1000, step: 0.1, decimals: 1 }),
        scaleOffset: option("Scale Offset", 0, "off;on", true),
        aspectRatio: number("Aspect Ratio", 1, { min: 0.01, max: 20, step: 0.01, decimals: 2 }),
        blendMode: option("Blend Mode", 0, BLEND_ITEMS, true),
        color: color("Color", [1, 1, 1]),
        globalSeed: number("Global Seed", 1000, { min: 0, max: 10000, step: 1, decimals: 0, vstep: 50 }),
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

    var optflaresElement = class extends PZ.object {
        static create(subType) {
            var index = typeof subType === "number" ? subType : 0;
            var element = new optflaresElement();
            element.applyType(index, true);
            return element;
        }
        constructor() {
            super();
            this.type = 0;
            this._initialized = false;
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create(elementPropertyDefinitions.name),
                    element: new PZ.propertyList(elementDefinitions),
                    globalParams: new PZ.propertyList(commonDefinitions),
                    matteBox: new PZ.propertyList(matteDefinitions),
                    lensTexture: new PZ.propertyList(lensDefinitions),
                },
                this
            );
            var groups = {
                element: "Element Settings",
                globalParams: "Common Settings",
                matteBox: "Matte Box Controls",
                lensTexture: "Lens Texture",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            var propertyList = this.properties;
            Object.defineProperty(propertyList, "toJSON", {
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
        get stackRoot() {
            return this.tryGetParentOfType(PZ.object3d.optflares);
        }
        get time() {
            return PZ.trapcode.currentTime;
        }
        applyType(index, applyDefaults) {
            if (!this._initialized) {
                this._initialized = true;
                this.properties.load(null);
            }
            var def = ELEMENT_TYPES[index] || ELEMENT_TYPES[0];
            this.type = ELEMENT_TYPES.indexOf(def);
            this.properties.element.elementType.set(this.type);
            this.properties.name.set(def.name);
            if (!applyDefaults) return;
            this.properties.element.distance.set(def.distance);
            this.properties.element.rotation.set(0);
            this.properties.element.opacity.set(100);
            this.properties.element.animate.set(1);
            this.properties.globalParams.scale.set(def.scale);
            this.properties.globalParams.scaleOffset.set(0);
            this.properties.globalParams.aspectRatio.set(def.aspect);
            this.properties.globalParams.blendMode.set(0);
            this.properties.globalParams.color.set(def.color.slice());
            this.properties.globalParams.globalSeed.set(def.seed);
            this.properties.matteBox.shape.set(0);
            this.properties.matteBox.startRange.set(25);
            this.properties.matteBox.fadeAmount.set(25);
            this.properties.lensTexture.textureImage.set(def.texture);
            this.properties.lensTexture.illuminationRadius.set(100);
            this.properties.lensTexture.falloff.set(0.5);
        }
        load(e) {
            var type = e && typeof e === "object" && typeof e.type === "number" ? e.type : 0;
            this.type = type;
            if (e && typeof e === "object" && e.properties && e.properties.element && typeof e.properties.element.elementType === "number") {
                this.type = Math.max(0, Math.min(ELEMENT_TYPES.length - 1, Math.round(e.properties.element.elementType)));
            }
            this.properties.load(e && e.properties);
            this._initialized = true;
            if (!this.properties.name.get().length) {
                this.properties.name.set((ELEMENT_TYPES[this.type] || ELEMENT_TYPES[0]).name);
            }
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {}
    };

    optflaresElement.prototype.defaultName = "Element";

    if (PZ.ui && PZ.ui.objectTypes) {
        PZ.ui.objectTypes.set(
            optflaresElement,
            ELEMENT_TYPES.map(function (t, index) {
                return { name: t.name, desc: t.name + " lens object.", type: index };
            })
        );
    }

    /* ------------------------------------------------------------------ */
    /* Preset stacks                                                      */
    /* ------------------------------------------------------------------ */

    function spec(type, overrides) {
        var def = ELEMENT_TYPES[type];
        var out = {
            type: type,
            scale: def.scale,
            distance: def.distance,
            aspect: def.aspect,
            texture: def.texture,
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

    var OPTICAL_FLARES_PRESETS = [
        { key: "default", name: "Default Lens Flare" },
        { key: "anamorphic", name: "Anamorphic Blue" },
        { key: "sparkle", name: "Sparkle Burst" },
        { key: "cinematic", name: "Cinematic Warm" },
        { key: "scifi", name: "Sci-Fi Plasma" },
    ];

    /* ------------------------------------------------------------------ */
    /* Optical Flares container                                           */
    /* ------------------------------------------------------------------ */

    var flareSetupDefinitions = {
        positionXY: vector2("Position XY", [0, 0]),
        centerPosition: vector2("Center Position", [640, 360]),
        brightness: number("Brightness", 100, { min: 0, max: 1000, step: 0.5, decimals: 1 }),
        scale: number("Scale", 100, { min: 0, max: 1000, step: 0.5, decimals: 1 }),
        scaleOffset: option("Scale Offset", 0, "off;on", true),
        rotationOffset: number("Rotation Offset", 0, { step: 1, decimals: 1, vstep: 15 }),
        color: color("Color", [1, 1, 1]),
        colorMode: option("Color Mode", 0, "Tint;RGB;Alpha", true),
        animationEvolution: number("Animation Evolution", 0, { step: 1, decimals: 1, vstep: 15 }),
        gpu: option("Use GPU", 1, "off;on", true),
    };

    var foregroundDefinitions = {
        occlude: option("Occlude", 0, "off;on", true),
        fade: number("Fade Amount", 100, { min: 0, max: 100, step: 1, decimals: 0 }),
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

    var positioningDefinitions = {
        sourceType: option("Source Type", 0, "2D;3D;Light", true),
        lightIndex: number("Light Index", 0, { min: 0, max: 32, step: 1, decimals: 0 }),
        previewBg: asset("Preview BG Layer"),
    };

    var motionBlurDefinitions = {
        renderMode: option("Render Mode", 0, "On Black;Transparent", true),
    };

    var globalDefinitions = {
        scale: number("Scale", 100, { min: 0, max: 1000, step: 0.1, decimals: 1 }),
        scaleOffset: option("Scale Offset", 0, "off;on", true),
        aspectRatio: number("Aspect Ratio", 1, { min: 0.01, max: 20, step: 0.01, decimals: 2 }),
        blendMode: option("Blend Mode", 0, BLEND_ITEMS, true),
        color: color("Color", [1, 1, 1]),
        globalSeed: number("Global Seed", 5000, { min: 0, max: 10000, step: 1, decimals: 0, vstep: 50 }),
    };

    var transformDefinitions = {
        position: {
            dynamic: true,
            group: true,
            name: "Position",
            type: PZ.property.type.VECTOR3,
            objects: [
                { dynamic: true, name: "Position.X", type: PZ.property.type.NUMBER, value: 0 },
                { dynamic: true, name: "Position.Y", type: PZ.property.type.NUMBER, value: 0 },
                { dynamic: true, name: "Position.Z", type: PZ.property.type.NUMBER, value: 0 },
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
                foreground: new PZ.propertyList(foregroundDefinitions),
                flicker: new PZ.propertyList(flickerDefinitions),
                customLayers: new PZ.propertyList(customLayerDefinitions),
                previewBg: positioningDefinitions.previewBg,
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
                positioning: "Positioning Mode",
                motionBlur: "Motion Blur",
                global: "Global Parameters",
            };
            for (var g in groups) {
                if (this.properties[g]) {
                    Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
                }
            }
            var subgroupNames = {
                foreground: "Foreground Layers",
                flicker: "Flicker",
                customLayers: "Custom Layers",
            };
            for (var sub in subgroupNames) {
                if (positioning[sub]) {
                    Object.defineProperty(positioning[sub], "displayName", {
                        value: subgroupNames[sub],
                        writable: true,
                    });
                }
            }

            this.material = null;
            this.quad = null;
            this._customTextures = { uCustom1: null, uCustom2: null, uCustom3: null };
            this._customValues = {};
            this._meshCache = null;
            this._meshCacheStamp = -1;
            this._designerPreview = null;
            this._dataA = new Float32Array(MAX_ELEMENTS * 4);
            this._dataB = new Float32Array(MAX_ELEMENTS * 4);
            this._dataC = new Float32Array(MAX_ELEMENTS * 4);
            this._dataD = new Float32Array(MAX_ELEMENTS * 4);
            this._dataColor = new Float32Array(MAX_ELEMENTS * 3);
        }
        load(e) {
            if (this.stack.length) {
                for (var i = 0; i < this.stack.length; i++) this.stack[i].unload();
                this.stack.splice(0, this.stack.length);
            }
            if (e && typeof e === "object" && typeof e.objectType === "number") {
                this.objectType = e.objectType;
            }
            this.properties.load(e && e.properties);
            if (e && typeof e === "object" && e.stack && e.stack.length) {
                for (var k = 0; k < e.stack.length; k++) {
                    var element = new PZ.object3d.optflares.element();
                    this.stack.push(element);
                    element.loading = element.load(e.stack[k]);
                }
            } else {
                this.applyPreset(this.objectType || 0);
            }
            this.ensureMaterial();
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, objectType: this.objectType, properties: this.properties, stack: this.stack };
        }
        unload() {
            for (var i = 0; i < this.stack.length; i++) this.stack[i].unload();
            this.releaseCustomTextures();
            if (this.quad && this.quad.geometry) this.quad.geometry.dispose();
            if (this.material) this.material.dispose();
            if (this._whiteTexture) this._whiteTexture.dispose();
            this.material = null;
            this.quad = null;
        }
        applyPreset(key) {
            var preset = null;
            for (var i = 0; i < OPTICAL_FLARES_PRESETS.length; i++) {
                if (OPTICAL_FLARES_PRESETS[i].key === key) preset = OPTICAL_FLARES_PRESETS[i];
            }
            if (!preset && typeof key === "number") preset = OPTICAL_FLARES_PRESETS[key] || null;
            var specs = PRESET_STACKS[preset ? preset.key : "default"] || PRESET_STACKS.default;
            for (var s = 0; s < this.stack.length; s++) this.stack[s].unload();
            this.stack.splice(0, this.stack.length);
            for (var j = 0; j < specs.length; j++) {
                var element = new PZ.object3d.optflares.element();
                element.applyType(specs[j].type, false);
                var p = element.properties;
                p.element.elementType.set(specs[j].type);
                p.element.distance.set(specs[j].distance);
                p.element.rotation.set(specs[j].rotation || 0);
                p.element.opacity.set(specs[j].opacity);
                p.element.enabled.set(specs[j].enabled);
                p.element.animate.set(1);
                p.globalParams.scale.set(specs[j].scale);
                p.globalParams.aspectRatio.set(specs[j].aspect);
                p.globalParams.blendMode.set(specs[j].blend || 0);
                p.globalParams.color.set(specs[j].color.slice());
                p.globalParams.globalSeed.set(specs[j].seed);
                p.matteBox.shape.set(0);
                p.lensTexture.textureImage.set(specs[j].texture);
                p.lensTexture.illuminationRadius.set(100);
                p.lensTexture.falloff.set(0.5);
                this.stack.push(element);
            }
        }
        ensureMaterial() {
            if (this.material) return;
            if (!this._whiteTexture) this._whiteTexture = whiteTexture();
            var accent = function (array) {
                return { type: "v4", value: array };
            };
            this.material = new THREE.ShaderMaterial({
                uniforms: {
                    uResolution: { type: "v2", value: new THREE.Vector2(1920, 1080) },
                    uLightPx: { type: "v2", value: new THREE.Vector2(-100000, -100000) },
                    uCenterPx: { type: "v2", value: new THREE.Vector2(0, 0) },
                    uBrightness: { type: "f", value: 1 },
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
                    eDataA: accent(this._dataA),
                    eDataB: accent(this._dataB),
                    eDataC: accent(this._dataC),
                    eDataD: accent(this._dataD),
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
            this.quad.frustumCulled = false;
            this.quad.matrixAutoUpdate = false;
            this.quad.renderOrder = 9999;
            this.threeObj.add(this.quad);
            this.applyGlobalBlending();
        }
        applyGlobalBlending() {
            if (!this.material || !this.properties.global) return;
            var mode = Math.round(this.properties.global.blendMode.get(PZ.trapcode.currentTime));
            this.material.uniforms.uBlendGlobal.value = mode;
            if (this._appliedBlend === mode) return;
            this._appliedBlend = mode;
            if (mode === 1) {
                this.material.blending = THREE.CustomBlending;
                this.material.blendSrc = THREE.OneFactor;
                this.material.blendDst = THREE.OneMinusSrcColorFactor;
                this.material.blendEquation = THREE.AddEquation;
            } else if (mode === 2) {
                this.material.blending = THREE.NormalBlending;
            } else {
                this.material.blending = THREE.CustomBlending;
                this.material.blendSrc = THREE.OneFactor;
                this.material.blendDst = THREE.OneFactor;
                this.material.blendEquation = THREE.AddEquation;
            }
            this.material.needsUpdate = true;
            this.material.uniforms.uBlendGlobal.value = mode;
        }
        releaseCustomTextures() {
            var project = this.tryGetParentOfType(PZ.project);
            for (var key in this._customTextures) {
                var texture = this._customTextures[key];
                if (texture) {
                    if (project) project.assets.unload(texture);
                    this._customTextures[key] = null;
                }
                this._customValues[key] = undefined;
            }
            if (this.material) {
                this.material.uniforms.uCustom1.value = this._whiteTexture;
                this.material.uniforms.uCustom2.value = this._whiteTexture;
                this.material.uniforms.uCustom3.value = this._whiteTexture;
            }
        }
        updateCustomTexture(property, uniformName, time) {
            var project = this.tryGetParentOfType(PZ.project);
            var value = property ? property.get(time) : null;
            if (this._customValues[uniformName] === value) return;
            var old = this._customTextures[uniformName];
            if (old) {
                if (project) project.assets.unload(old);
                this._customTextures[uniformName] = null;
            }
            this._customValues[uniformName] = value;
            if (value && project) {
                this._customTextures[uniformName] = new PZ.asset.image(project.assets.load(value));
            }
            if (this.material) {
                var texture = this._customTextures[uniformName];
                this.material.uniforms[uniformName].value = texture ? texture.getTexture(true) : this._whiteTexture;
            }
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
        refreshWorldMatrices() {
            var root = this.threeObj;
            var guard = 0;
            while (root && root.parent && guard++ < 64) root = root.parent;
            if (root) root.updateMatrixWorld(true);
        }
        worldPosition() {
            var position = new THREE.Vector3();
            if (!this.threeObj) return null;
            this.threeObj.getWorldPosition(position);
            return position;
        }
        collectMeshes(layer) {
            if (!layer || !layer.threeObj) return [];
            if (this._meshCache && this._meshCacheLayer === layer && this._meshCacheStamp === layer.objects.length) {
                return this._meshCache;
            }
            var list = [];
            layer.threeObj.traverse(function (object) {
                if (object.isMesh && object !== this.quad && object.geometry) list.push(object);
            }.bind(this));
            this._meshCache = list;
            this._meshCacheLayer = layer;
            this._meshCacheStamp = layer.objects.length;
            return list;
        }
        occlusionFactor(layer, camera, world) {
            if (!camera || !world) return 1;
            var origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
            var direction = world.clone().sub(origin);
            var distance = direction.length();
            if (distance < 0.01) return 1;
            direction.normalize();
            var raycaster = this._raycaster || (this._raycaster = new THREE.Raycaster());
            raycaster.set(origin, direction);
            raycaster.near = 0.1;
            raycaster.far = distance - 0.5;
            var hits = raycaster.intersectObjects(this.collectMeshes(layer), false);
            return hits && hits.length ? 0 : 1;
        }
        update(time) {
            PZ.trapcode.setTime(time);
            this.ensureMaterial();
            var props = this.properties;
            var setup = props.flareSetup;
            var positioning = props.positioning;

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
            var resolution = [1920, 1080];
            if (layer && layer.properties && layer.properties.resolution) {
                try {
                    var res = layer.properties.resolution.get(time);
                    if (res && res.length === 2) resolution = res;
                } catch (err) {}
            }
            var sequence = this.tryGetParentOfType(PZ.sequence);
            var rate = sequence && sequence.properties.rate ? Math.max(1, sequence.properties.rate.get(time)) : 30;

            var sourceType = Math.round(positioning.sourceType.get(time));
            var lightPx = null;
            var lightWorld = null;
            if (sourceType === 0) {
                var xy = setup.positionXY.get(time);
                lightPx = [resolution[0] * 0.5 + xy[0], resolution[1] * 0.5 - xy[1]];
            } else {
                if (sourceType === 1) {
                    this.refreshWorldMatrices();
                    lightWorld = this.worldPosition();
                } else {
                    var light = this.findLight(positioning.lightIndex.get(time));
                    if (light) {
                        this.refreshWorldMatrices();
                        if (light.threeObj) lightWorld = new THREE.Vector3().setFromMatrixPosition(light.threeObj.matrixWorld);
                    }
                }
                var camera = layer && layer.pass ? layer.pass.camera : null;
                if (lightWorld && camera) {
                    var view = lightWorld.clone().applyMatrix4(camera.matrixWorldInverse);
                    if (view.z < 0) {
                        var ndc = lightWorld.clone().project(camera);
                        lightPx = [(ndc.x * 0.5 + 0.5) * resolution[0], (ndc.y * 0.5 + 0.5) * resolution[1]];
                    }
                }
                this._lightWorld = lightWorld;
                this._camera = camera;
            }

            var center = setup.centerPosition.get(time);
            var centerPx = [resolution[0] * 0.5 + center[0], resolution[1] * 0.5 - center[1]];

            var preview = this._designerPreview;
            if (preview) {
                if (lightPx) {
                    lightPx[0] += preview.position[0];
                    lightPx[1] -= preview.position[1];
                }
                centerPx[0] += preview.position[0];
                centerPx[1] -= preview.position[1];
            }

            var visible = !!lightPx;
            var brightness = (setup.brightness.get(time) / 100) * (preview ? preview.brightness : 1);
            if (visible && positioning.foreground.occlude.get(time) === 1 && sourceType !== 0) {
                var factor = this.occlusionFactor(layer, this._camera, lightWorld);
                if (factor < 1) {
                    brightness *= 1 - (positioning.foreground.fade.get(time) / 100) * (1 - factor);
                }
            }

            var u = this.material.uniforms;
            u.uResolution.value.set(resolution[0], resolution[1]);
            u.uLightPx.value.set(lightPx ? lightPx[0] : -100000, lightPx ? lightPx[1] : -100000);
            u.uCenterPx.value.set(centerPx[0], centerPx[1]);
            u.uBrightness.value = visible ? brightness : 0;
            u.uScale.value = (setup.scale.get(time) / 100) * (props.global.scale.get(time) / 100) * (preview ? preview.scale : 1);
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
            this.applyGlobalBlending();

            this.updateCustomTexture(positioning.customLayers.layer1, "uCustom1", time);
            this.updateCustomTexture(positioning.customLayers.layer2, "uCustom2", time);
            this.updateCustomTexture(positioning.customLayers.layer3, "uCustom3", time);

            var count = Math.min(this.stack.length, MAX_ELEMENTS);
            var dataA = this._dataA;
            var dataB = this._dataB;
            var dataC = this._dataC;
            var dataD = this._dataD;
            var dataColor = this._dataColor;
            var rootOffset = props.global.scaleOffset.get(time) === 1;
            var seedBase = props.global.globalSeed.get(time) * 0.001;
            var globalColor = props.global.color.get(time);
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
                dataD[o + 3] = p.element.enabled.get(time) === 1 ? 1 : 0;
                var elementColor = p.globalParams.color.get(time);
                dataColor[i * 3] = elementColor[0] * globalColor[0];
                dataColor[i * 3 + 1] = elementColor[1] * globalColor[1];
                dataColor[i * 3 + 2] = elementColor[2] * globalColor[2];
            }
            u.uElementCount.value = count;
            if (this.quad) this.quad.visible = visible && checkElementVisible(this.stack);
        }
        async prepare() {
            var keys = ["uCustom1", "uCustom2", "uCustom3"];
            for (var i = 0; i < keys.length; i++) {
                var texture = this._customTextures[keys[i]];
                if (texture) await texture.loading;
            }
        }
    };

    function checkElementVisible(stack) {
        var solo = false;
        var i;
        for (i = 0; i < stack.length; i++) {
            if (stack[i]._solo) solo = true;
        }
        for (i = 0; i < stack.length; i++) {
            var element = stack[i];
            if (element.properties.element.enabled.get(PZ.trapcode.currentTime) !== 1) continue;
            if (solo && !element._solo) continue;
            return true;
        }
        return false;
    }

    PZ.object3d.optflares.element = optflaresElement;
    PZ.object3d.optflares.ELEMENT_TYPES = ELEMENT_TYPES;
    PZ.object3d.optflares.PRESETS = OPTICAL_FLARES_PRESETS;
    PZ.object3d.optflares.PRESET_STACKS = PRESET_STACKS;
    PZ.object3d.optflares.prototype.defaultName = "Optical Flares";
    PZ.object3d.optflares.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Optical Flares" },
    };

    if (PZ.trapcode && PZ.trapcode.designer) {
        PZ.trapcode.designer.registerConfig(PZ.object3d.optflares, {
            title: "Optical Flares Options",
            customOpen: function (root, designer) {
                if (PZ.opticalflares && PZ.opticalflares.open) {
                    PZ.opticalflares.open(root, designer);
                }
            },
        });
    }
})();
