"use strict";

const TAU = 2 * Math.PI;
const fract = x => x - Math.floor(x);
function hash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function distance(x, y, metric, exponent) {
    x = Math.abs(x); y = Math.abs(y);
    if (metric === 1) return x + y;
    if (metric === 2) return Math.max(x, y);
    if (metric === 3 && exponent === 1) return x + y;
    if (metric === 3 && exponent !== 2) return Math.pow(Math.pow(x, exponent) + Math.pow(y, exponent), 1 / exponent);
    return Math.sqrt(x * x + y * y);
}

// Five-by-five cell neighborhood covers F2 and edge candidates in 2D.
// Cell hashes and random offsets are precomputed once, never per pixel.
function voronoi(size, inputs, p, time) {
    const scale = Math.max(.01, p.scale), randomness = Math.max(0, Math.min(1, p.randomness));
    const offsetX = (p.speedX || 0) * (time || 0), offsetY = (p.speedY || 0) * (time || 0);
    const originX = Math.floor(offsetX) - 2, originY = Math.floor(offsetY) - 2;
    const width = Math.ceil(scale) + 6, count = width * width;
    const px = new Float64Array(count), py = new Float64Array(count), colors = new Float64Array(count * 3);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
        const i = x + y * width, gx = x + originX, gy = y + originY;
        px[i] = gx + .5 + (hash(gx, gy, p.seed) - .5) * randomness;
        py[i] = gy + .5 + (hash(gx, gy, p.seed + 173) - .5) * randomness;
        for (let c = 0; c < 3; c++) colors[i * 3 + c] = hash(gx, gy, p.seed + 331 + c * 137);
    }
    const out = new Float32Array(size * size * 4), color = new Uint8ClampedArray(out.length), position = new Float32Array(out.length);
    const metric = p.metric, exponent = Math.max(.1, p.exponent), smoothness = Math.max(.0001, p.smoothness), feature = p.feature;
    const squared = feature === 3 || (feature !== 2 && (metric === 0 || metric === 3 && exponent === 2));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (x + y * size) * 4;
        const u = (inputs.uv ? inputs.uv[i] / 255 : x / size) * scale + offsetX;
        const v = (inputs.uv ? inputs.uv[i + 1] / 255 : y / size) * scale + offsetY;
        const cx = Math.floor(u) - originX, cy = Math.floor(v) - originY;
        let first = Infinity, second = Infinity, nearest = 0, smooth = Infinity;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const j = cx + dx + (cy + dy) * width;
            const ax = px[j] - u, ay = py[j] - v;
            const d = squared ? ax * ax + ay * ay : distance(ax, ay, metric, exponent);
            if (d < first) { second = first; first = d; nearest = j; } else if (d < second) second = d;
            if (feature === 2) {
                if (!Number.isFinite(smooth)) smooth = d;
                else { const h = Math.max(smoothness - Math.abs(smooth - d), 0) / smoothness; smooth = Math.min(smooth, d) - h * h * smoothness * .25; }
            }
        }
        let value = feature === 1 ? second : feature === 2 ? Math.max(0, smooth) : first;
        if (squared) value = Math.sqrt(value);
        if (feature === 3) {
            // Euclidean bisector distance. Blender's Distance to Edge is
            // geometric, independent of the selected F1/F2 distance metric.
            let edge = Infinity;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const j = cx + dx + (cy + dy) * width;
                if (j === nearest) continue;
                const ax = px[j] - px[nearest], ay = py[j] - py[nearest], length = Math.sqrt(ax * ax + ay * ay);
                if (length > 1e-12) edge = Math.min(edge, ((px[j] + px[nearest]) * .5 - u) * ax / length + ((py[j] + py[nearest]) * .5 - v) * ay / length);
            }
            value = Math.max(0, edge);
        }
        out[i] = out[i + 1] = out[i + 2] = value * 255; out[i + 3] = 255;
        for (let c = 0; c < 3; c++) color[i + c] = colors[nearest * 3 + c] * 255;
        color[i + 3] = 255;
        position[i] = (px[nearest] - offsetX) / scale * 255; position[i + 1] = (py[nearest] - offsetY) / scale * 255; position[i + 3] = 255;
    }
    return { out, color, position };
}
module.exports = function (b, { number, option, color, port, type }) {
    const uv = () => [port("uv", "UV")];
    const defs = {
        voronoi: type("Voronoi", uv(), [port("out", "Distance"), port("color", "Color"), port("position", "Position")], [
            option("feature", "Feature", ["F1", "F2", "Smooth F1", "Distance to Edge"]),
            option("metric", "Distance", ["Euclidean", "Manhattan", "Chebyshev", "Minkowski"]),
            number("exponent", "Exponent", 2, .1, 16), number("smoothness", "Smoothness", .5, .001, 1),
            number("scale", "Scale", 5, .01, 64), number("randomness", "Randomness", 1, 0, 1), number("seed", "Seed", 1, 0, 9999, 1),
            number("speedX", "Speed X", 0, -4, 4), number("speedY", "Speed Y", 0, -4, 4),
        ], (s, i, p, t) => voronoi(s, i, p, t).out, "Shader"),
        wave: type("Wave", uv(), [port("out", "Value")], [
            option("type", "Type", ["Bands", "Rings"]), option("direction", "Direction", ["X", "Y", "Diagonal"]),
            option("profile", "Profile", ["Sine", "Saw", "Triangle"]), number("scale", "Scale", 5, .01, 64),
            number("distortion", "Distortion", 0, 0, 20), number("detail", "Detail", 2, 0, 8, 1), number("seed", "Seed", 1, 0, 9999, 1),
        ]),
        brick: type("Brick", uv(), [port("out", "Color"), port("mortar", "Mortar")], [
            number("scale", "Scale", 5, .01, 64), number("width", "Width", 1, .01, 4), number("height", "Height", .5, .01, 4),
            number("mortar", "Mortar size", .04, 0, .5), number("offset", "Row offset", .5, 0, 1), number("seed", "Seed", 1, 0, 9999, 1),
            color("color1", "Brick 1", [.6, .17, .08]), color("color2", "Brick 2", [.3, .06, .03]), color("mortarColor", "Mortar", [.08, .08, .08]),
        ]),
        magic: type("Magic", uv(), [port("out", "Color")], [number("scale", "Scale", 5, .01, 64), number("depth", "Depth", 2, 0, 10, 1), number("distortion", "Distortion", 1, 0, 10)]),
        whiteNoise: type("White Noise", uv(), [port("out", "Value"), port("color", "Color")], [number("scale", "Scale", 256, 1, 4096), number("seed", "Seed", 1, 0, 9999, 1)]),
    };
    defs.voronoi.evaluateOutputs = voronoi;
    for (const id of ["wave", "brick", "magic", "whiteNoise"]) {
        defs[id].category = "Shader";
        defs[id].evaluatePort = (size, inputs, p, time, context, output) => {
            const out = b.newBuffer(size), scratch = new Float64Array(2);
            const distortion = id === "wave" && p.distortion ? b.noiseBuffer(size, { scale: p.scale, ratio: 1, octaves: Math.max(1, p.detail), seed: p.seed, brightness: 1, contrast: 1 }, 0, inputs.uv) : null;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const i = (x + y * size) * 4; p._pixel = i;
                b.coordsAt(inputs.uv, i, size, x, y, scratch);
                const u = scratch[0] * p.scale, v = scratch[1] * p.scale;
                if (id === "wave") {
                    let phase = p.type === 1 ? Math.hypot(u - p.scale * .5, v - p.scale * .5) : p.direction === 1 ? v : p.direction === 2 ? (u + v) / Math.SQRT2 : u;
                    phase += distortion ? (distortion[i] / 255 - .5) * p.distortion : 0;
                    const t = fract(phase);
                    const value = p.profile === 1 ? t : p.profile === 2 ? 1 - Math.abs(2 * t - 1) : .5 - .5 * Math.cos(TAU * phase);
                    out[i] = out[i + 1] = out[i + 2] = value * 255;
                } else if (id === "brick") {
                    const row = Math.floor(v / p.height), bx = u / p.width + (row % 2 ? p.offset : 0), col = Math.floor(bx);
                    const fx = fract(bx) * p.width, fy = fract(v / p.height) * p.height;
                    const mortar = Math.min(fx, p.width - fx, fy, p.height - fy) < p.mortar;
                    const t = hash(col, row, p.seed), c1 = p.color1, c2 = p.color2, mc = p.mortarColor;
                    for (let c = 0; c < 3; c++) out[i + c] = (output === "mortar" ? Number(mortar) : mortar ? mc[c] : c1[c] + (c2[c] - c1[c]) * t) * 255;
                } else if (id === "magic") {
                    let a = Math.sin(u + v), c = Math.cos(u - v), d = Math.sin(-u + v);
                    for (let k = 0; k < p.depth; k++) { a = Math.sin((a + c + d) * p.distortion); c = Math.cos((-a + c - d) * p.distortion); d = Math.sin((-a - c + d) * p.distortion); }
                    out[i] = (a * .5 + .5) * 255; out[i + 1] = (c * .5 + .5) * 255; out[i + 2] = (d * .5 + .5) * 255;
                } else {
                    for (let c = 0; c < 3; c++) out[i + c] = hash(Math.floor(u), Math.floor(v), p.seed + (output === "color" ? c * 137 : 0)) * 255;
                }
                out[i + 3] = 255;
            }
            return out;
        };
        defs[id].evaluate = (s, i, p, t, c) => defs[id].evaluatePort(s, i, p, t, c, "out");
    }
    return defs;
};
module.exports.hash = hash;
module.exports.distance = distance;
module.exports.voronoi = voronoi;
