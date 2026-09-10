"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyTemporalOperators,
  buildFrameSamplePlan,
  clampLocalFrame,
  findScheduleItemAtFrame,
  isClipActiveAtProjectFrame,
  mapTemporalFrameWithScopes,
  quantizeLocalFrame,
} = require("../plugins/core/temporal-render");

test("builds echo samples directly from the requested frame", () => {
  assert.deepEqual(
    buildFrameSamplePlan(12, 4, -3, 0.8, 0.5, 0, 60),
    [
      { frame: 9, index: 1, opacity: 0.8 },
      { frame: 6, index: 2, opacity: 0.4 },
      { frame: 3, index: 3, opacity: 0.2 },
      { frame: 0, index: 4, opacity: 0.1 },
    ],
  );
  assert.deepEqual(
    buildFrameSamplePlan(2, 3, -3, 1, 1, 0, 60).map((sample) => sample.frame),
    [0, 0, 0],
  );
});

test("frame samples do not depend on request order or playback history", () => {
  const requested = [0, 1, 8, 12, 24];
  const forward = requested.map((frame) =>
    buildFrameSamplePlan(frame, 3, -2.5, 0.75, 0.6, 0, 60),
  );
  const reverse = requested
    .slice()
    .reverse()
    .map((frame) => buildFrameSamplePlan(frame, 3, -2.5, 0.75, 0.6, 0, 60))
    .reverse();

  assert.deepEqual(reverse, forward);
});

test("quantizes local time from the project clock, not from render cadence", () => {
  const mapped = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((frame) =>
    quantizeLocalFrame(frame, 30, 12),
  );

  assert.deepEqual(mapped, [0, 0, 0, 2.5, 2.5, 5, 5, 5, 7.5]);
});

test("applies temporal operators in their serialized order", () => {
  const mapped = applyTemporalOperators(
    8,
    30,
    [
      { kind: "time-offset", offsetFrames: 2 },
      { kind: "posterize-time", fps: 12 },
    ],
    60,
  );

  assert.equal(mapped, 10);
});

test("clamps offsets to the layer's finite frame range", () => {
  assert.equal(clampLocalFrame(-4, 30), 0);
  assert.ok(clampLocalFrame(30, 30) < 30);
  assert.equal(
    applyTemporalOperators(4, 30, [{ kind: "time-offset", offsetFrames: -20 }], 30),
    0,
  );
  assert.equal(
    applyTemporalOperators(4, 30, [{ kind: "time-offset", offsetFrames: 40 }], 30),
    30 - 1e-9,
  );
});

test("mapping is independent of the order in which frames are requested", () => {
  const operators = [{ kind: "posterize-time", fps: 12 }];
  const forward = [0, 1, 2, 3, 8, 13].map((frame) =>
    applyTemporalOperators(frame, 30, operators, 60),
  );
  const reverse = [13, 8, 3, 2, 1, 0]
    .map((frame) => applyTemporalOperators(frame, 30, operators, 60))
    .reverse();

  assert.deepEqual(reverse, forward);
});

test("adjustment scopes transform every lower layer in project time", () => {
  assert.equal(
    mapTemporalFrameWithScopes(
      4,
      30,
      [],
      [
        { kind: "time-offset", offsetFrames: 3 },
        { kind: "posterize-time", fps: 12 },
      ],
      100,
      0,
    ),
    5,
  );

  assert.equal(
    mapTemporalFrameWithScopes(
      4,
      30,
      [],
      [{ kind: "posterize-time", fps: 12 }, { kind: "time-offset", offsetFrames: 3 }],
      100,
      0,
    ),
    5.5,
  );
});

test("a temporal effect can remap an earlier effect's evaluation frame", () => {
  assert.equal(
    mapTemporalFrameWithScopes(
      4,
      30,
      [],
      [{ kind: "posterize-time", fps: 12 }],
      100,
      0,
    ),
    2.5,
  );
});

test("procedural layers extrapolate beyond their out-point instead of freezing", () => {
  // project (26).pz: sequence length 1115, Time Offset ramps to +480.
  // At output local 800 the warped source is 1280, past the 1115 end.
  const frozen = mapTemporalFrameWithScopes(
    800,
    60,
    [],
    [{ kind: "time-offset", offsetFrames: 480 }],
    1115,
    0,
  );
  assert.ok(frozen < 1115, "media path still clamps");

  const extrapolated = mapTemporalFrameWithScopes(
    800,
    60,
    [],
    [{ kind: "time-offset", offsetFrames: 480 }],
    1115,
    0,
    true,
  );
  assert.equal(extrapolated, 1280);
});

test("extrapolation also allows negative sources for procedural layers", () => {
  assert.equal(
    applyTemporalOperators(4, 30, [{ kind: "time-offset", offsetFrames: -20 }], 30, true),
    -16,
  );
  assert.equal(clampLocalFrame(-4, 30, true), -4);
  assert.equal(
    mapTemporalFrameWithScopes(4, 30, [], [{ kind: "time-offset", offsetFrames: -10 }], 30, 0, true),
    -6,
  );
});

test("schedule lookup uses the output frame instead of a stale currentItem", () => {
  const clipA = { start: 0, length: 780 };
  const clipB = { start: 780, length: 335 };
  const schedule = {
    padding: 0,
    currentItem: { clip: clipA, start: 0, length: 780 },
    items: [
      { clip: clipA, start: 0, length: 780 },
      { clip: clipB, start: 780, length: 335 },
    ],
  };
  // At output 780 the stale currentItem still points at clip A, but the
  // output-active item is clip B.
  assert.equal(findScheduleItemAtFrame(schedule, 779).item.clip, clipA);
  assert.equal(findScheduleItemAtFrame(schedule, 780).item.clip, clipB);
  assert.equal(findScheduleItemAtFrame(schedule, 1114).item.clip, clipB);
  assert.equal(findScheduleItemAtFrame(schedule, 1115), null);
});

test("inactive clips are not temporally mapped", () => {
  const clip = { start: 780, length: 335 };
  assert.equal(isClipActiveAtProjectFrame(clip, 779), false);
  assert.equal(isClipActiveAtProjectFrame(clip, 780), true);
  assert.equal(isClipActiveAtProjectFrame(clip, 1114), true);
  assert.equal(isClipActiveAtProjectFrame(clip, 1115), false);
});
