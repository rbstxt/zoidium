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
test("grouped storage round trips compatible channels and rejects independent keys", () => {
  const { coercePath } = require("../plugins/shape-plus/path-native-channels.js");
  const path = fixture().properties.path;
  assert.deepEqual(coercePath(coercePath(path), "objects"), path);
  const mismatched = JSON.parse(JSON.stringify(path));
  mismatched.objects[0].keyframes[1].frame = 10;
  assert.throws(() => coercePath(mismatched), /independent/);
});
const animation = require("../plugins/shape-plus/path-animation.js");
const geometry = require("../plugins/shape-plus/editor-geometry.js");
const curve = require("../plugins/shape-plus/path.js");
const transfer = require("../plugins/shape-plus/path-transfer.js");
const valuesAt = (item, frame) => animation.channels(item).map(c => adapter.sample(c, frame));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("native values preserve split curves, deletion, reversal, and affine transfer between keys", () => {
  for (const tween of [1, 4, 7]) {
    const initial = fixture(tween), h = { data: initial, commit(value) { this.data = value; } };
    topology.apply(h, { kind: "insert", index: 0, t: 0.4, id: "c" }, adapter);
    const inserted = h.data;
    for (let frame = 0; frame <= 20; frame += 0.5) {
      const originalCurve = curve.verticesToCubics(geometry.vertices(valuesAt(initial, frame)), false)[0];
      const splitCurves = curve.verticesToCubics(geometry.vertices(valuesAt(inserted, frame)), false);
      for (const t of [0, 0.2, 0.4, 0.7, 1]) {
        const result = t <= 0.4 ? curve.evaluate(splitCurves[0], t / 0.4) : curve.evaluate(splitCurves[1], (t - 0.4) / 0.6);
        curve.evaluate(originalCurve, t).forEach((v, i) => close(v, result[i]));
      }
    }
    topology.apply(h, { kind: "delete", ids: ["c"] }, adapter);
    const deleted = h.data;
    topology.apply(h, { kind: "first", id: "b" }, adapter);
    const reversed = h.data;
    let next = 0;
    const pasted = transfer.materialize(transfer.copyPath(deleted), [2, 1, -1, 3, 5, 7], () => `new${++next}`, [], adapter);
    for (let frame = 0; frame <= 20; frame += 0.5) {
      const a = valuesAt(deleted, frame), b = valuesAt(reversed, frame), c = valuesAt(pasted, frame);
      [6, 7, 10, 11, 8, 9, 0, 1, 4, 5, 2, 3].forEach((index, i) => close(a[index], b[i]));
      for (let i = 0; i < a.length; i += 2) {
        close(c[i], 2 * a[i] - a[i + 1] + (i % 6 === 0 ? 5 : 0));
        close(c[i + 1], a[i] + 3 * a[i + 1] + (i % 6 === 0 ? 7 : 0));
      }
    }
  }
});
