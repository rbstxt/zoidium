"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const EasingPlus = require("../plugins/easing-plus/easing-plus");
const { planCurve, rescaleSegmentHandles } = EasingPlus.__test;
function makeProperty(values) {
  return { keyframes: values.map((value) => ({ value })), definition: {} };
}
function makeKeyframe(frame, value, incoming, outgoing) {
  return { frame, value, controlPoints: [(incoming||[0,0]).slice(), (outgoing||[0,0]).slice()] };
}
test("planCurve stores flat Y handles for equal values", () => {
  const property = makeProperty([5, 5]);
  const start = makeKeyframe(0, 5, [0, 0], [10, 0]);
  const end = makeKeyframe(30, 5, [-10, 0], [0, 0]);
  const points = EasingPlus.__test.cubic(0.25, 0.1, 0.25, 1);
  const plan = planCurve(property, start, end, points);
  assert.equal(plan.equalValues, true);
  assert.deepEqual(plan.points[0].outgoing, [0.25 * 30, 0]);
  assert.deepEqual(plan.points[1].incoming, [-0.75 * 30, 0]);
});
test("planCurve keeps value-relative Y handles for differing values", () => {
  const property = makeProperty([0, 10]);
  const start = makeKeyframe(0, 0, [0, 0], [10, 0]);
  const end = makeKeyframe(30, 10, [-10, 0], [0, 0]);
  const points = EasingPlus.__test.cubic(0.25, 0.1, 0.25, 1);
  const plan = planCurve(property, start, end, points);
  assert.equal(plan.equalValues, false);
  assert.deepEqual(plan.points[0].outgoing, [0.25 * 30, 1]);
  assert.deepEqual(plan.points[1].incoming, [-0.75 * 30, 0]);
});
test("rescale preserves shape when duration doubles", () => {
  const next = rescaleSegmentHandles({ duration: 30, delta: 10 }, { duration: 60, delta: 10 }, { outX: 10, outY: 2, inX: -10, inY: 4 });
  assert.deepEqual(next, { outX: 20, outY: 2, inX: -20, inY: 4 });
});
test("rescale preserves shape when value span doubles", () => {
  const next = rescaleSegmentHandles({ duration: 30, delta: 10 }, { duration: 30, delta: 20 }, { outX: 10, outY: 2, inX: -10, inY: 4 });
  assert.deepEqual(next, { outX: 10, outY: 4, inX: -10, inY: 8 });
});
test("rescale flattens Y when collapsing to equal values", () => {
  const next = rescaleSegmentHandles({ duration: 30, delta: 10 }, { duration: 40, delta: 0 }, { outX: 10, outY: 2, inX: -10, inY: 4 });
  assert.ok(Math.abs(next.outX - (10 * 40) / 30) < 1e-9);
  assert.ok(Math.abs(next.inX - (-10 * 40) / 30) < 1e-9);
  assert.equal(next.outY, 0);
  assert.equal(next.inY, 0);
});
test("rescale keeps absolute Y when leaving equal values", () => {
  const next = rescaleSegmentHandles({ duration: 30, delta: 0 }, { duration: 30, delta: 10 }, { outX: 10, outY: 0, inX: -10, inY: 0 });
  assert.deepEqual(next, { outX: 10, outY: 0, inX: -10, inY: 0 });
});
test("rescale scales X but keeps Y for equal-to-equal moves", () => {
  const next = rescaleSegmentHandles({ duration: 30, delta: 0 }, { duration: 60, delta: 0 }, { outX: 10, outY: 0, inX: -10, inY: 0 });
  assert.deepEqual(next, { outX: 20, outY: 0, inX: -20, inY: 0 });
});
test("rescale rejects invalid durations", () => {
  assert.equal(rescaleSegmentHandles({ duration: 0, delta: 10 }, { duration: 30, delta: 10 }, { outX: 10, outY: 1, inX: -10, inY: 1 }), null);
});
test("snapshot/restore rescales neighboring segments on frame move", () => {
  const { snapshotChannelSegments, restoreChannelSegments } = EasingPlus.__test;
  const k0 = { frame: 0, value: 0, tween: 1, controlPoints: [[0, 0], [10, 5]] };
  const k1 = { frame: 30, value: 10, tween: 257, controlPoints: [[-10, -2], [10, 2]] };
  const k2 = { frame: 60, value: 20, tween: 257, controlPoints: [[-10, -3], [0, 0]] };
  const channel = { keyframes: [k0, k1, k2], onKeyframeChanged: { update() {} } };
  const snap = snapshotChannelSegments(channel);
  assert.equal(snap.length, 2);
  k1.frame = 45;
  restoreChannelSegments(channel, snap);
  assert.equal(k0.controlPoints[1][0], (10 * 45) / 30);
  assert.equal(k0.controlPoints[1][1], 5);
  assert.equal(k1.controlPoints[0][0], (-10 * 45) / 30);
  assert.equal(k1.controlPoints[0][1], -2);
  assert.equal(k1.controlPoints[1][0], (10 * 15) / 30);
  assert.equal(k1.controlPoints[1][1], 2);
  assert.equal(k2.controlPoints[0][0], (-10 * 15) / 30);
  assert.equal(k2.controlPoints[0][1], -3);
});
test("snapshot/restore rescales Y handles on value change", () => {
  const { snapshotChannelSegments, restoreChannelSegments } = EasingPlus.__test;
  const k0 = { frame: 0, value: 0, tween: 1, controlPoints: [[0, 0], [10, 4]] };
  const k1 = { frame: 30, value: 10, tween: 257, controlPoints: [[-10, -4], [0, 0]] };
  const channel = { keyframes: [k0, k1], onKeyframeChanged: { update() {} } };
  const snap = snapshotChannelSegments(channel);
  assert.equal(snap.length, 1);
  k1.value = 20;
  restoreChannelSegments(channel, snap);
  assert.equal(k0.controlPoints[1][0], 10);
  assert.equal(k0.controlPoints[1][1], 8);
  assert.equal(k1.controlPoints[0][0], -10);
  assert.equal(k1.controlPoints[0][1], -8);
});

test("isEasingPlusLeftoverSegment matches only Easing+ curves", () => {
  const { isEasingPlusLeftoverSegment } = EasingPlus.__test;
  const start = { frame: 0, value: 0, controlPoints: [[0, 0], [10, 5]] };
  const customEnd = (tween) => ({
    frame: 30,
    value: 10,
    tween,
    controlPoints: [[-10, -2], [0, 0]],
  });
  assert.equal(isEasingPlusLeftoverSegment(start, customEnd(257)), true);
  assert.equal(isEasingPlusLeftoverSegment(start, customEnd(1)), false);
  assert.equal(isEasingPlusLeftoverSegment(start, customEnd(262)), false);
  assert.equal(
    isEasingPlusLeftoverSegment(start, {
      frame: 30,
      value: 10,
      tween: 257,
      controlPoints: [[-10, 0], [0, 0]],
    }),
    true
  );
  assert.equal(
    isEasingPlusLeftoverSegment(
      { frame: 0, value: 0, controlPoints: [[0, 0], [10, 0]] },
      { frame: 30, value: 10, tween: 257, controlPoints: [[-10, 0], [0, 0]] }
    ),
    false
  );
  assert.equal(isEasingPlusLeftoverSegment(start, null), false);
});

test("cleanupActionsForSet clears leftovers when leaving Bezier", () => {
  const { cleanupActionsForSet } = EasingPlus.__test;
  const previous = { frame: 0, value: 0, controlPoints: [[0, 0], [10, 5]] };
  const current = {
    frame: 30,
    value: 10,
    tween: 257,
    controlPoints: [[-10, -2], [10, 4]],
  };
  const next = {
    frame: 60,
    value: 20,
    tween: 257,
    controlPoints: [[-10, -3], [0, 0]],
  };
  assert.deepEqual(cleanupActionsForSet(257, 0, previous, current, next), {
    resetIncoming: true,
    normalizeOutgoing: true,
  });
  assert.deepEqual(cleanupActionsForSet(1, 0, previous, current, next), {
    resetIncoming: false,
    normalizeOutgoing: true,
  });
  assert.deepEqual(cleanupActionsForSet(257, 1, previous, current, next), {
    resetIncoming: false,
    normalizeOutgoing: false,
  });
  const freshPrevious = { frame: 0, value: 0, controlPoints: [[0, 0], [10, 0]] };
  const freshCurrent = {
    frame: 30,
    value: 10,
    tween: 257,
    controlPoints: [[-10, 0], [10, 0]],
  };
  assert.deepEqual(cleanupActionsForSet(257, 0, freshPrevious, freshCurrent, null), {
    resetIncoming: false,
    normalizeOutgoing: false,
  });
});
