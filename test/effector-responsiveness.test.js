"use strict";

// Effector edits and playback must keep up with the timeline: smoothing reuses
// the stage's vertex sharing, and dropping an unwanted motion frame never
// restarts the worker (which would discard every cached fracture topology).

const assert = require("node:assert/strict");
const test = require("node:test");
const { computeSmoothVertexNormals } = require("../plugins/scene-plus/effector-mesh.js");
const { createMeshJobs } = require("../plugins/scene-plus/effector-jobs.js");

// The previous per-frame implementation, kept as the reference result.
function referenceNormals(positions, groups, stage) {
  const count = positions.length / 3;
  const out = new Float32Array(positions.length);
  const sums = new Map();
  const groupOf = (vertex) => {
    for (const group of groups) if (vertex >= group.start && vertex < group.start + group.count) return group.materialIndex || 0;
    return 0;
  };
  const keyFor = (vertex) => {
    const source = stage.attributes.normal.array;
    const hardEdge = [0, 1, 2].map(a => Math.round(source[vertex * 3 + a] * 10000)).join(":");
    return hardEdge + ":" + (stage.pieceIds[vertex] || 0) + ":" + groupOf(vertex) + ":" +
      [0, 1, 2].map(a => Math.round(positions[vertex * 3 + a] * 100000)).join(":");
  };
  for (let vertex = 0; vertex + 2 < count; vertex += 3) {
    const p = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const [a, b, c] = [p(vertex), p(vertex + 1), p(vertex + 2)];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const face = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    for (let corner = 0; corner < 3; corner++) {
      const key = keyFor(vertex + corner);
      const sum = sums.get(key) || [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) sum[axis] += face[axis];
      sums.set(key, sum);
    }
  }
  for (let vertex = 0; vertex < count; vertex++) {
    const sum = sums.get(keyFor(vertex)) || [0, 0, 1];
    const length = Math.hypot(...sum) || 1;
    for (let axis = 0; axis < 3; axis++) out[vertex * 3 + axis] = sum[axis] / length;
  }
  return out;
}

function grid(n) {
  // A bent strip of two pieces with a shared seam, flat source normals and two
  // material groups, non-indexed like fracture output.
  const positions = [], normals = [], pieceIds = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    for (const [u, v] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]]) {
      positions.push(u, v, 0); normals.push(0, 0, 1); pieceIds.push(i < n / 2 ? 0 : 1);
    }
  }
  const count = positions.length / 3;
  return {
    stage: { kind: "fracture", positions: new Float32Array(positions), pieceIds: new Uint32Array(pieceIds),
      attributes: { normal: { array: new Float32Array(normals) } }, count },
    groups: [{ start: 0, count: count / 2, materialIndex: 0 }, { start: count / 2, count: count / 2, materialIndex: 1 }],
  };
}

function deform(rest, time) {
  const out = new Float32Array(rest);
  for (let i = 0; i < out.length; i += 3) out[i + 2] = Math.sin(out[i] * 0.7 + time) * Math.cos(out[i + 1] * 0.4);
  return out;
}

test("smoothing matches the previous per-frame result on every animated frame", () => {
  const { stage, groups } = grid(8);
  for (const time of [0, 0.5, 1.7]) {
    const positions = deform(stage.positions, time);
    const geometry = { attributes: { position: { array: positions, count: positions.length / 3 },
      normal: { array: new Float32Array(positions.length) } }, groups };
    computeSmoothVertexNormals(geometry, stage);
    const expected = referenceNormals(positions, groups, stage);
    for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(geometry.attributes.normal.array[i] - expected[i]) < 1e-5, "normal " + i);
  }
});

test("dropping an unwanted motion frame keeps the worker and its topology cache", async () => {
  const workers = [];
  const host = {
    Blob: class {},
    URL: { createObjectURL() { return "blob:x"; }, revokeObjectURL() {} },
    Worker: class {
      constructor() { workers.push(this); this.messages = []; this.terminated = false; }
      postMessage(message) { this.messages.push(message); }
      terminate() { this.terminated = true; }
      finish(value) { this.onmessage({ data: { id: this.messages.at(-1).id, value } }); }
    },
  };
  let redraws = 0;
  const jobs = createMeshJobs("source", host, () => redraws++);
  const a = {}, b = {};
  jobs.request(a, "a:0", { buildKey: "topology:a", sourceId: 1 });
  workers[0].finish({ positions: new Float32Array([0]) });
  jobs.release(a);
  // Mesh a asks for its next motion frame, then moves on before it finishes,
  // while another mesh requests different work.
  jobs.request(a, "a:1", { buildKey: "topology:a", sourceId: 1 });
  jobs.release(a);
  const other = jobs.request(b, "b:0", { buildKey: "topology:b", sourceId: 2 });
  assert.equal(workers.length, 1, "no new worker");
  assert.equal(workers[0].terminated, false, "cached topologies survive");
  const before = redraws;
  workers[0].finish({ positions: new Float32Array([1]) });
  assert.equal(redraws, before, "the discarded frame does not publish");
  assert.equal(workers[0].messages.at(-1).input.sourceId, 2, "the wanted job runs next on the same worker");
  workers[0].finish({ positions: new Float32Array([2]) });
  assert.equal((await other.promise).positions[0], 2);
  assert.equal(jobs.stats().bytes, 4 + 4, "only published results count toward the cache budget");
  jobs.dispose();
});
