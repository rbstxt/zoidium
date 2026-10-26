"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const topology = require("../plugins/shape-plus/topology.js");
const budget = require("../plugins/shape-plus/geometry-budget.js");
const C = require("../plugins/shape-plus/vendor/clipper.js");
const square = (x = 0) => ({ closed: true, points: [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]] });
const bowTie = { closed: true, points: [[0, 0], [10, 10], [0, 10], [10, 0]] };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test("clipping keeps hot method identities across success and budget failure", () => {
  const hooks = [
    ...["BuildIntersectList", "FixupOutPolygon", "DoSimplePolygons", "JoinCommonEdges", "ProcessEdgesAtTopOfScanbeam",
      "Poly2ContainsPoly1", "UpdateOutPtIdxs", "GetBottomPt", "Area", "IntersectEdges"].map(name => [C.Clipper.prototype, name]),
    [C.IntPoint, "op_Equality"], [C.Clipper, "TopX"],
  ].map(([owner, name]) => ({ owner, name, method: owner[name] }));
  const stable = () => hooks.forEach(({ owner, name, method }) => assert.equal(owner[name], method, name));
  topology.merge([square(), square(5)], { mode: "intersect" });
  stable();
  topology.offset([square()], { amount: 1, join: "round" });
  stable();
  topology.strokeRegion([{ closed: false, points: [[0, 0], [10, 0]] }], { width: 2, cap: "round" });
  stable();
  topology.tessellate([bowTie]);
  stable();
  assert.throws(() => budget.bounded(() => topology.tessellate([square()]), 0), /ProcessIntersections error/);
  stable();
  assert.ok(topology.tessellate([bowTie]).length);
});

test("stable hooks retain deterministic charges and budget boundaries", () => {
  // Charges from the per-operation hooks before they became stable.
  const cases = [
    [12.06, () => topology.merge([square(), square(5)], { mode: "add" })],
    [15.04, () => topology.merge([square(), square(5)], { mode: "intersect" })],
    [13.04, () => topology.offset([square()], { amount: 1, join: "miter" })],
    [7.02, () => topology.tessellate([square()])],
    [12.135, () => topology.merge([bowTie], { mode: "add" })],
  ];
  for (const [units, work] of cases) {
    for (let i = 0; i < 3; i++) {
      const before = budget.used();
      work();
      near(budget.used() - before, units);
    }
    assert.throws(() => budget.bounded(work, (units - .001) / budget.UNITS_PER_MS), /work budget exceeded/);
    assert.doesNotThrow(() => budget.bounded(work, (units + .001) / budget.UNITS_PER_MS));
  }
});

test("failed clipping leaves vendor operations outside the budget scope", () => {
  assert.throws(() => budget.bounded(() => topology.merge([square()], { mode: "add" }), 0), /ProcessIntersections error/);
  const engine = new C.Clipper(C.Clipper.ioStrictlySimple), output = [];
  const before = budget.used();
  assert.doesNotThrow(() => budget.bounded(() => {
    engine.AddPaths(topology.integerPaths([square()]), C.PolyType.ptSubject, true);
    assert.equal(engine.Execute(C.ClipType.ctUnion, output, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero), true);
    C.Clipper.CleanPolygons(output, 1);
  }, 0));
  assert.equal(budget.used(), before);
  assert.equal(output.length, 1);
  const start = budget.used();
  topology.merge([square(), square(5)], { mode: "add" });
  near(budget.used() - start, 12.06);
});
