"use strict";
// GPU coverage helpers: cache keys, coverage-space scaling and blur taps.
// The WebGL render itself is browser-tested (tolerance probe against the
// CPU reference); these pins keep the key and kernel logic exact in Node.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { scaleEvaluated, signatureOf, blurTaps, MAX_GPU_FEATHER, MAX_TAPS, MAX_CACHE_ENTRIES } = require("../plugins/shape-plus/mask-gpu.js");

function entry(extra = {}) {
  return { vertices: [{ point: [10, 20], in: [0, 0], out: [0, 0] }], closed: true, mode: "add", feather: 5, opacity: 1, invert: 0, enabled: true, ...extra };
}

test("scaling maps vertices and feather to coverage pixels", () => {
  const [scaled] = scaleEvaluated([entry()], 0.5);
  assert.deepEqual(scaled.vertices[0].point, [5, 10]);
  assert.deepEqual(scaled.vertices[0].in, [0, 0]);
  assert.equal(scaled.feather, 2.5);
  assert.equal(scaled.mode, "add");
});

test("signatures change with every pixel-affecting input", () => {
  const base = signatureOf(scaleEvaluated([entry()], 1), 100, 80);
  assert.equal(signatureOf(scaleEvaluated([entry()], 1), 100, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry({ feather: 6 })], 1), 100, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry({ mode: "subtract" })], 1), 100, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry({ invert: 1 })], 1), 100, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry({ opacity: 0.5 })], 1), 100, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry({ enabled: false })], 1), 100, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry()], 1), 101, 80), base);
  assert.notEqual(signatureOf(scaleEvaluated([entry()], 0.5), 50, 40), base);
  const moved = entry();
  moved.vertices = [{ point: [11, 20], in: [0, 0], out: [0, 0] }];
  assert.notEqual(signatureOf(scaleEvaluated([moved], 1), 100, 80), base);
  // Names and ids do not affect pixels.
  assert.equal(signatureOf(scaleEvaluated([{ ...entry(), name: "b", id: "x" }], 1), 100, 80),
    signatureOf(scaleEvaluated([{ ...entry(), name: "a", id: "y" }], 1), 100, 80));
});

test("blur taps form an exact clamped box", () => {
  assert.deepEqual(blurTaps(0), { radius: 0, count: 1, offsets: [0], weight: 1 });
  const taps = blurTaps(3);
  assert.deepEqual(taps.offsets, [-3, -2, -1, 0, 1, 2, 3]);
  assert.equal(taps.count, 7);
  assert.ok(Math.abs(taps.weight * taps.count - 1) < 1e-12);
  // Symmetric offsets with a shared weight sum to exactly one box pass.
  assert.equal(taps.offsets.reduce((a, b) => a + b, 0), 0);
  // Beyond the loop bound the caller falls back to the CPU reference.
  assert.equal(blurTaps(10000).radius, MAX_GPU_FEATHER);
  assert.equal(blurTaps(10000).count, MAX_TAPS);
  assert.equal(MAX_TAPS, 2 * MAX_GPU_FEATHER + 1);
  assert.ok(MAX_CACHE_ENTRIES >= 2);
});

