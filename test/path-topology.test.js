"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const topology = require("../plugins/shape-plus/path-topology.js");
const animation = require("../plugins/shape-plus/path-animation.js");
const geometry = require("../plugins/shape-plus/editor-geometry.js");
const path = require("../plugins/shape-plus/path.js");
const clone = (v) => JSON.parse(JSON.stringify(v));
function fixture(closed = true) {
  const values = [0, 0, -1, 1, 2, 3, 8, 2, -2, 1, 3, -1, 12, 6, -1, -2, 1, 1];
  return { vertexIds: ["a", "b", "c"], vertexModes: { a: "corner", b: "smooth", c: "corner" },
    properties: { closed, path: { objects: values.map((v, i) => ({ animated: true, keyframes: [
      { frame: 0, value: v, tween: "linear", tag: i },
      { frame: i === 0 ? 5 : 10, value: v + (i === 0 ? 2 : (i % 3) - 1), tween: "linear", tag: i },
      ...(i === 0 ? [{ frame: 10, value: v + 4, tween: "linear", tag: i }] : []),
    ] })) } } };
}
const adapter = {
  sample(channel, frame) {
    const keys = channel.keyframes;
    if (!channel.animated || frame <= keys[0].frame) return keys[0].value;
    const index = keys.findIndex((k) => k.frame >= frame);
    if (index < 0) return keys.at(-1).value;
    const a = keys[index - 1], b = keys[index];
    return a.value + (b.value - a.value) * (frame - a.frame) / (b.frame - a.frame);
  },
  makeKey(channel, frame, value) { return { frame, value, tween: "linear", added: true }; },
  certify({ before, after }) {
    return [...before, ...after].every((c) => c.animated && c.keyframes.every((k) => k.tween === "linear"));
  },
};
function host(data) { return { data, history: [], commit(next) { this.history.push(this.data); this.data = next; } }; }
function curves(item, frame) {
  const values = animation.channels(item).map((c) => adapter.sample(c, frame));
  return path.verticesToCubics(geometry.vertices(values), item.properties.closed);
}
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); }
function sameCurve(a, b, split) {
  for (const t of [0, 0.13, 0.4, 0.71, 1]) {
    const p = path.evaluate(a, t), q = t <= split ? path.evaluate(b[0], t / split) : path.evaluate(b[1], (t - split) / (1 - split));
    p.forEach((v, i) => near(v, q[i]));
  }
}
test("insertion synchronizes keys and preserves split curves at and between keys", () => {
  const original = fixture(), h = host(clone(original));
  assert.equal(topology.apply(h, { kind: "insert", index: 2, t: 0.4, id: "d" }, adapter), true);
  assert.deepEqual(h.data.vertexIds, ["a", "b", "c", "d"]);
  assert.equal(h.history.length, 1);
  for (const frame of [0, 2.5, 5, 7.5, 10]) {
    const before = curves(original, frame), after = curves(h.data, frame);
    sameCurve(before[2], [after[2], after[3]], 0.4);
    for (const i of [0, 1]) for (const t of [0, 0.3, 1]) path.evaluate(before[i], t).forEach((v, j) => near(v, path.evaluate(after[i], t)[j]));
  }
  const old = animation.channels(original), result = animation.channels(h.data);
  old.forEach((c, i) => c.keyframes.forEach((key) => {
    const newKey = result[i].keyframes.find((k) => k.frame === key.frame);
    assert.equal(newKey.tween, key.tween); assert.equal(newKey.tag, key.tag);
  }));
  result.forEach((c) => assert.deepEqual(c.keyframes.map((k) => k.frame), [0, 5, 10]));
});
test("append and deletion retain other channel samples and stable IDs", () => {
  const original = fixture(false), h = host(clone(original));
  topology.apply(h, { kind: "append", id: "d", point: [20, 30] }, adapter);
  for (const f of [0, 2, 5, 8, 10]) {
    const before = curves(original, f), after = curves(h.data, f);
    before.forEach((c, i) => assert.deepEqual(c, after[i]));
    assert.deepEqual(geometry.vertices(animation.channels(h.data).map((c) => adapter.sample(c, f)))[3].point, [20, 30]);
  }
  const appended = clone(h.data);
  topology.apply(h, { kind: "delete", ids: ["b"] }, adapter);
  assert.deepEqual(h.data.vertexIds, ["a", "c", "d"]);
  assert.equal(h.data.vertexModes.b, undefined);
  for (const f of [0, 2, 5, 8, 10]) {
    const a = animation.channels(appended).map((c) => adapter.sample(c, f));
    const b = animation.channels(h.data).map((c) => adapter.sample(c, f));
    assert.deepEqual(b, [...a.slice(0, 6), ...a.slice(12)]);
  }
});
test("closed rotation and open reversal preserve curves and tween blocks", () => {
  for (const closed of [true, false]) {
    const original = fixture(closed), h = host(clone(original));
    topology.apply(h, { kind: "first", id: "c" }, adapter);
    assert.deepEqual(h.data.vertexIds, closed ? ["c", "a", "b"] : ["c", "b", "a"]);
    for (const f of [0, 2.5, 5, 7.5, 10]) {
      const a = curves(original, f), b = curves(h.data, f);
      for (let i = 0; i < a.length; i++) for (const t of [0, 0.3, 1]) {
        const other = closed ? b[(i + 1) % 3] : b[a.length - i - 1];
        path.evaluate(a[i], t).forEach((v, j) => near(v, path.evaluate(other, closed ? t : 1 - t)[j]));
      }
    }
    const old = animation.channels(original), now = animation.channels(h.data);
    assert.equal(now[0].keyframes[0].tag, old[12].keyframes[0].tag);
    assert.equal(now[2].keyframes[0].tag, old[closed ? 14 : 16].keyframes[0].tag);
  }
});
test("rejects unsupported, expression-driven, invalid and interior open operations atomically", () => {
  for (const mutate of [
    (d) => { d.properties.path.expression = "x"; },
    (d) => { d.properties.path.objects[0].expression = "x"; },
    (d) => { d.properties.path.objects[0].keyframes[0].tween = "unsupported"; },
  ]) {
    const h = host(fixture(false)); mutate(h.data); const before = clone(h.data);
    assert.throws(() => topology.apply(h, { kind: "insert", index: 0, t: 0.5, id: "d" }, adapter));
    assert.deepEqual(h.data, before); assert.equal(h.history.length, 0);
  }
  const h = host(fixture(false));
  h.data.properties.closed = "0";
  assert.throws(() => topology.apply(h, { kind: "first", id: "b" }, adapter), /endpoint/i);
  assert.throws(() => topology.apply(h, { kind: "insert", index: 0, t: 0.5, id: "a" }, adapter), /ID/i);
  assert.throws(() => topology.apply(h, { kind: "delete", ids: ["a", "b", "c"] }, adapter));
  assert.throws(() => topology.apply(h, { kind: "append", id: "d", point: [0, 0] }, {}), /preserv/i);
  assert.equal(topology.apply(h, { kind: "first", id: "a" }, adapter), false);
  assert.equal(h.history.length, 0);
});
test("grouped keys are split without changing original metadata or input", () => {
  const data = fixture(false), channels = data.properties.path.objects;
  const values = channels.map((c) => c.keyframes[0].value);
  data.properties.path = { animated: true, keyframes: [
    { frame: 0, value: values, tween: "linear", extra: "keep" },
    { frame: 10, value: values.map((v) => v + 2), tween: "linear", extra: "keep" },
  ] };
  const original = clone(data), h = host(data);
  topology.apply(h, { kind: "insert", index: 0, t: 0.25, id: "d" }, adapter);
  assert.deepEqual(data, original);
  assert.equal(h.data.properties.path.keyframes, undefined);
  assert.equal(h.data.properties.path.objects[0].keyframes[0].extra, "keep");
  for (const f of [0, 2.5, 10]) sameCurve(curves(original, f)[0], curves(h.data, f).slice(0, 2), 0.25);
});
test("failed native certification and invalid keys never commit", () => {
  for (const phase of ["synchronize", "topology"]) {
    const h = host(fixture()), before = clone(h.data);
    assert.throws(() => topology.apply(h, { kind: "append", id: "d", point: [1, 2] }, {
      ...adapter, certify(context) { return context.phase !== phase; },
    }), /preservation/);
    assert.deepEqual(h.data, before); assert.equal(h.history.length, 0);
  }
  const h = host(fixture());
  h.data.properties.path.objects[0].keyframes.push(clone(h.data.properties.path.objects[0].keyframes[0]));
  assert.throws(() => topology.apply(h, { kind: "delete", ids: ["a"] }, adapter), /keyframes/);
  assert.equal(h.history.length, 0);
});
