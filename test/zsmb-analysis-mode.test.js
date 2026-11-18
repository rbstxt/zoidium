"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  analysisPlan,
  qualityLevel,
  QUALITY_DIVISORS,
} = require("../plugins/smart-motion-blur-lite/analysis-mode.js");

const PROJECT = { projectWidth: 1920, projectHeight: 1080 };
const PREVIEWS = [
  { name: "Full", width: 1920, height: 1080 },
  { name: "1/2", width: 960, height: 540 },
  { name: "1/4", width: 480, height: 270 },
  { name: "1/8", width: 240, height: 135 },
];

function plan(quality, frame, extra = {}) {
  return analysisPlan({ quality, width: frame.width, height: frame.height, ...PROJECT, ...extra });
}

test("Quality 0 through 3 select Full, 1/2, 1/4, and 1/8 with the author's divisors", () => {
  assert.deepEqual(QUALITY_DIVISORS, [1, 8, 16, 32]);
  for (const [value, level] of [[0, 0], [1, 1], [2, 2], [3, 3], [9, 3], [-2, 0]]) {
    assert.equal(qualityLevel(value), level);
  }
  assert.equal(qualityLevel(undefined), 1, "a missing value uses the author's 1/2 default");
  assert.equal(qualityLevel("2"), 2);
});

test("at the project size each level divides the project resolution", () => {
  const full = plan(0, PREVIEWS[0]);
  assert.deepEqual(full, { level: 0, divisor: 1, exact: true, width: 1920, height: 1080 });
  assert.deepEqual(plan(1, PREVIEWS[0]), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
  assert.deepEqual(plan(2, PREVIEWS[0]), { level: 2, divisor: 16, exact: false, width: 120, height: 67 });
  assert.deepEqual(plan(3, PREVIEWS[0]), { level: 3, divisor: 32, exact: false, width: 60, height: 33 });
});

test("a reduced preview caps the analysis input at the rendered frame", () => {
  // Full keeps the Full estimator but can only analyse the preview buffer.
  assert.deepEqual(plan(0, PREVIEWS[3]), { level: 0, divisor: 1, exact: true, width: 240, height: 135 });
  assert.deepEqual(plan(0, PREVIEWS[1]), { level: 0, divisor: 1, exact: true, width: 960, height: 540 });
  // The reduced levels divide the smaller input, so the level still applies.
  assert.deepEqual(plan(1, PREVIEWS[3]), { level: 1, divisor: 8, exact: false, width: 30, height: 16 });
  assert.deepEqual(plan(1, PREVIEWS[2]), { level: 1, divisor: 8, exact: false, width: 60, height: 33 });
  assert.deepEqual(plan(2, PREVIEWS[3]), { level: 2, divisor: 16, exact: false, width: 15, height: 8 });
  assert.deepEqual(plan(3, PREVIEWS[3]), { level: 3, divisor: 32, exact: false, width: 7, height: 6 });
});

test("an export frame follows the same rule at every output size", () => {
  const exportAt = (width, height) => ({ width, height });
  assert.deepEqual(plan(0, exportAt(1920, 1080)), { level: 0, divisor: 1, exact: true, width: 1920, height: 1080 });
  assert.deepEqual(plan(1, exportAt(1920, 1080)), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
  assert.deepEqual(plan(1, exportAt(1280, 720)), { level: 1, divisor: 8, exact: false, width: 160, height: 90 });
  assert.deepEqual(plan(1, exportAt(640, 360)), { level: 1, divisor: 8, exact: false, width: 80, height: 45 });
  assert.deepEqual(plan(2, exportAt(1280, 720)), { level: 2, divisor: 16, exact: false, width: 80, height: 45 });
  assert.deepEqual(plan(3, exportAt(1280, 720)), { level: 3, divisor: 32, exact: false, width: 40, height: 22 });
  // An export larger than the project keeps the project analysis.
  assert.deepEqual(plan(1, exportAt(3840, 2160)), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
});

test("the analysis keeps the existing minimum size clamp", () => {
  const tiny = plan(3, { width: 240, height: 135 });
  assert.equal(tiny.width, 7);
  assert.equal(tiny.height, 6);
  const smaller = plan(3, { width: 100, height: 60 });
  assert.equal(smaller.width, 6);
  assert.equal(smaller.height, 6);
});

test("one-pixel rounding does not change the level", () => {
  const rounded = plan(1, { width: 1919, height: 1079 });
  assert.equal(rounded.level, 1);
  assert.equal(rounded.exact, false);
  assert.deepEqual(plan(0, { width: 1259, height: 708 }, { projectWidth: 1280, projectHeight: 720 }),
    { level: 0, divisor: 1, exact: true, width: 1259, height: 708 });
});

test("missing sizes are reported instead of guessed", () => {
  assert.equal(analysisPlan({ quality: 1, width: 0, height: 0, ...PROJECT }), null);
  assert.equal(analysisPlan({ quality: 1 }), null);
  assert.equal(analysisPlan(), null);
  // Without a project size the rendered frame is the reference.
  assert.deepEqual(analysisPlan({ quality: 1, width: 800, height: 450 }),
    { level: 1, divisor: 8, exact: false, width: 100, height: 56 });
});
