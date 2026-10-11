"use strict";

// The pre-optimization algorithm is an independent reference for byte equality.
const assert = require("node:assert/strict");
const test = require("node:test");
const { computeSmoothVertexNormals } = require("../plugins/scene-plus/effector-mesh.js");

function buildWeld(positions, count, groups, stage) {
  const groupIds = new Int32Array(count);
  // The first group containing a vertex wins.
  for (let g = (groups || []).length - 1; g >= 0; g -= 1) {
    const group = groups[g];
    const end = Math.min(count, group.start + group.count);
    for (let vertex = Math.max(0, group.start); vertex < end; vertex += 1) groupIds[vertex] = group.materialIndex || 0;
  }
  const source = stage?.attributes?.normal?.array;
  const pieces = stage?.pieceIds;
  const slots = new Int32Array(count);
  const lookup = new Map();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const hardEdge = source ? Math.round(source[vertex * 3] * 10000) + ":" + Math.round(source[vertex * 3 + 1] * 10000) + ":" + Math.round(source[vertex * 3 + 2] * 10000) : "";
    const key = hardEdge + ":" + (pieces?.[vertex] || 0) + ":" + groupIds[vertex] + ":" +
      Math.round(positions[vertex * 3] * 100000) + ":" + Math.round(positions[vertex * 3 + 1] * 100000) + ":" + Math.round(positions[vertex * 3 + 2] * 100000);
    let slot = lookup.get(key);
    if (slot === undefined) {
      slot = lookup.size;
      lookup.set(key, slot);
    }
    slots[vertex] = slot;
  }
  return { slots, slotCount: lookup.size };
}

function referenceNormals(geometry, stage) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return;
  const array = position.array;
  const count = position.count;
  const { slots, slotCount } = buildWeld(stage?.positions?.length === count * 3 ? stage.positions : array, count, geometry.groups, stage);
  const sums = new Float64Array(slotCount * 3);
  const covered = count - count % 3;
  for (let vertex = 0; vertex < covered; vertex += 3) {
    const a = vertex * 3;
    const abx = array[a + 3] - array[a], aby = array[a + 4] - array[a + 1], abz = array[a + 5] - array[a + 2];
    const acx = array[a + 6] - array[a], acy = array[a + 7] - array[a + 1], acz = array[a + 8] - array[a + 2];
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = slots[vertex + corner] * 3;
      sums[slot] += fx;
      sums[slot + 1] += fy;
      sums[slot + 2] += fz;
    }
  }
  const out = normal.array;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (vertex >= covered) {
      out[vertex * 3] = 0;
      out[vertex * 3 + 1] = 0;
      out[vertex * 3 + 2] = 1;
      continue;
    }
    const slot = slots[vertex] * 3;
    const x = sums[slot], y = sums[slot + 1], z = sums[slot + 2];
    const length = Math.hypot(x, y, z) || 1;
    out[vertex * 3] = x / length;
    out[vertex * 3 + 1] = y / length;
    out[vertex * 3 + 2] = z / length;
  }
  normal.needsUpdate = true;
}


function geometry(positions, groups, NormalArray = Float32Array) {
  return { attributes: { position: { array: positions, count: positions.length / 3 },
    normal: { array: new NormalArray(positions.length) } }, groups };
}

test("welded normal scratch matches the original across meshes, frames and seeks", () => {
  for (let seed = 0; seed < 32; seed++) {
    const count = 30 + seed % 3;
    const rest = Float32Array.from({ length: count * 3 }, (_, i) => Math.sin(i * 1.7 + seed) * 3);
    rest.set(rest.subarray(0, 18), 36);
    const groups = [{ start: 0, count: 18, materialIndex: 0 }, { start: 12, count: 18, materialIndex: 1 }];
    const stage = { kind: "subdivided", positions: rest,
      attributes: { normal: { array: Float32Array.from(rest, (_, i) => i % 3 === 2 ? 1 : 0) } },
      pieceIds: Uint32Array.from({ length: count }, (_, i) => Math.floor(i / 12)) };
    for (const frame of [0, 3, 20, 3, 0]) for (const NormalArray of [Float32Array, Float64Array]) {
      const positions = Float32Array.from(rest, (v, i) => v + Math.sin(frame * 0.1 + i) * 0.2);
      const expected = geometry(positions, groups, NormalArray);
      const actual = geometry(positions, groups, NormalArray);
      referenceNormals(expected, stage);
      computeSmoothVertexNormals(actual, stage);
      assert.deepEqual(Buffer.from(actual.attributes.normal.array.buffer), Buffer.from(expected.attributes.normal.array.buffer));
      assert.equal(actual.attributes.normal.needsUpdate, true);
    }
  }
});

test("source-ID weld sharing clears scratch between different meshes", () => {
  const rest = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,1,0, 0,0,1]);
  for (const frame of [0, 4, 1, 0]) {
    const stage = { kind: "source", sourceId: "normal-test-source", positions: rest.slice(), attributes: {} };
    const positions = Float32Array.from(rest, (v, i) => v + Math.sin(frame + i) * 0.2);
    const expected = geometry(positions, []), actual = geometry(positions, []);
    referenceNormals(expected, stage);
    computeSmoothVertexNormals(actual, stage);
    assert.deepEqual(actual.attributes.normal.array, expected.attributes.normal.array);
  }
});

test("normals retain the uncached path for missing or mismatched rest topology", () => {
  for (const stage of [undefined, { positions: new Float32Array(3) }]) {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0, 2,2,2]);
    const expected = geometry(positions, []), actual = geometry(positions, []);
    referenceNormals(expected, stage);
    computeSmoothVertexNormals(actual, stage);
    assert.deepEqual(actual.attributes.normal.array, expected.attributes.normal.array);
    assert.deepEqual(Array.from(actual.attributes.normal.array.slice(-3)), [0,0,1]);
  }
});

test("scratch growth, shrinking layouts and zero-area faces preserve normal bytes", () => {
  for (const triangles of [64, 1, 0, 8, 128, 2]) {
    const rest = new Float32Array(triangles * 9);
    for (let t = 0; t < triangles; t++) {
      const x = t % 5;
      rest.set(t % 3 ? [x,0,0, x+1,0,0, x,1,0] : [x,0,0, x,0,0, x,0,0], t * 9);
    }
    const stage = { positions: rest, attributes: {}, kind: "subdivided" };
    const expected = geometry(rest, [], Float64Array);
    const actual = geometry(rest, [], Float64Array);
    referenceNormals(expected, stage);
    computeSmoothVertexNormals(actual, stage);
    assert.deepEqual(Buffer.from(actual.attributes.normal.array.buffer), Buffer.from(expected.attributes.normal.array.buffer));
  }
});
