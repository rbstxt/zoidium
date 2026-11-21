"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const meter = require("../plugins/player-plus/fps-meter.js");

test("FPS meter smooths displayed frames and tolerates small timing differences", () => {
  const tracker = meter.createTracker();
  tracker.sample(0, 0, 30);
  let result;
  for (let i = 1; i <= 30; i++) result = tracker.sample(i * 34, i, 30);
  assert.equal(result.notRealtime, false);
  for (let i = 31; i <= 60; i++) result = tracker.sample(1020 + (i - 30) * 60, i, 30);
  assert.equal(result.notRealtime, true);
  assert.ok(result.fps < 20);
  tracker.reset();
  assert.equal(tracker.sample(4000, 0, 30), null);
});

test("FPS meter preference defaults off and persists", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(meter.readEnabled(storage), false);
  meter.writeEnabled(storage, true);
  assert.equal(meter.readEnabled(storage), true);
  meter.writeEnabled(storage, false);
  assert.equal(meter.readEnabled(storage), false);
});
