"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const animation = require("../plugins/shape-plus/path-animation.js");

function fixture() {
  return { vertexIds: ["a", "b"], properties: { path: { objects: Array.from({ length: 12 }, (_, i) => ({
    animated: true, keyframes: [{ frame: 0, value: i, tween: 1, tag: "start" },
      { frame: i === 0 ? 10 : 20, value: i + 20, tween: 2, tag: "end" }],
  })) } } };
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const adapter = {
  sample(channel, frame) {
    const keys = channel.keyframes;
    if (!channel.animated || frame <= keys[0].frame) return keys[0].value;
    const next = keys.findIndex((key) => key.frame >= frame);
    if (next < 0) return keys[keys.length - 1].value;
    const a = keys[next - 1], b = keys[next];
    return a.value + (b.value - a.value) * (frame - a.frame) / (b.frame - a.frame);
  },
  makeKey(channel, frame, value) {
    const next = channel.keyframes.find((key) => key.frame >= frame) || channel.keyframes.at(-1);
    return { frame, value, tween: next.tween, controlPoints: [[-10, 0], [10, 0]] };
  },
};
function host(data) {
  return { data, history: [], commit(next) { this.history.push(clone(this.data)); this.data = next; } };
}

test("logical union, diamond states, and project time navigation", () => {
  const data = fixture();
  assert.deepEqual(animation.frames(data), [0, 10, 20]);
  assert.equal(animation.diamond(data, 10), "filled");
  assert.equal(animation.diamond(data, 5), "outlined");
  assert.equal(animation.previous(data, 106, { start: 100, offset: 4 }), 96);
  assert.equal(animation.next(data, 106, { start: 100, offset: 4 }), 116);
  assert.equal(animation.previous(data, 96, { start: 100, offset: 4 }), null);
  data.properties.path.objects.forEach((c) => { c.animated = false; });
  assert.equal(animation.diamond(data, 0), "hollow");
});

test("auto-key samples all channels before writes and preserves existing keys", () => {
  const h = host(fixture()), original = clone(h.data);
  const calls = [];
  const guarded = { ...adapter, sample(channel, frame, index) { calls.push(index); return adapter.sample(channel, frame); } };
  const values = original.properties.path.objects.map((c) => adapter.sample(c, 10));
  values[0] += 3;
  assert.equal(animation.edit(h, 10, values, guarded), true);
  assert.equal(h.history.length, 1);
  assert.equal(calls.length, 12);
  h.data.properties.path.objects.forEach((c, i) => {
    assert.equal(c.keyframes.find((k) => k.frame === 10).value, values[i]);
    assert.deepEqual(c.keyframes.find((k) => k.frame === 20), original.properties.path.objects[i].keyframes.find((k) => k.frame === 20));
  });
  assert.equal(h.data.properties.path.objects[0].keyframes.find((k) => k.frame === 10).tween, 2);
  assert.equal(h.data.properties.path.objects[1].keyframes.find((k) => k.frame === 10).tween, 2);
});

test("an animated no-op at an unkeyed frame adds no keys", () => {
  const h = host(fixture()), before = clone(h.data);
  const values = before.properties.path.objects.map((channel) => adapter.sample(channel, 5));
  assert.equal(animation.edit(h, 5, values, adapter), false);
  assert.deepEqual(h.data, before);
  assert.equal(h.history.length, 0);
});

test("mixed animation states retain static behavior and the logical key value", () => {
  const data = fixture();
  data.properties.path.objects[1].animated = false;
  const h = host(data), values = data.properties.path.objects.map((channel) => adapter.sample(channel, 5));
  values[1] = 99;
  assert.equal(animation.edit(h, 5, values, adapter), true);
  const channel = h.data.properties.path.objects[1];
  assert.equal(channel.animated, false);
  assert.equal(channel.keyframes[0].value, 99);
  assert.equal(channel.keyframes.find((key) => key.frame === 5).value, 99);
});

test("no-op creates no key or history; grouped storage stays intact", () => {
  const h = host({ vertexIds: ["a"], properties: { path: { animated: false,
    keyframes: [{ frame: 0, value: [1, 2, 3, 4, 5, 6], tween: 1 }] } } });
  assert.equal(animation.edit(h, 5, [1, 2, 3, 4, 5, 6], adapter), false);
  assert.equal(h.history.length, 0);
  assert.ok(h.data.properties.path.keyframes);
  assert.equal(animation.edit(h, 5, [2, 2, 3, 4, 5, 6], adapter), true);
  assert.equal(h.history.length, 1);
  assert.equal(animation.diamond(h.data, 5), "hollow");
  assert.equal(h.data.properties.path.objects[0].keyframes[0].value, 2);
});

test("enable, disable, add and remove logical keys retain at least one key", () => {
  const h = host(fixture());
  assert.equal(animation.setEnabled(h, false, 7, adapter), true);
  assert.equal(animation.diamond(h.data, 0), "hollow");
  assert.equal(animation.setEnabled(h, false, 7, adapter), false);
  assert.equal(animation.setEnabled(h, true, 7, adapter), true);
  assert.equal(animation.diamond(h.data, 7), "filled");
  assert.equal(animation.toggleKey(h, 7, adapter), true);
  assert.equal(animation.diamond(h.data, 7), "outlined");
  assert.equal(animation.toggleKey(h, 10, adapter), true);
  assert.equal(animation.diamond(h.data, 10), "outlined");
  const only = host({ vertexIds: ["a"], properties: { path: { animated: true,
    keyframes: [{ frame: 0, value: [0, 0, 0, 0, 0, 0], tween: 1 }] } } });
  assert.equal(animation.toggleKey(only, 0, adapter), false);
  assert.equal(only.history.length, 0);
});

test("a sampling failure does not mutate or record history", () => {
  const h = host(fixture()), before = clone(h.data);
  assert.throws(() => animation.edit(h, 5, Array(12).fill(50), { ...adapter,
    sample(channel, frame, index) { if (index === 5) throw Error("sample failed"); return adapter.sample(channel, frame); },
  }), /sample failed/);
  assert.deepEqual(h.data, before);
  assert.equal(h.history.length, 0);
});
