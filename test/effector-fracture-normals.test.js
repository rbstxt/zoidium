"use strict";

// Fracture pieces keep the shading of the surface they were cut from: their
// normals are the source normals carried through each piece's transform, not
// normals rebuilt from the clipped faces.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const { computeFractureNormals } = require("../plugins/scene-plus/effector-mesh.js");
const { evaluateMesh, normalsFor } = require("../plugins/scene-plus/effector-evaluate.js");

function close(actual, expected, label) {
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-5, `${label}: ${actual} vs ${expected}`);
}

function faceNormal(a, b, c) {
  const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const length = Math.hypot(...n);
  return n.map(v => v / length);
}

// Two tetrahedra, non-indexed, with outward face normals as source normals.
function twoPieces() {
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const positions = [], normals = [], pieceIds = [];
  for (let piece = 0; piece < 2; piece++) {
    for (const face of faces) {
      const points = face.map(i => corners[i].map((v, axis) => v + (axis === 0 ? piece * 3 : 0)));
      const n = faceNormal(...points);
      for (const point of points) { positions.push(...point); normals.push(...n); pieceIds.push(piece); }
    }
  }
  return { kind: "fracture", positions: new Float32Array(positions), count: positions.length / 3, index: null,
    pieceIds: new Uint16Array(pieceIds), pieceCount: 2, attributes: { normal: { array: new Float32Array(normals), itemSize: 3 } } };
}

test("resting pieces keep their source normals exactly", () => {
  const stage = twoPieces();
  const out = new Float32Array(stage.positions.length);
  assert.equal(computeFractureNormals(stage, new Float32Array(stage.positions), out), true);
  for (let v = 0; v < stage.count; v++) close(out.subarray(v * 3, v * 3 + 3), stage.attributes.normal.array.subarray(v * 3, v * 3 + 3), "vertex " + v);
});

test("normals follow each piece's rotation and per-axis scale", () => {
  const stage = twoPieces();
  const moved = new Float32Array(stage.positions);
  for (let v = 0; v < stage.count; v++) {
    const p = moved.subarray(v * 3, v * 3 + 3);
    if (stage.pieceIds[v] === 0) { const [x, y] = p; p[0] = -y + 5; p[1] = x - 2; p[2] += 1; } // 90 degrees about Z
    else p[0] = (p[0] - 3) * 2 + 3; // scale X by 2
  }
  const out = new Float32Array(moved.length);
  computeFractureNormals(stage, moved, out);
  const source = stage.attributes.normal.array;
  for (let v = 0; v < stage.count; v++) {
    const [x, y, z] = source.subarray(v * 3, v * 3 + 3);
    let expected;
    if (stage.pieceIds[v] === 0) expected = [-y, x, z];
    else { const n = [x / 2, y, z]; const length = Math.hypot(...n); expected = n.map(c => c / length); }
    close(out.subarray(v * 3, v * 3 + 3), expected, "vertex " + v);
  }
});

test("a flat piece rotates its normal with the piece", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const stage = { kind: "fracture", positions, count: 6, index: null, pieceIds: new Uint16Array(6), pieceCount: 1,
    attributes: { normal: { array: new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat()), itemSize: 3 } } };
  const moved = new Float32Array(positions.length);
  for (let v = 0; v < 6; v++) { moved[v * 3] = positions[v * 3]; moved[v * 3 + 1] = 0; moved[v * 3 + 2] = positions[v * 3 + 1]; } // stand it up about X
  const out = new Float32Array(positions.length);
  computeFractureNormals(stage, moved, out);
  for (let v = 0; v < 6; v++) close(out.subarray(v * 3, v * 3 + 3), [0, -1, 0], "vertex " + v);
});

test("a fractured cube at rest shades its walls like the unfractured cube", () => {
  const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const positions = [], normals = [];
  for (const face of faces) {
    const points = face.map(i => corners[i]);
    const n = faceNormal(...points);
    for (const point of points) { positions.push(...point); normals.push(...n); }
  }
  const base = { positions: new Float32Array(positions), count: positions.length / 3, index: null, groups: [], uvs: null, smooth: false, kind: "source",
    attributes: { normal: { array: new Float32Array(normals), itemSize: 3, normalized: false } } };
  const result = evaluateMesh({ base, sourceId: "cube", polygonCount: 1, commands: [{ kind: "fracture", topology: { cells: 24, seed: 5, closed: true },
    motion: { distance: 0, scatter: 0, spin: 0, offset: 0 }, relation: { identity: true } }] });
  const out = result.attributes.normal.array;
  let walls = 0;
  // A triangle with all three corners on one cube face is part of that wall;
  // cut faces lie inside the cube.
  for (let v = 0; v + 2 < result.count; v += 3) {
    const corners = [0, 1, 2].map(c => result.positions.subarray((v + c) * 3, (v + c) * 3 + 3));
    for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
      if (!corners.every(p => Math.abs(p[axis] - side) < 1e-6)) continue;
      const expected = [0, 0, 0]; expected[axis] = side ? 1 : -1;
      for (let c = 0; c < 3; c++) close(out.subarray((v + c) * 3, (v + c) * 3 + 3), expected, "wall vertex " + (v + c));
      walls++;
    }
  }
  assert.ok(walls > 100, "many wall vertices were checked: " + walls);
  assert.equal(typeof normalsFor, "function");
});
