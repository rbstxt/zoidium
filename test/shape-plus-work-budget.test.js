"use strict";
// Geometry budgets count work, never wall-clock time: a slow or busy machine
// must take the same tessellation path as a fast one.
const test = require("node:test"),
  assert = require("node:assert/strict");
const g = require("../plugins/shape-plus/editor-geometry.js");
const { compile } = require("../plugins/shape-plus/compiler.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { PZ } = require("./shape-plus-host.js");
const budget = require("../plugins/shape-plus/geometry-budget.js");
const { Content } = createModel(PZ);
const channel = (value) => ({ animated: false, keyframes: [{ frame: 0, value, tween: 1 }] });
function freehand(count) {
  const vertices = Array.from({ length: count }, (_, i) => {
    const t = (i / (count - 1)) * Math.PI * 2.3, r = 380 + 40 * Math.sin(5 * t);
    const d = [-r * 1.6 * Math.sin(t) * 0.05, r * 0.8 * Math.cos(t) * 0.05];
    return { point: [r * 1.6 * Math.cos(t), r * 0.8 * Math.sin(t)], in: [-d[0], -d[1]], out: d };
  });
  return { id: "p", kind: "path", vertexIds: vertices.map((_, i) => "v" + i), vertexModes: {},
    properties: { closed: 0, path: { objects: g.values(vertices).map(channel) } } };
}
function contents(stroke, extra) {
  return [freehand(24), ...(extra ? [{ kind: extra, id: "x", properties: {} }] : []),
    { kind: "stroke", id: "s", properties: Object.fromEntries(Object.entries(stroke).map(([k, v]) => [k, channel(v)])) }]
    .map((data) => { const item = new Content(data.kind, data); item.load(data); return item.evaluate(0); });
}
const signature = (result) => JSON.stringify(result.commands.map((command) => [command.kind, command.positions?.length, command.coverage?.length]));
test("tessellation does not depend on the clock", () => {
  const cases = [
    [{ width: 30, cap: "round", join: "round" }],
    [{ width: 30, cap: "round", join: "round", dashPairs: 1, dash1: 20, gap1: 10 }],
    [{ width: 30, waveAmount: 11, waveUnits: "length", wavelength: 100 }, "wigglePaths"],
    [{ width: 8, cap: "square", join: "miter" }, "zigZag"],
  ];
  const now = performance.now;
  for (const [stroke, extra] of cases) {
    const fast = signature(compile(contents(stroke, extra), 0.125 / 4));
    let clock = 0;
    // A clock that jumps a full second per call: any wall-clock budget would trip.
    performance.now = () => (clock += 1000);
    try {
      assert.equal(signature(compile(contents(stroke, extra), 0.125 / 4)), fast);
    } finally {
      performance.now = now;
    }
  }
});
test("work budgets nest and restore", () => {
  const before = budget.used();
  assert.throws(() => budget.bounded(() => { for (;;) budget.check(); }, 1), /work budget exceeded/);
  assert.ok(budget.used() - before >= budget.UNITS_PER_MS);
  assert.equal(budget.bounded(() => budget.bounded(() => 7, 1), 5), 7);
  budget.check(10);
});
