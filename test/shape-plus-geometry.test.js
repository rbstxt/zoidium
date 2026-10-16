"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("../plugins/shape-plus/path");
const { triangulate, area } = require("../plugins/shape-plus/fill");
const { stroke } = require("../plugins/shape-plus/stroke");
const { compile } = require("../plugins/shape-plus/compiler");
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
function triangleArea(positions) {
  let result = 0;
  for (let i = 0; i < positions.length; i += 9) result += Math.abs(area([positions.slice(i, i + 2), positions.slice(i + 3, i + 5), positions.slice(i + 6, i + 8)]));
  return result;
}
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
test("cubic evaluation, derivatives and exact De Casteljau split", () => {
  const c = [[0, 0], [20, 90], [-40, 15], [10, -5]], t = .37, halves = path.split(c, t);
  assert.deepEqual(path.evaluate(c, 0), c[0]); assert.deepEqual(path.evaluate(c, 1), c[3]);
  assert.deepEqual(path.derivative(c, 0), [60, 270]);
  for (let i = 0; i <= 100; i++) {
    const u = i / 100, a = path.evaluate(c, u), b = u < t ? path.evaluate(halves[0], u / t) : path.evaluate(halves[1], (u - t) / (1 - t));
    near(a[0], b[0]); near(a[1], b[1]);
  }
});
test("flattening bounds loops and collinear reversals independently of frame history", () => {
  for (const c of [[[0, 0], [200, 0], [-100, 0], [10, 0]], [[0, 0], [200, 300], [-200, 300], [0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]]]) {
    const flattened = path.flatten(c, .1);
    for (let i = 0; i <= 1000; i++) {
      const p = path.evaluate(c, i / 1000);
      assert.ok(Math.min(...flattened.slice(1).map((q, j) => path.segmentDistance(p, flattened[j], q))) <= .1000001);
    }
    assert.deepEqual(path.flatten(c, .1), flattened);
  }
  assert.throws(() => path.flatten([[0, 0], [1, 10], [10, -10], [1, 0]], .0001, 2), /budget/);
  assert.throws(() => path.flatten([[0, 0], [0, 0], [1, 0], [1, 0]], .1, 1), /budget/);
  assert.equal(path.lengthTable([[0, 0], [3, 0], [3, 4]]).total, 7);
});
test("fill area oracles, holes, winding and self crossing resolution", () => {
  const outer = rect(0, 0, 10, 10), inner = rect(3, 3, 4, 4);
  near(triangleArea(triangulate([outer])), 100);
  near(triangleArea(triangulate([outer, inner.slice().reverse()])), 84);
  near(triangleArea(triangulate([outer, inner])), 100);
  near(triangleArea(triangulate([outer, inner], "even-odd")), 84);
  near(triangleArea(triangulate([[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]])), 7);
  near(triangleArea(triangulate([[[0, 0], [10, 10], [0, 10], [10, 0]]])), 50);
  near(triangleArea(triangulate([outer, outer])), 100);
  near(triangleArea(triangulate([outer, outer], "even-odd")), 0);
  assert.deepEqual(outer, rect(0, 0, 10, 10));
});
test("stroke cap areas and disjoint union of translucent crossing segments", () => {
  const line = [{ points: [[0, 0], [10, 0]], closed: false }];
  const style = { width: 2, cap: "butt", join: "miter", miterLimit: 4 };
  near(triangleArea(stroke(line, style)), 20);
  near(triangleArea(stroke(line, { ...style, cap: "square" })), 24);
  near(triangleArea(stroke(line, { ...style, cap: "round" }, .0001)), 20 + Math.PI, .001);
  const cross = [...line, { points: [[5, -5], [5, 5]], closed: false }];
  near(triangleArea(stroke(cross, style)), 36);
  const corner = [{ points: [[0, 0], [10, 0], [10, 10]], closed: false }];
  near(triangleArea(stroke(corner, style)), 40);
  near(triangleArea(stroke(corner, { ...style, join: "bevel" })), 39.5);
  near(triangleArea(stroke(corner, { ...style, join: "round" }, .0001)), 39 + Math.PI / 4, .001);
  near(triangleArea(stroke(corner, { ...style, miterLimit: 1 })), 39.5);
});
const rectangle = (id, position = [0, 0]) => ({ id, kind: "rectangle", properties: { enabled: 1, size: [10, 10], position, roundness: 0 } });
const paint = (id, kind = "fill") => ({ id, kind, properties: { enabled: 1, color: [1, 0, 0], opacity: .5, fillRule: "nonzero", width: 2, cap: "butt", join: "miter", miterLimit: 4 } });
test("compiler scopes nested paths above paints and schedules paints bottom to top", () => {
  const input = [rectangle("a"), paint("red"), { id: "g", kind: "group", properties: { enabled: 1, position: [20, 0], scale: [2, 1], rotation: 0, opacity: .5 }, contents: [rectangle("b"), paint("blue")] }, paint("outline", "stroke"), rectangle("below")];
  const before = JSON.stringify(input), result = compile(input);
  assert.deepEqual(result.commands.map(c => c.id), ["outline", "g", "red"]);
  assert.deepEqual(result.commands[1].commands.map(c => c.id), ["blue"]);
  near(triangleArea(result.commands[2].positions), 100);
  assert.equal(result.paths.length, 3);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(compile(input), result);
});
module.exports = { triangleArea };
