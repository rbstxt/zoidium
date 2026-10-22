"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const { bakeGradient, bakeCurve, parseCurve, parseText, parsePalette } = require("../plugins/shader-plus/bake.js");
const { halfBits } = require("../plugins/shader-plus/runtime.js");
const { bindCurveRanges } = require("../plugins/shader-plus/glsl-library.js");
const curves = require("../plugins/material-plus/graph-curves.js");
const { signedDistance, layout } = require("../plugins/shader-plus/text-raster.js");
test("texture kinds use static TEXT JSON rather than unsupported dynamic native types", () => {
  for (const kind of ["gradient", "curve", "palette", "text"]) { const d = KINDS[kind].create(); assert.equal(d.type, 7); assert.ok(!d.dynamic); assert.doesNotThrow(() => JSON.parse(d.value)); }
});
test("gradient interpolation preserves endpoints, alpha, spaces and cyclic seam", () => {
  const stops = [{ position: 0, color: [0, 0, 0, .25] }, { position: 1, color: [1, 1, 1, .75] }];
  const bake = options => bakeGradient(JSON.stringify({ stops, ...options }));
  const linear = bake({}); assert.equal(linear.length, 256 * 4); assert.deepEqual([...linear.slice(0, 4)], [0, 0, 0, 64]); assert.deepEqual([...linear.slice(-4)], [255, 255, 255, 191]);
  assert.equal(bake({ interpolation: "constant" })[128 * 4], 0);
  assert.ok(bake({ space: "linear" })[128 * 4] > linear[128 * 4]);
  assert.notDeepEqual(bake({ interpolation: "cardinal" }), linear);
  assert.notDeepEqual(bake({ space: "oklab" }), linear);
  const cyclic = bakeGradient(JSON.stringify({ stops: [{ position: .2, color: [1, 0, 0, 1] }, { position: .8, color: [0, 0, 1, 1] }], cyclic: true }));
  assert.deepEqual([...cyclic.slice(0, 4)], [...cyclic.slice(-4)]);
});
test("curve bake has 1024 texels, RGBA channels, and range independent of precision", () => {
  const value = JSON.stringify({ channels: "rgba", range: [-10, 100], composite: [[0, 0], [1, 1]], red: [[0, 1], [1, 0]], alpha: [[0, .2], [1, .2]] });
  const data = bakeCurve(value, curves), floating = bakeCurve(value, curves, true);
  assert.equal(data.length, 4096); assert.equal(floating.length, 4096); assert.deepEqual(parseCurve(value, curves).range, [-10, 100]);
  assert.equal(data[0], 255); assert.equal(data[3], 51); assert.equal(data[data.length - 4], 0);
  assert.ok(Math.abs(floating[3] - .2) < 1e-6);
  assert.equal(halfBits(0), 0); assert.equal(halfBits(1), 0x3c00); assert.equal(halfBits(.5), 0x3800);
});
test("curve range expansion handles nested commas and ignores comments", () => {
  const source = "precision highp float;\n// zCurve(Response,x)\nfloat f(){return zCurve(Response, max(x, y)) + zCurve(Response,z,vec2(0.,1.));}";
  const output = bindCurveRanges(source, new Set(["Response"]));
  assert.match(output, /uniform vec2 Response_range;/); assert.match(output, /max\(x, y\), Response_range/); assert.match(output, /\/\/ zCurve\(Response,x\)/); assert.match(output, /zCurve\(Response,z,vec2\(0.,1.\)\)/);
});
test("palette bounds and text settings reject invalid payloads deterministically", () => {
  assert.equal(parsePalette(JSON.stringify({ colors: Array(30).fill([2, -1, .5, 1]) })).colors.length, 16);
  assert.deepEqual(parsePalette('{"colors":[[2,-1,0.5]]}').colors[0], [1, 0, .5, 1]);
  assert.equal(parseText('{"lineHeight":99,"letterSpacing":-99}').lineHeight, 4); assert.equal(parseText('{"letterSpacing":-99}').letterSpacing, -.5);
});
test("signed distance is deterministic and text layouts stay within bounds", () => {
  const coverage = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0]);
  const data = signedDistance(coverage, 3, 3, 2); assert.ok(data[4] > 128); assert.ok(data[0] < 128); assert.deepEqual(data, signedDistance(coverage, 3, 3, 2));
  const font = { unitsPerEm: 1000, ascender: 800, descender: -200, stringToGlyphs: s => [...s].map(() => ({ advanceWidth: 600 })), getKerningValue: () => 0 };
  const options = parseText(JSON.stringify({ text: "AB\nCD", size: 128, mode: "atlas" })); const plan = layout(font, options); assert.equal(plan.count, 4); assert.deepEqual(plan.grid, [2, 2]); assert.ok(plan.width <= 2048);
});
