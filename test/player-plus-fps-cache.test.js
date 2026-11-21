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
  store.clear();
  assert.deepEqual(frameRanges(store.entries.values(), 1), []);
  assert.ok(changes >= 4);
});

test("timeline cache bar batches cache changes and draws clipped frame ranges", () => {
  const { createBar } = require("../plugins/core/timeline-cache-bar.js");
  const calls = [], queue = [];
  const context = { clearRect: (...args) => calls.push(["clear", ...args]), fillRect: (...args) => calls.push(["fill", ...args]) };
  const canvas = { style: {}, getContext: () => context, remove() {} };
  const win = { document: { createElement: () => canvas }, requestAnimationFrame: fn => { queue.push(fn); return queue.length; }, cancelAnimationFrame() {} };
  const viewport = {};
  let listener;
  const cache = { ranges: () => [[1, 4], [8, 12]], subscribe: fn => { listener = fn; return () => {}; } };
  const timeline = { timerule: { clientWidth: 100, appendChild() {} }, editor: { mainViewport: viewport }, scrollBar: { scrollLeft: 20 }, zoom: 1, frameToPx: frame => frame * 10 };
  const bar = createBar(win, timeline, cache);
  listener(); listener();
  assert.equal(queue.length, 1);
  queue.shift()();
  assert.deepEqual(calls.filter(call => call[0] === "fill"), [["fill", 0, 0, 20, 3], ["fill", 60, 0, 40, 3]]);
  bar.dispose();
});
