"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const curves = require("../plugins/material-plus/graph-curves.js");
const math = require("../plugins/shader-plus/curve-math.js");
const bake = require("../plugins/shader-plus/bake.js");
const legacy = require("./fixtures/shader-fix-a-legacy-bake.cjs");
let seed = 1893;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
test("1000 saved curves including crossed handles retain byte-identical integer and float bakes", () => {
  for (let i = 0; i < 1000; i++) {
    const points = Array.from({ length: 4 }, (_, j) => [j / 3, random(), null, { in: [random(), random()], out: [random(), random()] }]);
    const value = JSON.stringify({ [i % 2 ? "points" : "composite"]: points, red: points, green: points, blue: points, alpha: points, range: [-2, 100], channels: i % 3 ? "single" : "rgba" });
    for (const half of [false, true]) assert.deepEqual(bake.bakeCurve(value, curves, half), legacy.bakeCurve(value, curves, half), String(i));
  }
});
test("edited incoming handle can cross the opposing tip and remains inside its own segment", () => {
  const points = [[0, 0], [.2, .3, null, { out: [.7, .6] }], [.8, .7, null, { in: [.6, .4] }], [1, 1]];
  const original = JSON.stringify(points);
  assert.equal(math.segmentHandles(points, 1)[1][0], .7, "saved JSON retains historical sample");
  math.moveHandle(points, 2, "in", [.3, .1]);
  assert.equal(math.segmentHandles(points, 1)[1][0], .3);
  assert.equal(points[1][3].out[0], .7, "the opposite handle stays fixed");
  assert.equal(math.pointsWithHandles(points, curves)[2][3].inIndependent, true);
  const sample = math.createGraphSampler(points, curves);
  for (let i = 0; i <= 1000; i++) assert.ok(Number.isFinite(sample(i / 1000)));
  math.moveHandle(points, 2, "in", [-1, 2]);
  assert.deepEqual(points[2][3].in, [.2, 1]);
  assert.notEqual(JSON.stringify(points), original);
});
test("new RGBA handle edits survive parsing, affect their channel, and retain the other channels", () => {
  const points = [[0, 0], [1, 1]];
  const before = JSON.stringify({ points, red: points, channels: "rgba" });
  const red = structuredClone(points); math.moveHandle(red, 1, "in", [.1, 1]);
  const after = JSON.stringify({ points, red, channels: "rgba" });
  const a = bake.bakeCurve(before, curves), b = bake.bakeCurve(after, curves);
  assert.notEqual(a[512 * 4], b[512 * 4]);
  for (let i = 0; i < a.length; i++) if (i % 4 !== 0) assert.equal(a[i], b[i]);
  assert.deepEqual(bake.parseCurve(after, curves).red, red);
});
