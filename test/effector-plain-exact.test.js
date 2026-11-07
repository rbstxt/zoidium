"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../plugins/scene-plus/effector-core.js");

// The vertex loop as first written, kept as the bit-exact reference.
function referencePlain(positions, stage, command) {
  const ids = stage.pieceIds, count = stage.pieceCount || 1;
  const sums = new Float64Array(count * 3), sizes = new Uint32Array(count);
  for (let i = 0; i < positions.length / 3; i++) {
    const id = ids ? ids[i] : 0; sizes[id]++;
    for (let a = 0; a < 3; a++) sums[id * 3 + a] += positions[i * 3 + a];
  }
  const centers = [], rotations = [], scales = [], weights = [];
  const field = core.prepareField(command.field, positions);
  for (let id = 0; id < count; id++) {
    const c = [0, 1, 2].map(a => sums[id * 3 + a] / (sizes[id] || 1)); centers.push(c);
    const w = core.evaluateField(...c, field); weights.push(w);
    rotations.push(command.rotation.map(v => v * w));
    scales.push(command.scale.map(v => 1 + (v - 1) * w));
  }
  for (let i = 0; i < positions.length / 3; i++) {
    const id = ids ? ids[i] : 0, c = centers[id];
    const q = core.rotateXYZ([0, 1, 2].map(a => (positions[i * 3 + a] - c[a]) * scales[id][a]), rotations[id]);
    for (let a = 0; a < 3; a++) positions[i * 3 + a] = c[a] + q[a] + command.position[a] * weights[id];
  }
  return positions;
}
function random(seed) {
  let state = seed >>> 0;
  return (low, high) => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) + 1 >>> 0;
    return low + (high - low) * (state / 4294967296);
  };
}
function scene(next, pieces, verticesPerPiece) {
  const count = pieces * verticesPerPiece;
  const positions = new Float32Array(count * 3), pieceIds = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    pieceIds[i] = Math.floor(i / verticesPerPiece);
    for (let a = 0; a < 3; a++) positions[i * 3 + a] = next(-40, 40);
  }
  return { positions, stage: { pieceIds, pieceCount: pieces, positions, count } };
}
const bits = array => Array.from(new Uint32Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength)));

test("Plain positions stay bit-identical to the reference across commands", () => {
  const next = random(1234);
  const fields = [{ type: 0 }, { type: 1, position: [0, 0, 0], scale: [50, 50, 50] },
    { type: 2, position: [3, 1, -2], scale: [30, 60, 90], falloff: 40 }, { type: 3, position: [1, 1, 1], scale: [70, 70, 70], invert: true }];
  for (let run = 0; run < 80; run++) {
    const { positions, stage } = scene(next, 1 + run % 7, 12);
    const command = {
      position: [next(-9, 9), next(-9, 9), next(-9, 9)],
      rotation: run % 5 === 0 ? [0, 0, 0] : [next(-400, 400), next(-400, 400), next(-400, 400)],
      scale: run % 5 === 1 ? [1, 1, 1] : [next(-2, 3), next(-2, 3), next(-2, 3)],
      field: fields[run % fields.length],
    };
    const actual = core.plainPositions(new Float32Array(positions), stage, command);
    const expected = referencePlain(new Float32Array(positions), stage, command);
    assert.deepEqual(bits(actual), bits(expected), "run " + run);
  }
});

test("Plain treats a stage without piece ids as one piece and ignores bad angles", () => {
  const positions = new Float32Array([0, 0, 0, 1, 2, 3, -4, 5, 6]);
  const stage = { positions, count: 3 };
  const command = { position: [1, 0, 0], rotation: [30, NaN, 90], scale: [2, 1, 1], field: { type: 0 } };
  assert.deepEqual(bits(core.plainPositions(new Float32Array(positions), stage, command)),
    bits(referencePlain(new Float32Array(positions), stage, command)));
});

test("the exactness comparison detects a changed rotation order", () => {
  const next = random(9);
  const { positions, stage } = scene(next, 2, 8);
  const command = { position: [0, 0, 0], rotation: [31, 47, 73], scale: [1, 1, 1], field: { type: 0 } };
  const reversed = new Float32Array(positions);
  const reference = referencePlain(new Float32Array(positions), stage, command);
  const swapped = { ...command, rotation: [73, 47, 31] };
  core.plainPositions(reversed, stage, swapped);
  assert.notDeepEqual(bits(reversed), bits(reference));
});
