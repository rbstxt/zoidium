"use strict";
// Motion path curve math: exact key insertion, spatial handle mapping and the
// edit planners (plugins/motion-path/curves.js and path-edit.js).
const assert = require("node:assert/strict");
const test = require("node:test");
const c = require("../plugins/motion-path/curves.js");
const e = require("../plugins/motion-path/path-edit.js");

// Index 0 hold, 1 linear, 2 quadratic in: the same layout as CM3's list.
const easings = [null, s => s, s => s * s];
const key = (frame, value, tween = 1, controlPoints = [[-10, 0], [10, 0]], continuousTangent = true) =>
  ({ frame, value, tween, controlPoints: controlPoints.map(p => p.slice()), continuousTangent });
const sample = (keys, from, to, step = 0.5) => {
  const out = [];
  for (let f = from; f <= to; f += step) out.push(c.evaluate(keys, f, easings));
  return out;
};
const close = (a, b, eps = 1e-7) => {
  assert.equal(a.length, b.length);
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= eps, `index ${i}: ${x} vs ${b[i]}`));
};

test("evaluate follows CM3 tween semantics", () => {
  const keys = [key(0, 0), key(10, 100, 1), key(20, 0, 0), key(30, 50, 2)];
  assert.equal(c.evaluate(keys, -5, easings), 0);
  assert.equal(c.evaluate(keys, 5, easings), 50);
  assert.equal(c.evaluate(keys, 15, easings), 100, "hold keeps the left value");
  assert.equal(c.evaluate(keys, 25, easings), 0 + 50 * 0.25, "quadratic in");
  assert.equal(c.evaluate(keys, 40, easings), 50);
  const bez = [key(0, 0, 1, [[-10, 0], [5, 40]]), key(20, 100, 257, [[-5, 0], [10, 0]])];
  assert.equal(c.evaluate(bez, 0, easings), 0);
  assert.ok(Math.abs(c.evaluate(bez, 20, easings) - 100) < 1e-9);
  assert.ok(c.evaluate(bez, 5, easings) > 25, "ease-out bezier leads the linear value");
});

test("correction matches PZ.tween.correctCurve", () => {
  assert.equal(c.correction(key(0, 0, 1, [[-1, 0], [10, 0]]), key(10, 0, 257, [[-10, 0], [1, 0]])), 0.5);
  assert.equal(c.correction(key(0, 0, 1, [[-1, 0], [3, 0]]), key(10, 0, 257, [[-3, 0], [1, 0]])), 1);
});

test("insertKey keeps every channel value (bezier, linear, hold, outside)", () => {
  const keys = [
    key(0, 0, 1, [[-10, 0], [12, 80]]),
    key(24, 100, 257, [[-6, -30], [8, 0]]),
    key(40, -20, 1),
    key(60, 70, 0),
  ];
  const before = sample(keys, -10, 80);
  for (const frame of [-6, 3, 11.5, 23, 30, 47, 59, 75]) {
    const next = c.insertKey(keys, frame, easings);
    assert.equal(next.length, keys.length + 1);
    assert.ok(c.keyIndex(next, frame) >= 0);
    close(sample(next, -10, 80), before, 1e-6);
  }
  // Repeated splits inside one bezier segment remain exact.
  close(sample(c.insertKeys(keys, [6, 12, 18, 3], easings), -10, 80), before, 1e-6);
  assert.equal(c.insertKey(keys, 24, easings), keys, "existing key: unchanged input");
  assert.equal(keys.length, 4, "input not mutated");
});

test("handle components map to corrected value offsets", () => {
  const keys = [key(0, 0, 1, [[-10, 0], [20, 60]]), key(30, 90, 257, [[-20, -10], [10, 0]])];
  // correction = 30 / 40
  assert.deepEqual(c.handleComponent(keys, 0, 1, easings), { kind: "bezier", value: 60 * 0.75 });
  assert.deepEqual(c.handleComponent(keys, 1, 0, easings), { kind: "bezier", value: -10 * 0.75 });
  assert.equal(c.handleComponent(keys, 0, 0, easings), null, "no incoming segment");
  const lin = [key(0, 0), key(30, 90)];
  // Stored offsets point the right way (+-10): the straight-line equivalent.
  assert.deepEqual(c.handleComponent(lin, 0, 1, easings), { kind: "linear", value: 30 });
  assert.deepEqual(c.handleComponent(lin, 1, 0, easings), { kind: "linear", value: -30 });
});

test("bezier conversion keeps the values until a handle moves", () => {
  const keys = [key(0, 10), key(30, 100), key(45, 40)];
  const before = sample(keys, 0, 45);
  const next = c.cloneKeys(keys);
  assert.ok(c.convertToBezier(next, 1, 0, easings));
  assert.equal(next[1].tween, 257);
  close(sample(next, 0, 45), before, 1e-6);
  assert.equal(c.convertToBezier(next, 1, 0, easings), false, "already bezier");
});

test("setHandle edits value offsets only and mirrors by slope", () => {
  const channel = { animated: true, editable: true, keys: [
    key(0, 0, 1, [[-10, 0], [10, 0]]),
    key(20, 100, 257, [[-5, 0], [10, 0]]),
    key(40, 0, 257, [[-10, 0], [10, 0]]),
  ] };
  const [keys] = e.setHandle([channel], 20, 1, [30], { easings });
  assert.deepEqual(keys[1].controlPoints, [[-5, -15], [10, 30]], "time untouched, in mirrored by slope");
  assert.equal(channel.keys[1].controlPoints[1][1], 0, "input not mutated");
  const [broken] = e.setHandle([channel], 20, 1, [30], { breakTangent: true, easings });
  assert.deepEqual(broken[1].controlPoints, [[-5, 0], [10, 30]]);
  assert.equal(broken[1].continuousTangent, false);
  // Correction scales the stored offset: 20 frames / (15 + 10) = 0.8.
  const tight = { animated: true, editable: true, keys: [key(0, 0, 1, [[-1, 0], [15, 0]]), key(20, 10, 257, [[-10, 0], [1, 0]])] };
  const [t] = e.setHandle([tight], 0, 1, [8], { easings });
  assert.equal(t[0].controlPoints[1][1], 10);
  assert.equal(c.handleComponent(t, 0, 1, easings).value, 8);
});

test("setHandle converts a linear segment on touched axes only", () => {
  const x = { animated: true, editable: true, keys: [key(0, 0), key(30, 90)] };
  const y = { animated: true, editable: true, keys: [key(0, 0), key(30, 30)] };
  const [kx, ky] = e.setHandle([x, y], 0, 1, [50, null], { easings });
  assert.equal(kx[1].tween, 257);
  assert.equal(c.handleComponent(kx, 0, 1, easings).value, 50);
  assert.equal(ky, null, "untouched axis keeps its linear segment");
});

test("moveKeys, constrain and materialize", () => {
  const x = { animated: true, editable: true, keys: [key(0, 0), key(30, 90)] };
  const y = { animated: false, editable: true, keys: [key(0, 5)] };
  assert.deepEqual(e.pathFrames([x, y]), [0, 30]);
  assert.deepEqual(e.materialFrames([0, 10, 30], [10]), [0, 10, 30]);
  const my = e.materialize(y, [0, 30], easings);
  assert.deepEqual(my.map(k => [k.frame, k.value]), [[0, 5], [30, 5]]);
  assert.equal(e.materialize(x, [0, 30], easings), null, "keys already present");
  assert.deepEqual(e.constrain([3, -7], true), [0, -7]);
  assert.deepEqual(e.constrain([3, -7], false), [3, -7]);
  const [mx, mz] = e.moveKeys([x, { ...y, keys: my }], [30], [10, 0]);
  assert.equal(mx[1].value, 100);
  assert.equal(mz, null);
});

test("toggleKey switches linear and smooth bezier", () => {
  const x = { animated: true, editable: true, keys: [key(0, 0), key(10, 50), key(30, 50)] };
  const [b] = e.toggleKey([x], 10, easings);
  assert.equal(b[1].tween, 257);
  assert.equal(b[2].tween, 257);
  const slope = 50 / 30;
  assert.ok(Math.abs(b[1].controlPoints[0][1] - slope * -10) < 1e-12);
  assert.ok(Math.abs(b[1].controlPoints[1][1] - slope * 10) < 1e-12);
  const [l] = e.toggleKey([{ ...x, keys: b }], 10, easings);
  assert.equal(l[1].tween, 1);
  assert.equal(l[2].tween, 1);
});

test("diff lists created keys and changed fields", () => {
  const live = [key(0, 0), key(30, 90)];
  const planned = c.insertKey(live, 15, easings);
  planned[0].value = 4;
  const d = e.diff(live, planned);
  assert.deepEqual(d.create.map(k => k.frame), [15]);
  assert.deepEqual(d.change, [{ frame: 0, fields: { value: 4 } }]);
});
