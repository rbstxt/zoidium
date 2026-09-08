"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyTemporalOperators,
  clampLocalFrame,
  mapTemporalFrameWithScopes,
  quantizeLocalFrame,
} = require("../plugins/core-patches/temporal-render");

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
