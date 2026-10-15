"use strict";

// Characterization of the Easing+ pure curve math: pinned numeric behavior for
// the file split. Every expectation below was verified against the original
// plugins/easing-plus/easing-plus.js before the split.

const assert = require("node:assert/strict");
const test = require("node:test");

globalThis.window = globalThis.window || {};

const EasingPlus = require("../plugins/easing-plus/easing-plus");
const {
  PRESETS,
  cubic,
  cubicValue,
  clonePoints,
  point,
  shouldPreserveCrossingX,
  hasNativeBezierDefaults,
  curveFromSegment,
  planCurve,
  rescaleSegmentHandles,
  overshootForPoints,
  graphBounds,
  miniGeometry,
} = EasingPlus.__test;

function makeProperty(values) {
  return { keyframes: values.map((value) => ({ value })), definition: {} };
}

function makeKeyframe(frame, value, incoming, outgoing) {
  return {
    frame,
    value,
    controlPoints: [(incoming || [0, 0]).slice(), (outgoing || [0, 0]).slice()],
  };
}

test("the preset catalogue keeps its twelve entries in order", () => {
  assert.deepEqual(
    PRESETS.map((preset) => preset.name),
    [
      "Linear",
      "Ease",
      "Ease in",
      "Ease out",
      "Ease in-out",
      "Soft",
      "Swift in",
      "Swift out",
      "Sharp",
      "Expo in",
      "Expo out",
      "Sine",
    ]
  );
  for (const preset of PRESETS) {
    assert.equal(preset.points.length, 2);
  }
});

test("cubicValue evaluates the cubic Bezier basis", () => {
  assert.equal(cubicValue(0, 1, 2, 3, 0), 0);
  assert.equal(cubicValue(0, 1, 2, 3, 1), 3);
  assert.equal(cubicValue(0, 1, 2, 3, 0.5), 1.5);
});

test("point and clonePoints build independent curve points", () => {
  const entry = point(0, 0, [0, 0], [0.25, 0.1]);
  assert.deepEqual(entry, { x: 0, y: 0, inX: 0, inY: 0, outX: 0.25, outY: 0.1 });
  const cloned = clonePoints([entry]);
  assert.deepEqual(cloned, [entry]);
  assert.notEqual(cloned[0], entry);
});

test("shouldPreserveCrossingX detects normalized handle crossings", () => {
  const crossed = shouldPreserveCrossingX(
    makeKeyframe(0, 0, [0, 0], [29, 0]),
    makeKeyframe(30, 10, [-2, 0], [0, 0])
  );
  assert.equal(crossed, true);
  const ordered = shouldPreserveCrossingX(
    makeKeyframe(0, 0, [0, 0], [10, 0]),
    makeKeyframe(30, 10, [-10, 0], [0, 0])
  );
  assert.equal(ordered, false);
  assert.equal(
    shouldPreserveCrossingX(makeKeyframe(5, 0, [0, 0], [1, 0]), makeKeyframe(5, 1, [-1, 0], [0, 0])),
    false
  );
});

test("hasNativeBezierDefaults recognizes fresh native handles", () => {
  assert.equal(
    hasNativeBezierDefaults(
      makeKeyframe(0, 0, [0, 0], [10, 0]),
      makeKeyframe(30, 0, [-10, 0], [0, 0])
    ),
    true
  );
  assert.equal(
    hasNativeBezierDefaults(
      makeKeyframe(0, 0, [0, 0], [7.5, 1]),
      makeKeyframe(30, 0, [-7.5, 9], [0, 0])
    ),
    false
  );
});

test("curveFromSegment presents fresh native handles as Linear", () => {
  const property = makeProperty([0, 10]);
  const start = makeKeyframe(0, 0, [0, 0], [10, 0]);
  const end = makeKeyframe(30, 10, [-10, 0], [0, 0]);
  assert.deepEqual(curveFromSegment(property, start, end), PRESETS[0].points);
});

test("curveFromSegment normalizes edited handles without a host", () => {
  const property = makeProperty([0, 10]);
  const start = makeKeyframe(0, 0, [0, 0], [7.5, 1]);
  const end = makeKeyframe(30, 10, [-7.5, 9], [0, 0]);
  assert.deepEqual(curveFromSegment(property, start, end), cubic(0.25, 0.1, 0.75, 1.9));
});

test("curveFromSegment rejects zero-length segments", () => {
  const property = makeProperty([0, 10]);
  const start = makeKeyframe(5, 0, [0, 0], [10, 0]);
  const end = makeKeyframe(5, 10, [-10, 0], [0, 0]);
  assert.deepEqual(curveFromSegment(property, start, end), cubic(0.333, 0.333, 0.667, 0.667));
});

test("planCurve refuses zero-length segments", () => {
  const property = makeProperty([0, 10]);
  const start = makeKeyframe(5, 0, [0, 0], [10, 0]);
  const end = makeKeyframe(5, 10, [-10, 0], [0, 0]);
  assert.equal(planCurve(property, start, end, cubic(0.25, 0.1, 0.25, 1)), null);
});

test("rescaleSegmentHandles rejects non-finite handles", () => {
  assert.equal(
    rescaleSegmentHandles(
      { duration: 30, delta: 10 },
      { duration: 30, delta: 10 },
      { outX: Number.NaN, outY: 1, inX: -10, inY: 1 }
    ),
    null
  );
});

test("overshoot detection and graph bounds for flat curves", () => {
  const flat = cubic(0.333, 0.333, 0.667, 0.667);
  assert.deepEqual(overshootForPoints(flat), { bottom: false, top: false });
  assert.deepEqual(graphBounds(flat), { min: -0.12, max: 1.12 });
});

test("overshoot detection and graph bounds for overdriven curves", () => {
  const over = [point(0, 0, [0, 0], [0.3, 1.6]), point(1, 1, [-0.3, 0.4])];
  assert.deepEqual(overshootForPoints(over), { bottom: false, top: true });
  const bounds = graphBounds(over);
  assert.ok(bounds.max >= 1.55);
  assert.equal(bounds.min, -0.12);
});

test("miniGeometry maps a Linear curve into the 68x60 preview", () => {
  const preview = miniGeometry(PRESETS[0].points);
  assert.ok(preview.path.startsWith("M 7 "));
  assert.deepEqual(preview.end, [61, preview.end[1]]);
  assert.ok(preview.end[1] < preview.start[1], "larger values draw higher");
  assert.equal(preview.start[0], 7);
});
