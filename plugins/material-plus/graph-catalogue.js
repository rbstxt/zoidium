"use strict";

const curves = require("./graph-curves.js");
const { hsv, rgb } = require("./graph-blend.js");
const procedural = require("./graph-procedural.js");

// New nodes live apart from the historical registry so its serialized ports
// and option indices stay stable. Numeric/color sockets are added by the host.
module.exports = function catalogue(b) {
    const number = (key, name, value, min, max, step = .01) => ({ key, name, type: "number", value, min, max, step });
    const option = (key, name, items) => ({ key, name, type: "option", items, value: 0 });
    const color = (key, name, value) => ({ key, name, type: "color", value });
    const port = (key, name) => ({ key, name });
    const type = (name, inputs, outputs, params, evaluate, category = "Converter") => ({ name, category, inputs, outputs, params, evaluate });
    const grayscale = (size, p, fn) => {
        const out = new Float32Array(size * size * 4);
        for (let i = 0; i < out.length; i += 4) {
            p._pixel = i;
            const v = fn(i) * 255;
            out[i] = out[i + 1] = out[i + 2] = Number.isFinite(v) ? v : 0; out[i + 3] = 255;
        }
        return out;
    };
    const defs = {
        colorRamp: type("Color Ramp", [], [port("out", "Color"), port("alpha", "Alpha")], [
            number("factor", "Factor", .5, 0, 1), option("interpolation", "Interpolation", ["Constant", "Linear", "Ease", "Cardinal"]),
            { key: "stops", name: "Stops", type: "ramp", value: [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]], sanitize: sanitizeStops },
        ]),
        mapRange: type("Map Range", [], [port("out", "Value")], [
            number("value", "Value", .5), number("fromMin", "From min", 0), number("fromMax", "From max", 1),
            number("toMin", "To min", 0), number("toMax", "To max", 1),
            option("interpolation", "Interpolation", ["Linear", "Stepped", "Smoothstep", "Smootherstep"]),
            number("steps", "Steps", 4, 1, 1000, 1), { ...option("clamp", "Clamp", ["Off", "On"]), value: 1 },
        ], (size, inputs, p) => grayscale(size, p, () => mapRange(p))),
        rgbCurves: type("RGB Curves", [port("color", "Color")], [port("out", "Color")], [
            number("factor", "Factor", 1, 0, 1),
            { key: "curves", name: "Curves", type: "curve", value: curves.defaultValue, sanitize: v => curves.serializeState(curves.parseState(v)) },
        ], (size, inputs, p) => {
            const lut = curves.buildLut(p.curves), source = inputs.color || b.colorBuffer(size, [0, 0, 0]), out = b.newBuffer(size);
            for (let i = 0; i < out.length; i += 4) {
                p._pixel = i;
                const factor = b.clamp(p.factor, 0, 1);
                for (let c = 0; c < 3; c++) out[i + c] = source[i + c] + (lut[source[i + c] * 4 + c] - source[i + c]) * factor;
                out[i + 3] = 255;
            }
            return out;
        }),
    };
    defs.colorRamp.params[1].value = 1;
    defs.colorRamp.evaluatePort = (size, inputs, p, time, context, output) => {
        const stops = sanitizeStops(p.stops), out = b.newBuffer(size), sample = new Float64Array(4);
        for (let i = 0; i < out.length; i += 4) {
            p._pixel = i;
            rampSample(stops, p.factor, p.interpolation, sample);
            for (let c = 0; c < 3; c++) out[i + c] = sample[output === "alpha" ? 3 : c] * 255;
            out[i + 3] = output === "alpha" ? 255 : sample[3] * 255;
        }
        return out;
    };
    defs.colorRamp.evaluate = (s, i, p) => defs.colorRamp.evaluatePort(s, i, p, 0, {}, "out");
    for (const space of ["RGB", "HSV"]) {
        const keys = space === "RGB" ? ["r", "g", "b"] : ["h", "s", "v"];
        const names = space === "RGB" ? ["Red", "Green", "Blue"] : ["Hue", "Saturation", "Value"];
        const separate = type("Separate " + space, [port("color", "Color")], keys.map((k, i) => port(k, names[i])), []);
        separate.evaluatePort = (size, inputs, p, time, context, output) => {
            const scratch = new Float64Array(3);
            const source = inputs.color || b.colorBuffer(size, [0, 0, 0]), channel = Math.max(0, keys.indexOf(output));
            return grayscale(size, p, i => space === "RGB" ? source[i + channel] / 255 : hsv(source[i] / 255, source[i + 1] / 255, source[i + 2] / 255, scratch)[channel]);
        };
        separate.evaluate = (s, i, p) => separate.evaluatePort(s, i, p, 0, {}, keys[0]);
        defs["separate" + space] = separate;
        defs["combine" + space] = type("Combine " + space, [], [port("out", "Color")], keys.map((k, i) => number(k, names[i], 0, 0, 1)), (size, inputs, p) => {
            const out = b.newBuffer(size), scratch = new Float64Array(3);
            for (let i = 0; i < out.length; i += 4) {
                p._pixel = i;
                const result = space === "RGB" ? null : rgb(p.h, p.s, p.v, scratch);
                for (let c = 0; c < 3; c++) out[i + c] = (result ? result[c] : p[keys[c]]) * 255;
                out[i + 3] = 255;
            }
            return out;
        });
    }
    Object.assign(defs, procedural(b, { number, option, color, port, type }));
    for (const [id, aliases] of Object.entries({ colorRamp: ["ColorRamp", "Ramp"], mapRange: ["Remap"], rgbCurves: ["Color Curves"], separateRGB: ["Separate Color"], combineRGB: ["Combine Color"] })) defs[id].aliases = aliases;
    return defs;
};

function sanitizeStops(value) {
    if (!Array.isArray(value) || !value.length) return [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]];
    const result = value.slice(0, 256).filter(s => Array.isArray(s) && s.length >= 5).map(s => s.slice(0, 5).map(v => Math.max(0, Math.min(1, Number(v) || 0)))).sort((a, b) => a[0] - b[0]);
    return result.length ? result : [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]];
}
function rampSample(stops, value, mode, result) {
    const t = Math.max(0, Math.min(1, value));
    let index = 0;
    while (index < stops.length - 1 && stops[index + 1][0] <= t) index++;
    const a = stops[index], z = stops[Math.min(index + 1, stops.length - 1)];
    let f = Math.max(0, Math.min(1, (t - a[0]) / (z[0] - a[0] || 1)));
    if (mode === 0) f = 0;
    if (mode === 2) f = f * f * (3 - 2 * f);
    for (let c = 0; c < 4; c++) {
        const x = a[c + 1], y = z[c + 1];
        let v = x + (y - x) * f;
        if (mode === 3) {
            const before = stops[Math.max(0, index - 1)][c + 1], after = stops[Math.min(stops.length - 1, index + 2)][c + 1];
            v = .5 * ((2 * x) + (-before + y) * f + (2 * before - 5 * x + 4 * y - after) * f * f + (-before + 3 * x - 3 * y + after) * f * f * f);
        }
        result[c] = Math.max(0, Math.min(1, v));
    }
    return result;
}
function mapRange(p) {
    let t = (p.value - p.fromMin) / (p.fromMax - p.fromMin || 1e-12);
    if (p.clamp || p.interpolation >= 2) t = Math.max(0, Math.min(1, t));
    if (p.interpolation === 1) { const steps = Math.max(1, Math.floor(p.steps)); t = Math.floor(t * (steps + 1)) / steps; if (p.clamp) t = Math.min(1, t); }
    if (p.interpolation === 2) t = t * t * (3 - 2 * t);
    if (p.interpolation === 3) t = t * t * t * (t * (t * 6 - 15) + 10);
    return p.toMin + t * (p.toMax - p.toMin);
}
module.exports.sanitizeStops = sanitizeStops;
module.exports.rampSample = rampSample;
module.exports.mapRange = mapRange;
