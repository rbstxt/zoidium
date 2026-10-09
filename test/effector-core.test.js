"use strict";

// Pure math for Effector deformers: twist and warp evaluation, field weights,
// deformer-frame transforms, deterministic hashing, and subdivision.

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../plugins/scene-plus/effector-core.js");

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function translation(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function scale(x, y, z) {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

function closeTo(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`
  );
}

test("twist rotates about the axis pivot and keeps the axis coordinate", () => {
  const positions = new Float32Array([1, -1, 0, 1, 1, 0]);
  core.twistPositions(positions, Math.PI / 2, 1, 0);
  closeTo(positions[0], Math.SQRT1_2, 1e-6);
  closeTo(positions[2], Math.SQRT1_2, 1e-6);
  closeTo(positions[3], Math.SQRT1_2, 1e-6);
  closeTo(positions[5], -Math.SQRT1_2, 1e-6);
  assert.equal(positions[1], -1);
  assert.equal(positions[4], 1);
});

test("twist is an identity for zero angle, zero extent, and non-finite input", () => {
  const flat = new Float32Array([0, 1, 0, 0, 1, 2]);
  const before = Array.from(flat);
  core.twistPositions(flat, 0, 1, 0);
  assert.deepEqual(Array.from(flat), before);
  core.twistPositions(flat, Math.PI, 0, 0);
  assert.deepEqual(Array.from(flat), before, "zero X extent must not rotate");
  core.twistPositions(flat, Number.NaN, 1, 0);
  assert.deepEqual(Array.from(flat), before);
});

test("twist output is continuous in the angle (no jitter between nearby values)", () => {
  const base = new Float32Array([1, -1, 0.5, -1, 1, -0.5, 0.2, 0.3, 0.9]);
  let previous = null;
  for (let step = 0; step <= 200; step += 1) {
    const angle = (step / 200) * Math.PI;
    const out = core.twistPositions(new Float32Array(base), angle, 1, 0);
    if (previous) {
      for (let index = 0; index < out.length; index += 1) {
        assert.ok(Math.abs(out[index] - previous[index]) < 0.05, `jump at step ${step}`);
      }
    }
    previous = out;
  }
});

test("twist offset moves the pivot: a vertex at the offset pivot is not rotated", () => {
  // Extent along Y is [0, 2], so the centre is 1. An offset of 1 moves the
  // pivot to 2. A vertex at y = 2 has theta = 0 and must keep its x and z.
  const pivotPoint = new Float32Array([0.5, 2, 0.25, 0, 0, 0]);
  core.twistPositions(pivotPoint, Math.PI / 4, 1, 1);
  assert.equal(pivotPoint[0], 0.5);
  assert.equal(pivotPoint[2], 0.25);
});

test("warp is an identity at zero strength and bends continuously otherwise", () => {
  const field = { type: 0, position: [0, 0, 0], scale: [100, 100, 100] };
  const flat = new Float32Array([0.5, 0.2, 0.3, 1, 0, 0]);
  const before = Array.from(flat);
  core.warpPositions(flat, 0, 0, 0, field);
  assert.deepEqual(Array.from(flat), before);

  const tiny = core.warpPositions(new Float32Array([0, 0, 0, 10, 0, 0]), 1e-12, 0, 0, field);
  closeTo(tiny[3], 10, 1e-6);
  closeTo(tiny[4], 0, 1e-6);
});

test("warp at the bend limit matches sin and cos form on a moderate arc", () => {
  const field = { type: 0, position: [0, 0, 0], scale: [100, 100, 100] };
  const positions = new Float32Array([0, 0, 0, 20, 0, 0]);
  core.warpPositions(positions, Math.PI / 2, 0, 0, field);
  // size 20, pivot 10, curvature k = (pi/2)/20. Vertex at x=20: s=10, theta=pi/4.
  const k = (Math.PI / 2) / 20;
  const theta = k * 10;
  closeTo(positions[3], 10 + Math.sin(theta) / k, 1e-5);
  closeTo(positions[4], (1 - Math.cos(theta)) / k, 1e-5);
});

test("warp field weights never introduce NaN for degenerate scales", () => {
  const degenerate = [
    { type: 1, position: [0, 0, 0], scale: [0, 0, 0] },
    { type: 2, position: [0, 0, 0], scale: [0, 0, 0] },
    { type: 3, position: [0, 0, 0], scale: [-5, 0, 0] },
  ];
  for (const field of degenerate) {
    const positions = new Float32Array([0, 0, 0, 5, 1, 2, -3, 0, 0, 20, 0, 0]);
    core.warpPositions(positions, 2, 0, 0, field);
    for (const value of positions) assert.ok(Number.isFinite(value), "finite output");
  }
});

test("field weight shapes match their definitions", () => {
  assert.equal(core.fieldWeight(0, 0, 0, 0, [0, 0, 0], [1, 1, 1]), 1);
  assert.equal(core.fieldWeight(0, 0, 0, 3, [0, 0, 0], [5, 5, 5]), 1);
  assert.equal(core.fieldWeight(20, 0, 0, 3, [0, 0, 0], [5, 5, 5]), 0);
  assert.equal(core.fieldWeight(0, 0, 0, 2, [0, 0, 0], [10, 10, 10]), 1);
  assert.equal(core.fieldWeight(10, 0, 0, 2, [0, 0, 0], [10, 10, 10]), 0);
  assert.equal(core.fieldWeight(Number.NaN, 0, 0, 1, [0, 0, 0], [1, 1, 1]), 0);
});

test("hash values depend only on their inputs, not on call order", () => {
  const first = core.hash01(7, 3, 2);
  const interleaved = [core.hash01(1, 0, 0), core.hash01(7, 3, 2), core.hash01(9, 9, 9)];
  assert.equal(interleaved[1], first);
  assert.ok(first >= 0 && first < 1);
  const unit = core.hashUnitVector(4, 5, 6);
  closeTo(Math.hypot(...unit), 1, 1e-9);
  assert.deepEqual(core.hashUnitVector(4, 5, 6), unit);
});

test("relative transforms map mesh space through the deformer frame and back", () => {
  const meshWorld = translation(5, 0, 0);
  const deformerWorld = translation(1, 2, 3);
  const relation = core.relativeTransform(deformerWorld, meshWorld);
  assert.equal(relation.identity, false);
  const point = new Float32Array([1, 1, 1]);
  core.transformPositions(point, relation.forward);
  assert.deepEqual(Array.from(point), [5, -1, -2]);
  core.transformPositions(point, relation.inverse);
  closeTo(point[0], 1, 1e-6);
  closeTo(point[1], 1, 1e-6);
  closeTo(point[2], 1, 1e-6);
});

test("a deformer that shares the mesh transform needs no conversion", () => {
  const same = translation(3, 4, 5);
  const relation = core.relativeTransform(same, same);
  assert.equal(relation.identity, true);
});

test("a singular deformer transform is rejected instead of dividing by zero", () => {
  assert.equal(core.relativeTransform(scale(0, 1, 1), identity()), null);
});

test("subdivision keeps the surface area and interpolates attributes", () => {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const stage = {
    count: 3,
    positions,
    attributes: { uv: { array: uv, itemSize: 2, normalized: false } },
    index: null,
    groups: [{ start: 0, count: 3, materialIndex: 2 }],
  };
  for (const polygons of [1, 2, 4, 7, 16]) {
    const out = core.subdivideStage(stage, polygons);
    const triangles = out.count / 3;
    assert.equal(triangles, polygons, `triangle count for ${polygons}`);
    let area = 0;
    for (let index = 0; index < out.count; index += 3) {
      const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => out.positions[(index + k) * 3 + c]));
      const ab = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const ac = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      area += Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      ) / 2;
    }
    closeTo(area, 2, 1e-5);
    assert.equal(out.groups[0].materialIndex, 2);
    assert.equal(out.groups[0].count, out.count);
    assert.ok(Array.from(out.attributes.uv.array).every(Number.isFinite));
  }
});

test("smooth polygon budget is bounded by the triangle budget", () => {
  assert.equal(core.clampPolygonCount(1e9), core.MAX_SMOOTH_TRIANGLES);
  assert.equal(core.clampPolygonCount(0), 1);
  assert.equal(core.clampPolygonCount(Number.NaN), 1);
});
