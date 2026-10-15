"use strict";

// Unit tests for the explicit per-tap frame sampler plan backing Time
// Displacement slices and CC Wide Time forward/backward steps
// (plugins/core/temporal-math.js). The legacy evenly spaced Echo plan is
// pinned by test/temporal-quantize-helpers.test.js and must not change.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_EXPLICIT_FRAME_SAMPLES,
  planExplicitFrameSamples,
} = require("../plugins/core/temporal-render");

test("explicit frames plan one tap per offset with full opacity", () => {
  assert.deepEqual(planExplicitFrameSamples(10, [-3, -1, 0, 2], 0, 12), [
    { frame: 7, index: 0, opacity: 1 },
    { frame: 9, index: 1, opacity: 1 },
    { frame: 10, index: 2, opacity: 1 },
    { frame: 12, index: 3, opacity: 1 },
  ]);
});

test("explicit frames clamp to the clip bounds like the Echo plan", () => {
  assert.deepEqual(planExplicitFrameSamples(1, [-5, 100], 0, 12).map((tap) => tap.frame), [0, 12]);
  assert.deepEqual(
    planExplicitFrameSamples(4, [-9, 9], 0, 0).map((tap) => tap.frame),
    [0, 0],
    "empty clips freeze on the edge frame",
  );
});

test("explicit frames cap the tap count at 64", () => {
  assert.equal(MAX_EXPLICIT_FRAME_SAMPLES, 64);
  const offsets = [];
  for (let step = -45; step <= 45; step += 1) offsets.push(step);
  const plan = planExplicitFrameSamples(50, offsets, 0, 200);
  assert.equal(plan.length, 64);
  assert.deepEqual(
    plan.map((tap) => tap.index),
    offsets.slice(0, 64).map((_, index) => index),
  );
});

test("explicit frame plans are deterministic and order-independent", () => {
  const first = planExplicitFrameSamples(33.5, [-2.5, 0, 4.25], 0, 100);
  const second = planExplicitFrameSamples(33.5, [-2.5, 0, 4.25], 0, 100);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    { frame: 31, index: 0, opacity: 1 },
    { frame: 33.5, index: 1, opacity: 1 },
    { frame: 37.75, index: 2, opacity: 1 },
  ]);
});

test("explicit frames ignore non-array requests", () => {
  assert.deepEqual(planExplicitFrameSamples(10, null, 0, 60), []);
  assert.deepEqual(planExplicitFrameSamples(10, "nope", 0, 60), []);
  assert.deepEqual(planExplicitFrameSamples(10, [], 0, 60), []);
});
