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

function preview(quality, frame, extra = {}) {
  return analysisPlan({ quality, width: frame.width, height: frame.height, ...PROJECT, ...extra });
}

function exportFrame(quality, width, height) {
  return analysisPlan({
    quality, width, height, exporting: true,
    projectWidth: PROJECT.projectWidth, projectHeight: PROJECT.projectHeight,
  });
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
  const full = preview(0, PREVIEWS[0]);
  assert.deepEqual(full, { level: 0, divisor: 1, exact: true, width: 1920, height: 1080 });
  assert.deepEqual(preview(1, PREVIEWS[0]), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
  assert.deepEqual(preview(2, PREVIEWS[0]), { level: 2, divisor: 16, exact: false, width: 120, height: 67 });
  assert.deepEqual(preview(3, PREVIEWS[0]), { level: 3, divisor: 32, exact: false, width: 60, height: 33 });
});

test("a preview buffer caps the analysis size without changing the level", () => {
  // Full can only analyse the pixels that a reduced preview holds.
  assert.deepEqual(preview(0, PREVIEWS[1]), { level: 0, divisor: 1, exact: true, width: 960, height: 540 });
  assert.deepEqual(preview(0, PREVIEWS[3]), { level: 0, divisor: 1, exact: true, width: 240, height: 135 });
  // The reduced levels keep their project size while the buffer is larger.
  for (const frame of PREVIEWS) {
    assert.deepEqual(preview(1, frame), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
    assert.deepEqual(preview(2, frame), { level: 2, divisor: 16, exact: false, width: 120, height: 67 });
    assert.deepEqual(preview(3, frame), { level: 3, divisor: 32, exact: false, width: 60, height: 33 });
  }
});

test("every preview level keeps the project-relative analysis size", () => {
  for (const frame of PREVIEWS) {
    const full = preview(0, frame);
    const half = preview(1, frame);
    const quarter = preview(2, frame);
    const eighth = preview(3, frame);
    // Full is the frame itself, so it can only be larger than the levels.
    assert.ok(full.width >= half.width);
    assert.ok(half.width > quarter.width);
    assert.ok(quarter.width > eighth.width);
  }
});

test("an export applies the level to its output frame up to the project", () => {
  assert.deepEqual(exportFrame(0, 1920, 1080), { level: 0, divisor: 1, exact: true, width: 1920, height: 1080 });
  assert.deepEqual(exportFrame(1, 1920, 1080), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
  assert.deepEqual(exportFrame(1, 1280, 720), { level: 1, divisor: 8, exact: false, width: 160, height: 90 });
  assert.deepEqual(exportFrame(1, 640, 360), { level: 1, divisor: 8, exact: false, width: 80, height: 45 });
  assert.deepEqual(exportFrame(2, 1280, 720), { level: 2, divisor: 16, exact: false, width: 80, height: 45 });
  assert.deepEqual(exportFrame(3, 1280, 720), { level: 3, divisor: 32, exact: false, width: 40, height: 22 });
  // An export larger than the project keeps the project analysis.
  assert.deepEqual(exportFrame(1, 3840, 2160), { level: 1, divisor: 8, exact: false, width: 240, height: 135 });
  assert.deepEqual(exportFrame(0, 3840, 2160), { level: 0, divisor: 1, exact: true, width: 1920, height: 1080 });
});

test("the analysis keeps the existing minimum size clamp", () => {
  const small = analysisPlan({
    quality: 3, width: 100, height: 60,
    projectWidth: 100, projectHeight: 60,
  });
  assert.deepEqual(small, { level: 3, divisor: 32, exact: false, width: 6, height: 6 });
  const tiny = analysisPlan({
    quality: 3, width: 40, height: 30, exporting: true,
    projectWidth: 100, projectHeight: 60,
  });
  assert.deepEqual(tiny, { level: 3, divisor: 32, exact: false, width: 6, height: 6 });
});

test("one-pixel rounding does not change the level", () => {
  const rounded = preview(1, { width: 1919, height: 1079 });
  assert.equal(rounded.level, 1);
  assert.equal(rounded.exact, false);
  assert.deepEqual(preview(0, { width: 1259, height: 708 }, { projectWidth: 1280, projectHeight: 720 }),
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
