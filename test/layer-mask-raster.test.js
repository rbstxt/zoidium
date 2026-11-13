"use strict";
// Pure-JS coverage raster: exact fills, AE-style combine order, feather
// falloff, invert, opacity and open-path closure, all without a canvas.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { rasterizeCoverage, fillPolygon, boxBlur, closeContour } = require("../plugins/shape-plus/mask-raster.js");

const vertex = (x, y) => ({ point: [x, y], in: [0, 0], out: [0, 0] });
const rect = (x0, y0, x1, y1) => [vertex(x0, y0), vertex(x1, y0), vertex(x1, y1), vertex(x0, y1)];
const mask = (vertices, overrides = {}) => ({
  vertices, closed: true, mode: "add", feather: 0, opacity: 1, invert: 0, enabled: true, ...overrides,
});

test("a rectangle fills exactly inside and stays empty outside", () => {
  const { data, width, height } = rasterizeCoverage([mask(rect(4, 4, 12, 12))], 16, 16);
  assert.equal(width, 16);
  assert.equal(height, 16);
  const at = (x, y) => data[y * 16 + x];
  assert.equal(at(0, 0), 0);
  assert.equal(at(3, 8), 0);
  assert.equal(at(12, 8), 0);
  assert.equal(at(8, 3), 0);
  assert.equal(at(8, 12), 0);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) assert.equal(at(x, y), 255, `pixel ${x},${y}`);
});

test("subtract, intersect and invert combine in order", () => {
  const big = mask(rect(0, 0, 16, 16));
  const hole = mask(rect(4, 4, 12, 12), { mode: "subtract" });
  const { data } = rasterizeCoverage([big, hole], 16, 16);
  assert.equal(data[8 * 16 + 8], 0);
  assert.equal(data[8 * 16 + 0], 255);
  const intersected = rasterizeCoverage([big, mask(rect(4, 4, 12, 12), { mode: "intersect" })], 16, 16);
  assert.equal(intersected.data[8 * 16 + 8], 255);
  assert.equal(intersected.data[8 * 16 + 0], 0);
  const inverted = rasterizeCoverage([mask(rect(4, 4, 12, 12), { invert: 1 })], 16, 16);
  assert.equal(inverted.data[8 * 16 + 8], 0);
  assert.equal(inverted.data[0], 255);
  // A first subtract on empty stays empty; adds union without exceeding 1.
  const { data: sub } = rasterizeCoverage([hole], 16, 16);
  assert.ok(sub.every(v => v === 0));
  const { data: union } = rasterizeCoverage([big, big], 16, 16);
  assert.ok(union.every(v => v === 255));
});

test("opacity scales the mask", () => {
  const { data } = rasterizeCoverage([mask(rect(0, 0, 16, 16), { opacity: 0.5 })], 16, 16);
  assert.ok(data.every(v => v === 127 || v === 128), `expected ~128, got ${data[0]}`);
});

test("feather falls off from the edge and preserves the center", () => {
  const sharp = rasterizeCoverage([mask(rect(0, 0, 32, 32))], 32, 32).data;
  assert.equal(sharp[16 * 32 + 16], 255);
  const soft = rasterizeCoverage([mask(rect(4, 4, 60, 60), { feather: 4 })], 64, 64).data;
  assert.equal(soft[32 * 64 + 32], 255);
  // Falloff is monotonic from the center out past the edge at x=60.
  const samples = Array.from({ length: 16 }, (_, k) => soft[32 * 64 + 32 + 2 * k]);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] <= samples[i - 1], `falloff ${samples}`);
  assert.ok(samples[samples.length - 1] < 150, `tail cold, got ${samples[samples.length - 1]}`);
  // Feather never pushes values outside 0..255 and stays deterministic.
  const again = rasterizeCoverage([mask(rect(4, 4, 60, 60), { feather: 4 })], 64, 64).data;
  assert.deepEqual(Array.from(soft), Array.from(again));
});

test("open paths close for coverage and degenerate paths vanish", () => {
  const open = mask([vertex(4, 4), vertex(12, 4), vertex(12, 12), vertex(4, 12)], { closed: false });
  const { data } = rasterizeCoverage([open], 16, 16);
  assert.equal(data[8 * 16 + 8], 255);
  const line = mask([vertex(0, 8), vertex(15, 8)], { closed: false });
  assert.ok(rasterizeCoverage([line], 16, 16).data.every(v => v === 0));
  const dot = mask([vertex(8, 8)], { closed: true });
  assert.ok(rasterizeCoverage([dot], 16, 16).data.every(v => v === 0));
  assert.ok(rasterizeCoverage([{ ...mask([]), vertices: [] }], 16, 16).data.every(v => v === 0));
});

test("disabled masks do not consume the first-mask slot", () => {
  const hole = mask(rect(4, 4, 12, 12), { mode: "subtract", enabled: false });
  const { data } = rasterizeCoverage([hole, mask(rect(0, 0, 16, 16))], 16, 16);
  assert.ok(data.every(v => v === 255));
});

test("closeContour only joins genuinely open paths", () => {
  const vertices = [vertex(0, 0), vertex(1, 1)];
  assert.equal(closeContour(vertices, true).length, 2);
  assert.equal(closeContour(vertices, false).length, 3);
  const loop = [...vertices, { point: [0, 0], in: [0, 0], out: [0, 0] }];
  assert.equal(closeContour(loop, false).length, 3);
});

test("fillPolygon handles a triangle and fill budgets", () => {
  const alpha = new Float32Array(8 * 8);
  fillPolygon([[0, 0], [8, 0], [0, 8]], 8, 8, alpha);
  assert.ok(alpha[0] > 0 && alpha[7 * 8 + 7] === 0);
  const blurred = boxBlur(new Float32Array(8 * 8).fill(1), 8, 8, 3, false);
  assert.ok(blurred.every(v => v === 1));
  assert.throws(() => rasterizeCoverage([mask(rect(0, 0, 4, 4))], 0, 4), /positive/);
});
