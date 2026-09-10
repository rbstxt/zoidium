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

test("pickTargetForSet sends every pick to the outgoing segment", () => {
  const { pickTargetForSet } = EasingPlus.__test;
  const start = { frame: 0, value: 0, controlPoints: [[0, 0], [10, 5]] };
  const easingEnd = {
    frame: 30,
    value: 10,
    tween: 257,
    controlPoints: [[-10, -2], [0, 0]],
  };
  assert.equal(pickTargetForSet(start, easingEnd), "outgoing");
  assert.equal(pickTargetForSet(start, { ...easingEnd, tween: 1 }), "outgoing");
  assert.equal(pickTargetForSet(start, null), "current");
  assert.equal(
    pickTargetForSet(
      { frame: 0, value: 0, controlPoints: [[0, 0], [10, 0]] },
      { frame: 30, value: 10, tween: 257, controlPoints: [[-10, 0], [0, 0]] }
    ),
    "outgoing"
  );
});

test("resolveDisplayTweens follows the outgoing rule per channel", () => {
  const { resolveDisplayTweens } = EasingPlus.__test;
  const mockChannel = (keyframes) => ({
    getKeyframe(frame) {
      return keyframes.find((entry) => entry.frame === frame) || null;
    },
    getNextKeyframe(frame) {
      const rest = keyframes
        .filter((entry) => entry.frame > frame)
        .sort((a, b) => a.frame - b.frame);
      return rest[0] || null;
    },
  });
  const channel = mockChannel([
    { frame: 0, tween: 1 },
    { frame: 30, tween: 5 },
    { frame: 60, tween: 9 },
  ]);
  assert.deepEqual(resolveDisplayTweens([channel], 0), [5]);
  assert.deepEqual(resolveDisplayTweens([channel], 30), [9]);
  assert.deepEqual(resolveDisplayTweens([channel], 60), [9]);
  assert.deepEqual(resolveDisplayTweens([channel], 15), []);
  const group = [
    mockChannel([
      { frame: 30, tween: 1 },
      { frame: 60, tween: 5 },
    ]),
    mockChannel([{ frame: 30, tween: 7 }]),
  ];
  assert.deepEqual(resolveDisplayTweens(group, 30), [5, 7]);
  const broken = mockChannel([
    { frame: 30, tween: 1 },
    { frame: 60 },
  ]);
  assert.equal(resolveDisplayTweens([broken], 30), null);
});

test("executeTweenWrite redirects picks to the next keyframe", () => {
  const { executeTweenWrite } = EasingPlus.__test;
  const calls = [];
  const propertyOps = {
    setTween(args) {
      calls.push({ op: "tween", ...args });
    },
    setControlPoints(args) {
      calls.push({ op: "handles", ...args });
    },
  };
  const current = { frame: 30, value: 10, controlPoints: [[-1, -2], [10, 5]] };
  const next = {
    frame: 60,
    value: 20,
    tween: 257,
    controlPoints: [[-10, -3], [4, 4]],
  };
  const target = executeTweenWrite(propertyOps, "addr", 30, current, next, 0, 3);
  assert.equal(target, "outgoing");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { op: "tween", property: "addr", frame: 60, tween: 3 });
  assert.deepEqual(calls[1], {
    op: "handles",
    property: "addr",
    frame: 30,
    controlPoints: [[-1, -2], [10, 0]],
  });
  assert.deepEqual(calls[2], {
    op: "handles",
    property: "addr",
    frame: 60,
    controlPoints: [[-10, 0], [4, 4]],
  });
});

test("executeTweenWrite skips handle writes that already match the defaults", () => {
  const { executeTweenWrite } = EasingPlus.__test;
  const calls = [];
  const propertyOps = {
    setTween(args) {
      calls.push({ op: "tween", ...args });
    },
    setControlPoints(args) {
      calls.push({ op: "handles", ...args });
    },
  };
  const current = { frame: 30, value: 10, controlPoints: [[-1, -2], [10, 0]] };
  const next = {
    frame: 60,
    value: 20,
    tween: 1,
    controlPoints: [[-10, 0], [4, 4]],
  };
  const target = executeTweenWrite(propertyOps, "addr", 30, current, next, 0, 3);
  assert.equal(target, "outgoing");
  assert.deepEqual(calls, [{ op: "tween", property: "addr", frame: 60, tween: 3 }]);
});

test("executeTweenWrite keeps native picks on the current keyframe", () => {
  const { executeTweenWrite } = EasingPlus.__test;
  const calls = [];
  const propertyOps = {
    setTween(args) {
      calls.push({ op: "tween", ...args });
    },
    setControlPoints(args) {
      calls.push({ op: "handles", ...args });
    },
  };
  const current = { frame: 30, value: 10, controlPoints: [[0, 0], [10, 0]] };
  const target = executeTweenWrite(propertyOps, "addr", 30, current, null, 0, 3);
  assert.equal(target, "current");
  assert.deepEqual(calls, [{ op: "tween", property: "addr", frame: 30, tween: 3 }]);
});

test("applyOutgoingDisplay shows the outgoing segment on its first keyframe", () => {
  const { applyOutgoingDisplay } = EasingPlus.__test;
  const realWindow = globalThis.window;
  const mockChannel = (keyframes) => ({
    getKeyframe(frame) {
      return keyframes.find((entry) => entry.frame === frame) || null;
    },
    getNextKeyframe(frame) {
      const rest = keyframes
        .filter((entry) => entry.frame > frame)
        .sort((a, b) => a.frame - b.frame);
      return rest[0] || null;
    },
  });
  const mockRow = (property, currentFrame, calls) => {
    const buttons = [
      {
        title: "interpolation",
        pz_update(tween, visible) {
          calls.push(["interp", tween, visible]);
        },
      },
      {
        title: "easing",
        pz_update(tween, visible) {
          calls.push(["ease", tween, visible]);
        },
      },
    ];
    return {
      parentElement: {
        parentElement: {
          pz_object: property,
          parentElement: { pz_controls: { editor: { playback: { currentFrame } } } },
        },
      },
      querySelectorAll() {
        return buttons;
      },
    };
  };
  globalThis.window = { PZ: {} };
  try {
    const calls = [];
    const property = {
      frameOffset: 0,
      definition: { interpolated: true },
    };
    property.getKeyframe = mockChannel([
      { frame: 30, tween: 1 },
      { frame: 60, tween: 5 },
    ]).getKeyframe;
    property.getNextKeyframe = mockChannel([
      { frame: 30, tween: 1 },
      { frame: 60, tween: 5 },
    ]).getNextKeyframe;
    assert.equal(applyOutgoingDisplay(mockRow(property, 30, calls)), true);
    assert.deepEqual(calls, [
      ["interp", 5, true],
      ["ease", 5, true],
    ]);
    const finalCalls = [];
    assert.equal(applyOutgoingDisplay(mockRow(property, 60, finalCalls)), true);
    assert.deepEqual(finalCalls, [
      ["interp", 5, true],
      ["ease", 5, true],
    ]);
    const awayCalls = [];
    assert.equal(applyOutgoingDisplay(mockRow(property, 45, awayCalls)), false);
    assert.deepEqual(awayCalls, []);
    const hiddenCalls = [];
    const still = { frameOffset: 0, definition: { interpolated: false } };
    still.getKeyframe = property.getKeyframe;
    still.getNextKeyframe = property.getNextKeyframe;
    assert.equal(applyOutgoingDisplay(mockRow(still, 30, hiddenCalls)), true);
    assert.deepEqual(hiddenCalls, [
      ["interp", 5, false],
      ["ease", 5, false],
    ]);
  } finally {
    if (typeof realWindow === "undefined") delete globalThis.window;
    else globalThis.window = realWindow;
  }
});

test("applyOutgoingDisplay hides grouped channels that disagree", () => {
  const { applyOutgoingDisplay } = EasingPlus.__test;
  const realWindow = globalThis.window;
  class Group {}
  globalThis.window = { PZ: { property: { dynamic: { group: Group } } } };
  try {
    const mockChannel = (keyframes) => ({
      getKeyframe(frame) {
        return keyframes.find((entry) => entry.frame === frame) || null;
      },
      getNextKeyframe(frame) {
        const rest = keyframes
          .filter((entry) => entry.frame > frame)
          .sort((a, b) => a.frame - b.frame);
        return rest[0] || null;
      },
    });
    const calls = [];
    const property = new Group();
    property.frameOffset = 0;
    property.objects = [
      mockChannel([
        { frame: 30, tween: 1 },
        { frame: 60, tween: 5 },
      ]),
      mockChannel([
        { frame: 30, tween: 1 },
        { frame: 60, tween: 9 },
      ]),
    ];
    const row = {
      parentElement: {
        parentElement: {
          pz_object: property,
          parentElement: { pz_controls: { editor: { playback: { currentFrame: 30 } } } },
        },
      },
      querySelectorAll() {
        return [
          {
            title: "interpolation",
            pz_update(tween, visible) {
              calls.push(["interp", tween, visible]);
            },
          },
          {
            title: "easing",
            pz_update(tween, visible) {
              calls.push(["ease", tween, visible]);
            },
          },
        ];
      },
    };
    assert.equal(applyOutgoingDisplay(row), true);
    assert.deepEqual(calls, [
      ["interp", -1, false],
      ["ease", -1, false],
    ]);
  } finally {
    if (typeof realWindow === "undefined") delete globalThis.window;
    else globalThis.window = realWindow;
  }
});
