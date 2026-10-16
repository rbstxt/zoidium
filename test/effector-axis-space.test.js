"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../plugins/scene-plus/effector-core.js");

// Text glyphs and repeater instances may occupy separate translated meshes.
// Every vertex must rotate around the effector origin in the same frame.
test("Twist uses the effector pivot for translated components on every axis", () => {
  for (let axis = 0; axis < 3; axis++) {
    const first = (axis + 1) % 3, second = (axis + 2) % 3;
    const bounds = { min: [-10, -10, -10], max: [10, 10, 10] };
    const point = [3, 4, 5];
    const positions = new Float32Array(point);
    const theta = Math.PI * point[axis] / 20;
    core.twistPositions(positions, Math.PI, axis, 0, null, bounds);
    assert.equal(positions[axis], point[axis]);
    assert.ok(Math.abs(positions[first] - (point[first] * Math.cos(theta) - point[second] * Math.sin(theta))) < 1e-6);
    assert.ok(Math.abs(positions[second] - (point[first] * Math.sin(theta) + point[second] * Math.cos(theta))) < 1e-6);
  }
});

test("Twist and Warp remain independent of translated mesh partitioning", () => {
  const positions = new Float32Array([-12, -4, -3, -10, 2, 5, 8, -2, -1, 14, 6, 7]);
  const bounds = core.boundsOf(positions);
  for (const [deform, axes] of [[core.twistPositions, 3], [core.warpPositions, 2]]) {
    for (let axis = 0; axis < axes; axis++) {
      const whole = deform(positions.slice(), 1.2, axis, 2, null, bounds);
      const pieces = [positions.slice(0, 6), positions.slice(6)];
      for (const piece of pieces) deform(piece, 1.2, axis, 2, null, bounds);
      assert.deepEqual(new Float32Array([...pieces[0], ...pieces[1]]), whole);
    }
  }
});
