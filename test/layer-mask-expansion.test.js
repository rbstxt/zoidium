"use strict";
// Signed-distance mask expansion (P1.8): zero compatibility with the old
// scanline fill, signed offsets, the half-coverage boundary, clipping,
// degenerate paths, resolution scaling, and visible range rejection.
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  MIN_EXPANSION, MAX_EXPANSION, DEFAULT_EXPANSION,
  isSupportedExpansion, normalizeExpansion, scaleExpansion,
  signedDistance, flattenForExpansion, expandCoverage, expansionSignature,
} = require("../plugins/shape-plus/mask-expansion.js");
const { fillPolygon } = require("../plugins/shape-plus/mask-raster.js");

const vertex = (x, y) => ({ point: [x, y], in: [0, 0], out: [0, 0] });
const rect = (x0, y0, x1, y1) => [vertex(x0, y0), vertex(x1, y0), vertex(x1, y1), vertex(x0, y1)];
// Concave arrow: a notch cut out of the right edge.
const concave = () => [
  vertex(4, 4), vertex(20, 4), vertex(20, 10), vertex(14, 10),
  vertex(14, 14), vertex(20, 14), vertex(20, 20), vertex(4, 20),
];
const entry = (vertices, overrides = {}) => ({ vertices, closed: true, expansion: 0, ...overrides });
const at = (coverage, width, x, y) => coverage[y * width + x];

test("zero expansion matches the old fill pixel-for-pixel", () => {
  for (const vertices of [rect(4, 4, 12, 12), concave(), rect(1, 1.8, 4, 3.2)]) {
    const width = 24, height = 24;
    const expected = new Float32Array(width * height);
    const { flattenPath } = require("../plugins/shape-plus/path.js");
    const { closeContour } = require("../plugins/shape-plus/mask-raster.js");
    const flat = flattenPath({ vertices: closeContour(vertices, true), closed: true });
    fillPolygon(flat.points, width, height, expected);
    const actual = expandCoverage(entry(vertices), width, height, 1);
    assert.deepEqual(Array.from(actual), Array.from(expected));
  }
});

test("missing expansion defaults to zero and stays exact", () => {
  const width = 16, height = 16;
  const expected = expandCoverage(entry(rect(4, 4, 12, 12), { expansion: 0 }), width, height, 1);
  for (const missing of [undefined, null]) {
    const actual = expandCoverage({ vertices: rect(4, 4, 12, 12), closed: true, expansion: missing }, width, height, 1);
    assert.deepEqual(Array.from(actual), Array.from(expected));
  }
  assert.equal(normalizeExpansion(undefined), 0);
  assert.equal(normalizeExpansion(null), 0);
  assert.equal(DEFAULT_EXPANSION, 0);
});

test("positive expansion grows coverage, negative shrinks it", () => {
  const width = 32, height = 32;
  const base = expandCoverage(entry(rect(10, 10, 20, 20)), width, height, 1);
  const grown = expandCoverage(entry(rect(10, 10, 20, 20), { expansion: 3 }), width, height, 1);
  const shrunk = expandCoverage(entry(rect(10, 10, 20, 20), { expansion: -3 }), width, height, 1);
  // Just outside the old edge: grown covers, base does not.
  assert.equal(at(base, width, 22, 15), 0);
  assert.equal(at(grown, width, 22, 15), 1);
  // Just inside the old edge: shrunk drops, base covers.
  assert.equal(at(base, width, 11, 15), 1);
  assert.equal(at(shrunk, width, 11, 15), 0);
  // Deep center survives contraction; far field stays empty either way.
  assert.equal(at(shrunk, width, 15, 15), 1);
  assert.equal(at(grown, width, 0, 0), 0);
  assert.equal(at(shrunk, width, 0, 0), 0);
});

test("expansion is monotonic and contains the zero result", () => {
  const width = 28, height = 28;
  const zero = expandCoverage(entry(concave()), width, height, 1);
  const grown = expandCoverage(entry(concave(), { expansion: 4 }), width, height, 1);
  const shrunk = expandCoverage(entry(concave(), { expansion: -4 }), width, height, 1);
  for (let i = 0; i < zero.length; i++) {
    assert.ok(grown[i] >= zero[i], `grow contains base at ${i}`);
    assert.ok(zero[i] >= shrunk[i], `base contains shrink at ${i}`);
  }
});

test("the offset boundary reads half coverage", () => {
  const width = 32, height = 32;
  // Right edge at x = 20, offset +1.5 moves the boundary to x = 21.5, the
  // center of pixel x = 21.
  const grown = expandCoverage(entry(rect(10, 10, 20, 20), { expansion: 1.5 }), width, height, 1);
  assert.equal(at(grown, width, 21, 15), 0.5);
  assert.equal(at(grown, width, 20, 15), 1);
  // Symmetric contraction: left edge at x = 10, offset -1.5 moves the
  // boundary to x = 11.5, the center of pixel x = 11.
  const shrunk = expandCoverage(entry(rect(10, 10, 20, 20), { expansion: -1.5 }), width, height, 1);
  assert.equal(at(shrunk, width, 11, 15), 0.5);
  assert.equal(at(shrunk, width, 12, 15), 1);
});

test("concave notches respond to the sign", () => {
  const width = 28, height = 28;
  // Pixel (17, 12) sits in the notch: outside the path but surrounded.
  const base = expandCoverage(entry(concave()), width, height, 1);
  assert.equal(at(base, width, 17, 12), 0);
  const grown = expandCoverage(entry(concave(), { expansion: 4 }), width, height, 1);
  assert.equal(at(grown, width, 17, 12), 1);
  // Contracting removes the thin bar left of the notch faster than the bulk.
  const shrunk = expandCoverage(entry(concave(), { expansion: -2 }), width, height, 1);
  assert.ok(at(shrunk, width, 8, 12) >= at(shrunk, width, 17, 12));
});

test("paths clipped by the target edges expand without errors", () => {
  const width = 16, height = 16;
  const vertices = rect(-10, -10, 8, 8);
  const grown = expandCoverage(entry(vertices, { expansion: 3 }), width, height, 1);
  assert.equal(grown.length, width * height);
  assert.ok(grown.every(v => v >= 0 && v <= 1));
  assert.equal(at(grown, width, 0, 0), 1);
  assert.equal(at(grown, width, 15, 15), 0);
  const shrunk = expandCoverage(entry(vertices, { expansion: -3 }), width, height, 1);
  assert.equal(at(shrunk, width, 0, 0), 1);
  assert.equal(at(shrunk, width, 7, 7), 0);
});

test("degenerate paths stay empty at any expansion", () => {
  const width = 16, height = 16;
  const dot = expandCoverage(entry([vertex(8, 8)], { expansion: 5 }), width, height, 1);
  assert.ok(dot.every(v => v === 0));
  const line = expandCoverage(
    { vertices: [vertex(2, 8), vertex(13, 8)], closed: false, expansion: 5 }, width, height, 1);
  assert.ok(line.every(v => v === 0));
  assert.equal(flattenForExpansion([vertex(8, 8)], true), null);
  assert.ok(flattenForExpansion(rect(4, 4, 12, 12), true).length >= 3);
});

test("signedDistance is positive inside and negative outside", () => {
  const points = [[4, 4], [12, 4], [12, 12], [4, 12]];
  assert.ok(signedDistance(8.5, 8.5, points, true) > 0);
  assert.ok(signedDistance(0.5, 0.5, points, true) < 0);
  assert.ok(Math.abs(signedDistance(4, 8.5, points, true)) < 1e-9);
  const notch = flattenForExpansion(concave(), true);
  // Inside the notch opening: outside the polygon, close to an edge.
  const inNotch = signedDistance(17.5, 12.5, notch, true);
  assert.ok(inNotch < 0 && inNotch > -4);
});

test("expansion scales with coverage resolution", () => {
  assert.equal(scaleExpansion(4, 0.5), 2);
  assert.equal(scaleExpansion(-8, 0.25), -2);
  assert.throws(() => scaleExpansion(4, 0), /positive scale/);
  assert.throws(() => scaleExpansion(Number.NaN, 1), /finite/);
  // Same layer-space shape and expansion at half resolution and half size
  // produce the same pattern scaled down.
  const full = expandCoverage(entry(rect(10, 10, 20, 20), { expansion: 2 }), 32, 32, 1);
  const half = expandCoverage(
    entry(rect(5, 5, 10, 10).map(v => v), { expansion: 2 }), 16, 16, 0.5);
  assert.equal(at(full, 32, 21, 15), 1);
  assert.equal(at(half, 16, 10, 7), 1);
  assert.equal(at(full, 32, 0, 0), at(half, 16, 0, 0));
});

test("unsupported values are rejected visibly, never clamped", () => {
  assert.ok(isSupportedExpansion(0));
  assert.ok(isSupportedExpansion(MAX_EXPANSION));
  assert.ok(isSupportedExpansion(MIN_EXPANSION));
  assert.ok(!isSupportedExpansion(MAX_EXPANSION + 1));
  assert.ok(!isSupportedExpansion(MIN_EXPANSION - 1));
  assert.ok(!isSupportedExpansion(Number.NaN));
  assert.ok(!isSupportedExpansion("4"));
  assert.throws(() => normalizeExpansion(MAX_EXPANSION + 1), /outside the supported range/);
  assert.throws(() => normalizeExpansion(MIN_EXPANSION - 1), /outside the supported range/);
  assert.throws(() => normalizeExpansion(Number.NaN), /finite/);
  assert.throws(() => normalizeExpansion("4"), /finite/);
  assert.throws(
    () => expandCoverage(entry(rect(4, 4, 12, 12), { expansion: 500 }), 16, 16, 1),
    /outside the supported range/);
  assert.throws(() => expandCoverage(entry(rect(4, 4, 12, 12)), 0, 16, 1), /positive integer size/);
});

test("cache signatures separate expansion values and scales", () => {
  const a = expansionSignature(entry(rect(4, 4, 12, 12), { expansion: 2 }), 1);
  const b = expansionSignature(entry(rect(4, 4, 12, 12), { expansion: 3 }), 1);
  const c = expansionSignature(entry(rect(4, 4, 12, 12), { expansion: 2 }), 0.5);
  const d = expansionSignature(entry(rect(4, 4, 12, 12)), 1);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^expansion:/);
  assert.throws(() => expansionSignature(entry(rect(4, 4, 12, 12), { expansion: 500 }), 1),
    /outside the supported range/);
});
