"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const s = require("../plugins/shape-plus/text-selectors");
const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, "expected " + expected + " got " + actual);
const range = (shape, start = 0, end = 100, extra = {}) => s.rangeValues({ selectorUnits: "percentage", selectorStart: start, selectorEnd: end, selectorOffset: 0, selectorShape: shape, selectorAmount: 100, ...extra }, 4);
test("every range shape matches hand-computed values", () => {
  assert.deepEqual(range("square"), [1, 1, 1, 1]);
  assert.deepEqual(range("rampUp"), [0.125, 0.375, 0.625, 0.875]);
  assert.deepEqual(range("rampDown"), [0.875, 0.625, 0.375, 0.125]);
  assert.deepEqual(range("triangle"), [0.25, 0.75, 0.75, 0.25]);
  for (const [i, t] of [0.125, 0.375, 0.625, 0.875].entries()) {
    close(range("round")[i], Math.sqrt(1 - Math.pow(t * 2 - 1, 2)));
    close(range("smooth")[i], 0.5 - 0.5 * Math.cos(t * Math.PI * 2));
  }
  assert.deepEqual(range("square", 25, 75), [0, 1, 1, 0]);
  assert.deepEqual(range("rampUp", 25, 75), [0, 0.25, 0.75, 1].map((v, i) => i === 3 ? 1 : v));
  assert.deepEqual(range("square", 0, 50, { selectorOffset: 25 }), [0, 1, 1, 0]);
  assert.deepEqual(range("square", 40, 40), [0, 0, 0, 0]);
  assert.deepEqual(range("rampUp", 40, 40), [0, 0, 0, 0]);
});
test("square measures partial unit coverage", () => {
  const square = range("square", 0, 30);
  assert.equal(square[0], 1); close(square[1], 0.2); assert.equal(square[2], 0); assert.equal(square[3], 0);
  assert.deepEqual(range("square", 10, 20), [0.4, 0, 0, 0]);
  assert.deepEqual(range("square", 75, 25), [0, 1, 1, 0]);
  assert.deepEqual(range("square", -50, 150), [1, 1, 1, 1]);
});
test("every combination mode matches hand-computed values", () => {
  assert.equal(s.combine("add", 0, 0.5), 0.5);
  assert.equal(s.combine("subtract", 0, 0.5), -0.5);
  assert.equal(s.combine("intersect", 0, 0.5), 0);
  assert.equal(s.combine("min", 0, 0.5), 0);
  assert.equal(s.combine("max", 0, 0.5), 0.5);
  assert.equal(s.combine("difference", 0, 0.5), 0.5);
  assert.equal(s.combine("add", 0.3, 0.5), 0.8);
  assert.equal(s.combine("subtract", 0.3, 0.5), -0.2);
  assert.equal(s.combine("intersect", 0.3, 0.5), 0.15);
  assert.equal(s.combine("min", 0.3, 0.5), 0.3);
  assert.equal(s.combine("max", 0.3, 0.5), 0.5);
  assert.equal(s.combine("difference", 0.3, 0.5), 0.2);
  assert.equal(s.combine("add", 0.8, 0.8), 1);
  assert.equal(s.combine("subtract", -0.8, 0.8), -1);
  assert.equal(s.combine("unknown-mode", 0.2, 0.3), 0.5);
});
test("amount scales and flips the selector sign", () => {
  assert.deepEqual(range("square", 0, 100, { selectorAmount: -50 }), [-0.5, -0.5, -0.5, -0.5]);
  assert.deepEqual(range("square", 0, 100, { selectorAmount: 0 }), [0, 0, 0, 0]);
  assert.deepEqual(range("rampUp", 0, 100, { selectorAmount: 50 }), [0.0625, 0.1875, 0.3125, 0.4375]);
});
test("index units count in units with an end-of-text default", () => {
  const index = (start, end, extra = {}) => s.rangeValues({ selectorUnits: "index", selectorStart: start, selectorEnd: end, selectorOffset: 0, selectorShape: "square", selectorAmount: 100, ...extra }, 4);
  assert.deepEqual(index(1, 3), [0, 1, 1, 0]);
  assert.deepEqual(index(0, 100), [1, 1, 1, 1]);
  assert.deepEqual(index(0, 4), [1, 1, 1, 1]);
  assert.deepEqual(index(2, 2), [0, 0, 0, 0]);
  assert.deepEqual(s.rangeValues({ selectorUnits: "index", selectorStart: 1, selectorEnd: 3, selectorOffset: 1, selectorShape: "square", selectorAmount: 100 }, 4), [0, 0, 1, 1]);
});
test("ease curves reshape toward the named end with identity at 0%", () => {
  assert.equal(s.easeLow(0.5, 0), 0.5);
  assert.equal(s.easeHigh(0.5, 0), 0.5);
  assert.equal(s.easeLow(0.5, 100), 0.25);
  assert.equal(s.easeHigh(0.5, 100), 0.75);
  close(s.easeLow(0.5, -100), Math.SQRT1_2);
  close(s.easeHigh(0.5, -100), 1 - Math.SQRT1_2);
  for (const percent of [-100, -37, 42, 100]) {
    assert.equal(s.easeLow(0, percent), 0);
    assert.equal(s.easeLow(1, percent), 1);
    assert.equal(s.easeHigh(0, percent), 0);
    assert.equal(s.easeHigh(1, percent), 1);
  }
  assert.ok(s.easeLow(0.2, 100) - s.easeLow(0.1, 100) < 0.2 - 0.1);
  assert.ok(s.easeHigh(0.9, 100) - s.easeHigh(0.8, 100) < 0.9 - 0.8);
});
test("randomize order is deterministic per seed and shared across reloads", () => {
  assert.deepEqual(s.randomPermutation(16, 1), [4, 11, 15, 14, 9, 8, 1, 2, 13, 10, 6, 7, 3, 5, 12, 0]);
  assert.deepEqual(s.randomPermutation(16, 1), s.randomPermutation(16, 1));
  assert.notDeepEqual(s.randomPermutation(16, 1), s.randomPermutation(16, 2));
  assert.deepEqual(s.randomPermutation(0, 1), []);
  const a = s.rangeValues({ selectorUnits: "percentage", selectorStart: 0, selectorEnd: 50, selectorOffset: 0, selectorShape: "square", selectorAmount: 100, selectorRandomize: 1, selectorRandomSeed: 7 }, 8);
  const b = s.rangeValues({ selectorUnits: "percentage", selectorStart: 0, selectorEnd: 50, selectorOffset: 0, selectorShape: "square", selectorAmount: 100, selectorRandomize: 1, selectorRandomSeed: 7 }, 8);
  assert.deepEqual(a, b);
  assert.equal(a.filter(v => v === 1).length, 4);
  assert.notDeepEqual(a, [1, 1, 1, 1, 0, 0, 0, 0]);
});
test("wiggly noise is bounded, deterministic and correlation-aware", () => {
  const base = { wigglyMax: 100, wigglyMin: -100, wigglesPerSecond: 2, correlation: 50, temporalPhase: 0, spatialPhase: 0, wigglySeed: 0 };
  for (const unit of [0, 1, 2, 3]) for (const time of [0, 1.5, 30]) {
    const value = s.wigglyValue(base, unit, time);
    assert.ok(value >= -1 && value <= 1, "out of range: " + value);
  }
  assert.equal(s.wigglyValue(base, 1, 1.5), s.wigglyValue(base, 1, 1.5));
  assert.notEqual(s.wigglyValue(base, 1, 1.5), s.wigglyValue(base, 1, 2.5));
  const full = { ...base, correlation: 100 };
  assert.deepEqual([0, 1, 2, 3].map(u => s.wigglyValue(full, u, 1.5)), [0.0969, 0.0969, 0.0969, 0.0969].map(v => s.wigglyValue(full, 0, 1.5)));
  const unlocked = [0, 1, 2].map(c => s.wigglyValue({ ...base, component: c }, 2, 1.5));
  assert.ok(new Set(unlocked.map(v => v.toFixed(4))).size > 1, "locked components must differ: " + unlocked);
  const locked = [0, 1, 2].map(() => s.wigglyValue(base, 2, 1.5));
  assert.deepEqual(locked, [locked[0], locked[0], locked[0]]);
  const scaled = s.wigglyValue({ ...base, wigglyMax: 50, wigglyMin: 0 }, 1, 1.5);
  assert.ok(scaled >= 0 && scaled <= 0.5, "out of range: " + scaled);
});
