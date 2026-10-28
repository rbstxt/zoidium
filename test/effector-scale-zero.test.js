"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const core = require("../plugins/scene-plus/effector-core.js");
const { buildVoronoiFracture, applyFragmentMotion } = require("../plugins/scene-plus/effector-fracture.js");

function stage() {
  const geometry = new THREE.BoxBufferGeometry(8, 6, 4).toNonIndexed();
  return buildVoronoiFracture({ positions: geometry.attributes.position.array }, { cells: 12, seed: 5, closed: true });
}

test("zero fragment scale collapses every outer and cap vertex despite randomness and a following Twist", () => {
  const source = stage();
  assert.ok(source.capTriangleCount > 0);
  assert.equal(source.pieceIds.length, source.positions.length / 3);
  for (const randomness of [0, 50, 100]) {
    const positions = applyFragmentMotion(new Float32Array(source.positions), source,
      { fragmentScale: 0, randomness, offset: 30, spin: 2, distance: 4 });
    core.twistPositions(positions, 1.2, 1, 0);
    const points = new Map();
    for (let vertex = 0; vertex < source.pieceIds.length; vertex++) {
      const id = source.pieceIds[vertex];
      assert.ok(id < source.cells);
      const point = Array.from(positions.subarray(vertex * 3, vertex * 3 + 3));
      if (points.has(id)) assert.deepEqual(point, points.get(id));
      else points.set(id, point);
    }
  }
});

test("fragment scale follows field strength while zero-weight pieces stay unchanged", () => {
  const source = stage();
  const field = { prepared: true, type: 3, position: [2, 0, 0], scale: [6, 6, 6], worldScale: [10, 10, 10], falloff: 50, sweep: 100 };
  const prepared = core.prepareField(field, source.positions);
  const output = applyFragmentMotion(new Float32Array(source.positions), source, { fragmentScale: 0, randomness: 100, field });
  let outside = 0, inside = 0, partial = 0;
  for (let vertex = 0; vertex < source.pieceIds.length; vertex++) {
    const id = source.pieceIds[vertex], center = Array.from(source.pieceCentroids.subarray(id * 3, id * 3 + 3));
    const weight = core.evaluateField(...center, prepared);
    if (!weight) outside++;
    else if (weight === 1) inside++;
    else partial++;
    for (let axis = 0; axis < 3; axis++) {
      const i = vertex * 3 + axis;
      assert.equal(output[i], Math.fround(center[axis] + (source.positions[i] - center[axis]) * (1 - weight)));
    }
  }
  assert.ok(outside > 0 && inside > 0 && partial > 0);
});
