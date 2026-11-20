"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const timeline = require("../plugins/shape-plus/path-timeline-model.js");

const copy = (v) => JSON.parse(JSON.stringify(v));
function item() {
  return { id: "p", vertexIds: ["v"], properties: { name: "Path A", path: { objects: Array.from({ length: 6 }, (_, i) => ({ animated: true, keyframes: (i === 0 ? [0, 5, 10] : [0, 10]).map((frame) => ({ frame, value: i + frame, tween: i })) })) } } };
}
function fixture(kind = "mask") {
  const state = { data: item(), history: [], seeks: [], notifications: 0, listeners: new Set() };
  const host = { get data() { return state.data; }, commit(next) { state.history.push(copy(state.data)); state.data = next; for (const listener of state.listeners) listener(); }, seek(frame) { state.seeks.push(frame); } };
  const context = { project: {}, clip: { start: 100, offset: 20 }, overlay: {}, paths: [{ kind, id: "p", name: "Path A", host }], observe(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); } };
  return { state, host, context };
}

test("hierarchy and logical union use current clip time, independent of native frame cache", () => {
  const { context } = fixture();
  const model = timeline.create(context);
  assert.deepEqual(model.rows()[0].children[0].children[0].diamonds.map((d) => [d.localFrame, d.frame]), [[0, 80], [5, 85], [10, 90]]);
  assert.equal(model.rows()[0].label, "Masks");
  assert.equal(model.rows()[0].children[0].label, "Path A");
  assert.equal(model.rows()[0].children[0].children[0].label, "Mask Path");
  context.clip.start = 120;
  assert.deepEqual(model.rows()[0].children[0].children[0].diamonds.map((d) => d.frame), [100, 105, 110]);
  model.dispose();
  const other = fixture("shape");
  assert.equal(timeline.create(other.context).rows()[0].children[0].children[0].label, "Path");
});

test("move deduplicates selected diamonds and moves each channel key once in one snapshot with undo", () => {
  const { state, context } = fixture();
  const model = timeline.create(context);
  assert.equal(model.move("p", [80, 80, 85], 2), true);
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.data.properties.path.objects[0].keyframes.map((k) => k.frame), [2, 7, 10]);
  assert.deepEqual(state.data.properties.path.objects[1].keyframes.map((k) => k.frame), [2, 10]);
  assert.equal(state.data.properties.path.objects[0].keyframes[0].tween, 0);
  state.data = state.history.pop();
  assert.deepEqual(model.rows()[0].children[0].children[0].diamonds.map((d) => d.frame), [80, 85, 90]);
  model.dispose();
});

test("delete is atomic, preserves one key per channel, and seeks in project time", () => {
  const { state, context } = fixture();
  const model = timeline.create(context);
  assert.equal(model.remove("p", [80, 85, 80]), true);
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.data.properties.path.objects.map((c) => c.keyframes.map((k) => k.frame)), Array.from({ length: 6 }, () => [10]));
  assert.equal(model.remove("p", [90]), false);
  assert.equal(state.history.length, 1);
  assert.equal(model.seek("p", 90), true);
  assert.deepEqual(state.seeks, [90]);
  assert.equal(model.seek("p", 85), false);
  model.dispose();
});

test("move rejects collisions and no-ops without a transaction", () => {
  const { state, context } = fixture();
  const model = timeline.create(context);
  assert.equal(model.move("p", [80], 10), false);
  assert.equal(model.move("p", [80], 0), false);
  assert.equal(state.history.length, 0);
  model.dispose();
});

test("observers refresh and detach across clip, project, overlay changes and disposal", () => {
  const first = fixture(), second = fixture();
  const model = timeline.create(first.context, () => first.state.notifications++);
  assert.equal(first.state.listeners.size, 1);
  for (const listener of first.state.listeners) listener();
  assert.equal(first.state.notifications, 2);
  const stale = [...first.state.listeners][0];
  for (const key of ["clip", "project", "overlay"]) {
    const prior = second.context[key];
    model.bind(second.context);
    second.context[key] = {};
    model.bind(second.context);
    assert.notEqual(second.context[key], prior);
    assert.equal(second.state.listeners.size, 1);
  }
  assert.equal(first.state.listeners.size, 0);
  const before = first.state.notifications;
  stale();
  assert.equal(first.state.notifications, before);
  model.dispose();
  assert.equal(second.state.listeners.size, 0);
  assert.deepEqual(model.rows(), []);
});

 test("grouped keys, selection, locks, and overlapping moves retain data", () => {
  const { state, context } = fixture();
  state.data.properties.path = { animated: true, keyframes: [0, 5, 10].map((frame) => ({ frame, value: Array(6).fill(frame), tween: 7 })) };
  const model = timeline.create(context);
  model.select("p", [80, 85, 85]);
  assert.deepEqual(model.rows()[0].children[0].children[0].diamonds.map((d) => d.selected), [true, true, false]);
  assert.equal(model.move("p", [80, 85], 5), false);
  assert.equal(model.move("p", [80, 85, 90], 5), true);
  assert.deepEqual(state.data.properties.path.objects[0].keyframes.map((k) => [k.frame, k.tween]), [[5, 7], [10, 7], [15, 7]]);
  assert.deepEqual(model.rows()[0].children[0].children[0].diamonds.map((d) => d.selected), [true, true, false]);
  state.data.locked = true;
  assert.equal(model.remove("p", [85]), false);
  assert.equal(state.history.length, 1);
  model.dispose();
});
