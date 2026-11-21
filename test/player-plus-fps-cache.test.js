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

test("FPS meter holds its state between the trip and recovery thresholds", () => {
  const tracker = meter.createTracker();
  let time = 0, frame = 0, result;
  function feed(interval, count = 40) {
    for (let i = 0; i < count; i++) result = tracker.sample(time += interval, frame++, 30);
    return result.notRealtime;
  }
  assert.equal(feed(36), true);
  assert.equal(feed(34.5), true);
  assert.equal(feed(33), false);
  assert.equal(feed(34.5), false);
  tracker.reset();
  assert.equal(feed(34.5), false);
});

test("cache ranges reflect additions, eviction, and invalidation", () => {
  const { FrameStore, frameRanges } = require("../plugins/core/output-frame-store.js");
  const store = new FrameStore(2);
  let changes = 0;
  store.subscribe(() => changes++);
  const entry = (owner, frame) => ({ owner, frame, bytes: 1, complete: true, dispose() {} });
  store.put("a", entry(1, 1));
  store.put("b", entry(1, 2));
  assert.deepEqual(frameRanges(store.entries.values(), 1), [[1, 3]]);
  store.put("c", entry(2, 3));
  assert.deepEqual(frameRanges(store.entries.values(), 1), [[2, 3]]);
  assert.deepEqual(store.ranges(1), [[2, 3]]);
  const beforeClear = changes;
  store.clear();
  assert.equal(changes, beforeClear + 1);
  assert.deepEqual(store.ranges(1), []);
  assert.deepEqual(frameRanges(store.entries.values(), 1), []);
  assert.ok(changes >= 4);
});

test("timeline cache bar batches cache changes and draws clipped frame ranges", () => {
  const { createBar } = require("../plugins/core/timeline-cache-bar.js");
  const calls = [], queue = [];
  const context = { clearRect: (...args) => calls.push(["clear", ...args]), fillRect: (...args) => calls.push(["fill", ...args]) };
  const canvas = { style: {}, setAttribute: (name, value) => calls.push([name, value]), getContext: () => context, remove() {} };
  const win = { document: { createElement: () => canvas }, requestAnimationFrame: fn => { queue.push(fn); return queue.length; }, cancelAnimationFrame() {} };
  const viewport = {};
  let listener;
  const cache = { ranges: () => [[1, 4], [8, 12]], subscribe: fn => { listener = fn; return () => {}; } };
  const timeline = { timerule: { clientWidth: 100, appendChild() {} }, editor: { mainViewport: viewport }, scrollBar: { scrollLeft: 20 }, zoom: 1, frameToPx: frame => frame * 10 };
  const bar = createBar(win, timeline, cache);
  assert.ok(calls.some(call => call[0] === "aria-hidden" && call[1] === "true"));
  listener(); listener();
  assert.equal(queue.length, 1);
  queue.shift()();
  assert.deepEqual(calls.filter(call => call[0] === "fill"), [["fill", 0, 0, 20, 3], ["fill", 60, 0, 40, 3]]);
  bar.dispose();
});
