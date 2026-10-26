"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const rt = require("../plugins/material-plus/graph-runtime.js")({}, null);
const { mapRange, rampSample, sanitizeStops } = require("../plugins/material-plus/graph-catalogue.js");
const { hash, distance } = require("../plugins/material-plus/graph-procedural.js");
const blend = require("../plugins/material-plus/graph-blend.js");
const curve = require("../plugins/material-plus/graph-curves.js");
const link = (from, fromPort, to, toPort) => ({ from, fromPort, to, toPort });
const evaluate = (type, params = {}, port = "out", size = 8, time = 0) => rt.evaluate({ nodes: [{ ...rt.createNode(type, "n"), params: { ...rt.createNode(type, "n").params, ...params } }], links: [] }, size, time, {}, "n", port);
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test("Color Ramp interpolates arbitrary RGBA stops, including duplicate and boundary positions", () => {
    const stops = [[0, 0, .2, .4, .2], [.4, 1, .8, .6, .8], [1, .2, .1, 0, 1]], out = new Float64Array(4);
    for (const mode of [0, 1, 2, 3]) {
        rampSample(stops, .1, mode, out);
        const t = mode === 0 ? 0 : mode === 2 ? .25 ** 2 * (3 - .5) : .25;
        const expected = mode === 3 ? .5 * (2 * 0 + 1 * .25 + (4 - .2) * .25 ** 2 + (-3 + .2) * .25 ** 3) : t;
        near(out[0], expected);
        if (mode !== 3) near(out[3], .2 + .6 * t);
    }
    rampSample(stops, -2, 1, out); near(out[0], 0);
    rampSample(stops, 2, 1, out); near(out[0], .2);
    assert.ok(sanitizeStops([null, "bad"]).length);
    const n = rt.createNode("colorRamp", "r"), copy = rt.createNode("colorRamp", "copy"); n.params.stops[0][1] = .8;
    assert.equal(copy.params.stops[0][1], 0);
    for (const interpolation of [0, 1, 2, 3]) {
        for (const factor of [0, .1, .25, .4, .5, .75, 1, -2, 2]) {
            const pixels = evaluate("colorRamp", { stops, interpolation, factor });
            rampSample(stops, factor, interpolation, out); near(pixels[0], Math.round(out[0] * 255), 1);
            near(evaluate("colorRamp", { stops, interpolation, factor }, "alpha")[0], Math.round(out[3] * 255), 1);
        }
    }
});
test("multi-output links serialize in both layouts and sample Factor per pixel", () => {
    const checker = rt.createNode("checker", "c"), ramp = rt.createNode("colorRamp", "r"), output = rt.createNode("output", "o");
    ramp.params.stops = [[0, 1, 0, 0, .2], [1, 0, 0, 1, .8]];
    const graph = { schemaVersion: 1, nodes: [checker, ramp, output], links: [link("c", "out", "r", "factor"), link("r", "out", "o", "color"), link("r", "alpha", "o", "opacity")] };
    const result = rt.evaluate(graph, 16, 0, {});
    assert.ok(result.color.some((v, i) => i % 4 === 0 && v === 255));
    assert.deepEqual(new Set(result.opacity.filter((v, i) => i % 4 === 0)), new Set([51, 204]));
    const saved = rt.parse(JSON.stringify(graph)); assert.deepEqual(rt.parse(saved), saved);
    const legacy = { ...graph, links: graph.links.map(l => ({ from: { node: l.from, port: l.fromPort }, to: { node: l.to, port: l.toPort } })) };
    assert.deepEqual(rt.parse(legacy), saved);
    assert.deepEqual(rt.evaluate(legacy, 16, 0, {}), result);
});
test("Noise out stays byte-identical; Color is decorrelated and independent of output evaluation order", () => {
    const n = rt.createNode("noise", "n"), graph = { nodes: [n], links: [] };
    const original = rt.types.noise.evaluate(16, {}, n.params, .25);
    const rgb = rt.evaluate(graph, 16, .25, {}, "n", "color");
    assert.ok(rgb.some((v, i) => i % 4 === 0 && v !== rgb[i + 1]));
    assert.deepEqual(rt.evaluate(graph, 16, .25, {}, "n"), original);
    assert.deepEqual(rt.evaluate(graph, 16, .25, {}, "n", "color"), rgb);
});
test("Voronoi metrics match reference formulas and regular cells have known distances", () => {
    const expected = [Math.sqrt(13), 5, 3, Math.pow(2 ** 4 + 3 ** 4, .25)];
    for (let metric = 0; metric < 4; metric++) {
        near(distance(-2, 3, metric, 4), expected[metric]);
        const value = evaluate("voronoi", { scale: 2, randomness: 0, metric }, "out", 4)[0] / 255;
        near(value, metric === 0 || metric === 3 ? Math.SQRT1_2 : metric === 1 ? 1 : .5);
    }
    near(evaluate("voronoi", { scale: 2, randomness: 0, feature: 1 }, "out", 4)[0] / 255, Math.SQRT1_2);
    near(evaluate("voronoi", { scale: 2, randomness: 0, feature: 3 }, "out", 4)[(1 + 4) * 4] / 255, .5);
    const f1 = evaluate("voronoi", { feature: 0 }), smooth = evaluate("voronoi", { feature: 2 });
    for (let i = 0; i < f1.length; i += 4) assert.ok(smooth[i] <= f1[i] + 1e-5);
    const position = evaluate("voronoi", { scale: 2, randomness: 0 }, "position", 4);
    near(Math.abs(position[0] / 255), .25); near(Math.abs(position[1] / 255), .25);
});
test("Voronoi random cells match a brute-force Euclidean reference", () => {
    const params = { scale: 3, seed: 42, randomness: .7 };
    const actual = evaluate("voronoi", params, "out", 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        let nearest = Infinity;
        for (let cy = -4; cy <= 7; cy++) for (let cx = -4; cx <= 7; cx++) {
            const u = cx + .5 + (hash(cx, cy, 42) - .5) * .7, v = cy + .5 + (hash(cx, cy, 215) - .5) * .7;
            nearest = Math.min(nearest, Math.hypot(u - x / 4 * 3, v - y / 4 * 3));
        }
        near(actual[(x + y * 4) * 4] / 255, nearest);
    }
    assert.notDeepEqual(evaluate("voronoi", params, "color"), evaluate("voronoi", { ...params, seed: 43 }, "color"));
});
test("Voronoi animation and all new textures are deterministic across seeks", () => {
    for (const type of ["voronoi", "wave", "brick", "magic", "whiteNoise"]) {
        const n = rt.createNode(type, "n"); if (type === "voronoi") n.params.speedX = .5;
        const graph = { nodes: [n], links: [] }, first = rt.evaluate(graph, 16, .3, {}, "n");
        for (const t of [4, -2, 0]) rt.evaluate(graph, 16, t, {}, "n");
        assert.deepEqual(rt.evaluate(graph, 16, .3, {}, "n"), first, type);
        if (type === "voronoi") { assert.ok(rt.isAnimated(graph)); assert.notDeepEqual(first, rt.evaluate(graph, 16, .4, {}, "n")); }
    }
});
test("Wave bands/rings, directions and profiles follow their formulas", () => {
    for (let type = 0; type < 2; type++) for (let direction = 0; direction < 3; direction++) for (let profile = 0; profile < 3; profile++) {
        const pixels = evaluate("wave", { type, direction, profile, scale: 1 }, "out", 8);
        const u = .25, v = .125, phase = type ? Math.hypot(u - .5, v - .5) : direction === 1 ? v : direction === 2 ? (u + v) / Math.SQRT2 : u;
        const t = phase - Math.floor(phase), expected = profile === 1 ? t : profile === 2 ? 1 - Math.abs(2 * t - 1) : .5 - .5 * Math.cos(2 * Math.PI * phase);
        near(pixels[(2 + 8) * 4], Math.round(expected * 255), 1);
    }
    assert.notDeepEqual(evaluate("wave", { distortion: 2, detail: 1 }), evaluate("wave", { distortion: 2, detail: 5 }));
});
test("Brick mortar, White Noise cell colors, and Magic depth follow reference formulas", () => {
    const mortar = evaluate("brick", {}, "mortar"); assert.equal(mortar[0], 255); assert.ok(mortar.includes(0));
    const noise = evaluate("whiteNoise", { scale: 8, seed: 3 }, "color");
    for (let c = 0; c < 3; c++) near(noise[c], Math.round(hash(0, 0, 3 + c * 137) * 255), 1);
    const magic = evaluate("magic", { scale: 1, depth: 0 });
    assert.deepEqual(Array.from(magic.slice(0, 4)), [128, 255, 128, 255]);
    assert.notDeepEqual(evaluate("magic", { depth: 1 }), evaluate("magic", { depth: 4 }));
});
test("Map Range modes, reversed ranges and clamp match reference formulas", () => {
    const base = { value: .25, fromMin: 0, fromMax: 1, toMin: -2, toMax: 2, steps: 3, clamp: 1 };
    const expected = [-1, -2 + 4 / 3, -1.375, -1.5859375];
    for (let interpolation = 0; interpolation < 4; interpolation++) {
        near(mapRange({ ...base, interpolation }), expected[interpolation]);
        near(evaluate("mapRange", { ...base, interpolation })[0] / 255, expected[interpolation]);
    }
    near(mapRange({ ...base, interpolation: 0, value: 2 }), 2);
    near(mapRange({ ...base, interpolation: 0, clamp: 0, value: 2 }), 6);
    near(mapRange({ ...base, interpolation: 0, fromMin: 1, fromMax: 0 }), 1);
});
test("Separate/Combine RGB and HSV round-trip all channels through independent ports", () => {
    for (const space of ["RGB", "HSV"]) {
        const source = rt.createNode("color", "c"); source.params.color = [.8, .2, .4];
        const sep = rt.createNode("separate" + space, "s"), combine = rt.createNode("combine" + space, "b");
        const keys = space === "RGB" ? ["r", "g", "b"] : ["h", "s", "v"];
        const graph = { nodes: [source, sep, combine], links: [link("c", "out", "s", "color"), ...keys.map(k => link("s", k, "b", k))] };
        const actual = rt.evaluate(graph, 8, 0, {}, "b");
        for (let c = 0; c < 3; c++) near(actual[c], source.params.color[c] * 255, 2);
    }
});
test("RGB Curves reuses the effect LUT and applies its factor per pixel", () => {
    const n = rt.createNode("rgbCurves", "r"), c = rt.createNode("color", "c"); c.params.color = [.5, .25, .75];
    n.params.curves = curve.serializeState({ composite: [[0, 0], [.5, .8], [1, 1]] });
    const graph = { nodes: [c, n], links: [link("c", "out", "r", "color")] }, actual = rt.evaluate(graph, 8, 0, {}, "r");
    const lut = curve.buildLut(n.params.curves);
    for (let channel = 0; channel < 3; channel++) assert.equal(actual[channel], lut[Math.round(c.params.color[channel] * 255) * 4 + channel]);
    n.params.factor = 0;
    assert.deepEqual(Array.from(rt.evaluate(graph, 8, 0, {}, "r")), Array.from(rt.evaluate(graph, 8, 0, {}, "c")));
});
test("every appended Math mode matches its reference formula without changing old indices", () => {
    const expected = [Math.sqrt(2), Math.log(2) / Math.log(3), Math.exp(2), 2, 2, 0, 1, 2, 3, 0, 2, 2, Math.cos(2), Math.tan(2), Math.atan2(2, 3), 0, 1];
    for (let i = 0; i < expected.length; i++) near(evaluate("math", { op: 14 + i, a: 2, b: 3, c: .5 }).scalar, expected[i]);
    near(evaluate("math", { op: 21, a: 1, b: 1, c: 1 }).scalar, .75);
    near(evaluate("math", { op: 22, a: 1, b: 1, c: 1 }).scalar, 1.25);
    near(evaluate("math", { op: 19, a: -.25 }).scalar, .75);
    near(evaluate("math", { op: 24, a: -2, b: 3, c: 0 }).scalar, 1);
    near(evaluate("math", { op: 25, a: -1, b: 3 }).scalar, 1);
});
test("appended blend modes match reference formulas and HSV component selection", () => {
    const expected = [.16, .25 / .6, 0, .05, .625, .45];
    for (let i = 0; i < 6; i++) near(blend.blend(.25, .4, i + 9), i === 0 ? .25 - .2 * .25 * .75 : expected[i]);
    const a = [0, 0, 0], b = [0, 0, 0], out = [0, 0, 0];
    blend.hsv(.8, .2, .1, a); blend.hsv(.1, .6, .3, b);
    for (let mode = 15; mode <= 18; mode++) {
        blend.blendColor(.8, .2, .1, .1, .6, .3, mode, a, b, out);
        const actual = blend.hsv(...out, [0, 0, 0]);
        near(actual[0], mode === 15 || mode === 17 ? b[0] : a[0]); near(actual[1], mode === 16 || mode === 17 ? b[1] : a[1]); near(actual[2], mode === 18 ? b[2] : a[2]);
    }
});
test("worker bundled loader evaluates every new node and multi-output links", () => {
    const { GRAPH_MODULES, createGraphWorkerSource } = require("../plugins/material-plus/graph-worker.js");
    const files = Object.fromEntries(GRAPH_MODULES.map(name => [name, fs.readFileSync("plugins/material-plus/" + name, "utf8")]));
    let result;
    const ctx = vm.createContext({ console, postMessage(v) { result = v; }, performance });
    vm.runInContext(createGraphWorkerSource(files), ctx);
    for (const type of ["colorRamp", "voronoi", "wave", "brick", "magic", "whiteNoise", "mapRange", "rgbCurves", "separateRGB", "combineRGB", "separateHSV", "combineHSV", "noise"]) {
        const n = rt.createNode(type, "n");
        for (const port of rt.types[type].outputs) {
            const graph = { nodes: [n, rt.createNode("output", "o")], links: [link("n", port.key, "o", "color")] };
            ctx.onmessage({ data: { id: 1, graph, size: 8, time: .2, images: {} } });
            assert.ok(!result.error, result.error); assert.deepEqual(Array.from(result.outputs.color), Array.from(rt.evaluate(graph, 8, .2, {}).color), type + "." + port.key);
        }
    }
});

test("Mix exposes and evaluates every appended blend mode at its stable index", () => {
    const a = rt.createNode("color", "a"), b = rt.createNode("color", "b"), mix = rt.createNode("mix", "mix");
    a.params.color = [.25, .5, .75]; b.params.color = [.4, .8, .2];
    const graph = { nodes: [a, b, mix], links: [link("a", "out", "mix", "a"), link("b", "out", "mix", "b")] };
    const modes = rt.types.mix.params.find(p => p.key === "mode").items;
    assert.deepEqual(modes.slice(0, 9), ["normal", "add", "subtract", "multiply", "screen", "overlay", "darken", "lighten", "difference"]);
    assert.deepEqual(modes.slice(9), blend.names);
    const base = [.25, .5, .75].map(x => Math.round(x * 255) / 255), top = [.4, .8, .2].map(x => Math.round(x * 255) / 255);
    const h1 = new Float64Array(3), h2 = new Float64Array(3), rgb = new Float64Array(3);
    for (let mode = 9; mode < modes.length; mode++) {
        Object.assign(mix.params, { mode, opacity: .75 });
        const actual = rt.evaluate(graph, 2, 0, {}, "mix");
        if (mode >= 15) blend.blendColor(...base, ...top, mode, h1, h2, rgb);
        for (let c = 0; c < 3; c++) near(actual[c], Math.round(Math.max(0, Math.min(1, base[c] + ((mode >= 15 ? rgb[c] : blend.blend(base[c], top[c], mode)) - base[c]) * .75)) * 255), 1);
    }
});
test("new UV textures follow a connected coordinate field", () => {
    for (const type of ["voronoi", "wave", "brick", "magic", "whiteNoise"]) {
        const uv = rt.createNode("color", "uv"), n = rt.createNode(type, "n"); uv.params.color = [.25, .75, 0];
        const graph = { nodes: [uv, n], links: [link("uv", "out", "n", "uv")] }, pixels = rt.evaluate(graph, 8, 0, {}, "n");
        for (let i = 4; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) assert.equal(pixels[i + c], pixels[c], type);
    }
});
test("all recipes use only existing Output ports and preserve graph limits", () => {
    const ports = new Set(["color", "luminance", "roughness", "metalness", "bump", "opacity", "fresnel"]);
    for (const { graph } of require("../plugins/material-plus/graph-recipes.js")(rt)) {
        assert.ok(graph.nodes.length < 200 && graph.links.length < 400);
        assert.deepEqual(rt.parse(JSON.stringify(graph)), graph);
        for (const l of graph.links.filter(l => l.to === "output")) assert.ok(ports.has(l.toPort));
        assert.ok(rt.evaluate(graph, 8, 0, {}).color);
    }
});
