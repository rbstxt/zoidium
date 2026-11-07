"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStageCache, evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");

const relation = { identity: true };
function base() {
  const positions = [];
  for (let piece = 0; piece < 3; piece++) for (const [x, y, z] of [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]]) positions.push(x + piece * 9, y, z);
  const index = [];
  for (let piece = 0; piece < 3; piece++) index.push(piece * 4, piece * 4 + 2, piece * 4 + 1, piece * 4, piece * 4 + 1, piece * 4 + 3, piece * 4, piece * 4 + 3, piece * 4 + 2);
  return { positions: new Float32Array(positions), count: 12, attributes: {}, index: new Uint16Array(index), groups: [], smooth: false };
}
const plain = time => ({ kind: "plain", relation, position: [Math.sin(time * 0.37) * 6, time * 0.5, 0], rotation: [0, 0, time * 3], scale: [1 + time * 0.01, 1, 1], field: { type: 0 } });

test("the sample key keeps NaN, Infinity, -0, null, and missing values apart", () => {
  const { sampleKeyOf } = require("../plugins/scene-plus/effector-evaluate.js");
  const values = [NaN, Infinity, -Infinity, 0, -0, null, undefined, "NaN", "0", "null", "-0"];
  const keys = values.map(sampleKeyOf);
  assert.equal(new Set(keys).size, values.length, keys.join(" "));
  assert.equal(new Set([[1], [1, undefined], [undefined, 1], [[1]], { 0: 1 }, new Float32Array([1]), new Float64Array([1])].map(sampleKeyOf)).size, 7);
  assert.notEqual(sampleKeyOf({ a: "1", b: 2 }), sampleKeyOf({ a: 1, b: "2" }));
  assert.notEqual(sampleKeyOf(0.1 + 0.2), sampleKeyOf(0.3), "numbers keep all their digits");
  assert.equal(JSON.stringify([NaN]), JSON.stringify([null]), "JSON alone cannot tell them apart");
});

test("commands that differ only by -0 or a non-finite value do not share a sample", () => {
  const cache = createStageCache();
  const builds = [];
  const original = cache.sample;
  cache.sample = (key, build) => original(key, () => { builds.push(key); return build(); });
  const run = (position, rotation) => {
    const upstream = { ...plain(3), position, rotation };
    evaluateMesh({ base: base(), sourceId: "exact", polygonCount: 1, commands: [plain(4), { kind: "delay", relation, mode: 1, strength: 1, window: 1, history: [[upstream]] }] }, cache);
  };
  run([0, 0, 0], [0, 0, 0]);
  run([-0, 0, 0], [0, 0, 0]);
  run([0, 0, 0], [NaN, 0, 0]);
  run([0, 0, 0], [Infinity, 0, 0]);
  run([0, 0, 0], [-Infinity, 0, 0]);
  assert.equal(new Set(builds).size, 5, "each exact input builds its own sample");
  assert.equal(builds.length, 5);
  run([-0, 0, 0], [0, 0, 0]);
  assert.equal(builds.length, 5, "the same exact input hits");
});

test("a retained sample equals a rebuild for -0 and non-finite inputs", () => {
  const positions = commands => Array.from(new Uint32Array(evaluateMesh({ base: base(), sourceId: "exact", polygonCount: 1, commands }, createStageCache()).positions.buffer));
  const shared = createStageCache();
  for (const position of [[0, 0, 0], [-0, 0, 0], [NaN, 0, 0], [Infinity, 0, 0], [0, 0, 0]]) {
    const upstream = { ...plain(3), position };
    const commands = [plain(4), { kind: "delay", relation, mode: 1, strength: 1, window: 1, history: [[upstream]] }];
    const cached = Array.from(new Uint32Array(evaluateMesh({ base: base(), sourceId: "exact", polygonCount: 1, commands }, shared).positions.buffer));
    assert.deepEqual(cached, positions(commands), String(position));
  }
});
