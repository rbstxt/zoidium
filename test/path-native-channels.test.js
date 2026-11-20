"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness.js");
const { create } = require("../plugins/shape-plus/path-native-channels.js");
const { PZ } = nativeHost(), adapter = create(PZ);
const channel = tween => ({ animated: false, keyframes: [
  { frame: 0, value: 3, tween: 1 }, { frame: 20, value: 19, tween },
] });
function native(data, frame) {
  const p = PZ.property.create({ name: "Test", type: 0, dynamic: true, value: 0 });
  p.load(JSON.parse(JSON.stringify(data))); return p.get(frame);
}
test("sample follows native hold, eased and disabled channel evaluation", () => {
  for (const tween of [0, 1, 2, 7, 18, 257]) for (let frame = -2; frame <= 22; frame += 0.5)
    assert.equal(adapter.sample(channel(tween), frame), native(channel(tween), frame));
  assert.throws(() => adapter.sample({ ...channel(1), expression: "frame" }, 2), /Expression/);
});
test("makeKey uses native key defaults and the incoming segment tween", () => {
  const key = adapter.makeKey(channel(7), 10, 8);
  assert.equal(key.tween, 7); assert.equal(key.frame, 10); assert.equal(key.value, 8);
  assert.deepEqual(key.controlPoints, [[-10, 0], [10, 0]]);
});
const topology = require("../plugins/shape-plus/path-topology.js");
function fixture(tween = 1) {
  return { id: "p", vertexIds: ["a", "b"], vertexModes: {}, properties: { closed: 0, path: {
    objects: Array.from({ length: 12 }, (_, i) => ({ animated: true, keyframes: [
      { frame: 0, value: i * 2, tween: 1 }, { frame: 20, value: i * 3 + 1, tween },
    ] })),
  } } };
}
test("topology certifies matching native eased channels and rejects a stub", () => {
  for (const tween of [1, 2, 7, 18]) {
    const data = fixture(tween), host = { data, commit(value) { this.data = value; } };
    assert.throws(() => topology.apply(host, { kind: "insert", index: 0, t: 0.4, id: "c" }, { ...adapter, certify: () => false }), /preservation/);
    assert.equal(topology.apply(host, { kind: "insert", index: 0, t: 0.4, id: "c" }, adapter), true);
    assert.equal(host.data.vertexIds.length, 3);
  }
});
test("synchronization refuses subdivision of an eased segment", () => {
  const original = channel(2), next = JSON.parse(JSON.stringify(original));
  next.keyframes.splice(1, 0, adapter.makeKey(original, 10, adapter.sample(original, 10)));
  assert.notEqual(adapter.certify({ phase: "synchronize", before: [original], after: [next] }), true);
});
