"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStageCache, evaluateCachedMesh, evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");

const relation = { identity: true };
function base() {
  const positions = [];
  for (let piece = 0; piece < 3; piece++) for (const [x, y, z] of [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]]) positions.push(x + piece * 9, y, z);
  const index = [];
  for (let piece = 0; piece < 3; piece++) index.push(piece * 4, piece * 4 + 2, piece * 4 + 1, piece * 4, piece * 4 + 1, piece * 4 + 3, piece * 4, piece * 4 + 3, piece * 4 + 2);
  return { positions: new Float32Array(positions), count: 12, attributes: {}, index: new Uint16Array(index), groups: [], smooth: false };
}
const plain = time => ({ kind: "plain", relation, position: [Math.sin(time * 0.37) * 6, time * 0.5, 0], rotation: [0, 0, time * 3], scale: [1 + time * 0.01, 1, 1], field: { type: 0 } });
const commandsAt = (time, mode, window) => [plain(time), { kind: "delay", relation, mode, strength: 0.75, window,
  history: Array.from({ length: window }, (_, i) => [plain(Math.max(0, time - i - 1))]) }];
const evaluate = (time, mode, window, cache) => evaluateMesh({ base: base(), sourceId: "s", polygonCount: 1, commands: commandsAt(time, mode, window) }, cache);
const bits = array => Array.from(new Uint32Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength)));

test("Delay output is bit-identical with and without retained samples, in any frame order", () => {
  const frames = [0, 1, 2, 9, 10, 11, 30, 31, 3];
  for (const mode of [0, 1, 2]) for (const window of [1, 2, 7, 24, 120]) {
    const reference = new Map(frames.map(frame => [frame, bits(evaluate(frame, mode, window, createStageCache()).positions)]));
    const orders = [frames, [...frames].reverse(), [30, 0, 11, 2, 31, 9, 1, 10, 3, 30, 0]];
    for (const order of orders) {
      const cache = createStageCache();
      for (const frame of order) assert.deepEqual(bits(evaluate(frame, mode, window, cache).positions), reference.get(frame), `mode ${mode} window ${window} frame ${frame}`);
    }
    const tiny = createStageCache(undefined, undefined, 1);
    for (const frame of frames) assert.deepEqual(bits(evaluate(frame, mode, window, tiny).positions), reference.get(frame), "evicting every sample changes nothing");
  }
});

test("consecutive frames reuse all but one history sample, and a changed input misses", () => {
  const cache = createStageCache();
  const builds = [];
  const original = cache.sample;
  cache.sample = (key, build) => original(key, () => { builds.push(key); return build(); });
  evaluate(50, 2, 24, cache);
  assert.equal(builds.length, 24, "the first frame builds every sample");
  builds.length = 0;
  evaluate(51, 2, 24, cache);
  assert.equal(builds.length, 1, "the next frame builds one sample");
  builds.length = 0;
  evaluate(51, 2, 24, cache);
  assert.equal(builds.length, 0, "a repeated frame builds none");
  const moved = commandsAt(51, 2, 24);
  moved[1].history[3][0].position[0] += 1e-9;
  evaluateMesh({ base: base(), sourceId: "s", polygonCount: 1, commands: moved }, cache);
  assert.equal(builds.length, 1, "any changed upstream input misses");
});

test("samples are keyed by source, subdivision, and material count", () => {
  const cache = createStageCache();
  const keys = [];
  const original = cache.sample;
  cache.sample = (key, build) => { keys.push(key); return original(key, build); };
  const run = input => evaluateMesh({ base: base(), sourceId: "s", polygonCount: 1, commands: commandsAt(5, 1, 1), ...input }, cache);
  run({}); run({ sourceId: "t" }); run({ polygonCount: 4 }); run({ legacySubdivision: true }); run({ materialCount: 2 });
  assert.equal(new Set(keys).size, 5);
  cache.forget("s");
  keys.length = 0;
  let built = 0;
  cache.sample = (key, build) => original(key, () => { built++; return build(); });
  run({});
  assert.equal(built, 1, "forgetting a source drops its samples");
});

test("sample memory stays within its byte bound and keeps recent samples", () => {
  const limit = 2000;
  const cache = createStageCache(undefined, undefined, limit);
  let total = 0;
  const builds = new Map();
  const original = cache.sample;
  cache.sample = (key, build) => original(key, () => { builds.set(key, (builds.get(key) || 0) + 1); total++; return build(); });
  for (let frame = 0; frame < 60; frame++) evaluate(frame, 1, 3, cache);
  assert.equal(total > 3, true);
  const before = total;
  evaluate(59, 1, 3, cache);
  assert.ok(total - before <= 1, "the newest samples remain");
  const first = createStageCache(undefined, undefined, 1);
  const a = first.sample("a", () => ({ positions: new Float32Array(100) }));
  assert.equal(first.sample("a", () => assert.fail("the only entry stays")), a);
  first.sample("b", () => ({ positions: new Float32Array(100) }));
  let rebuilt = false;
  first.sample("a", () => { rebuilt = true; return { positions: new Float32Array(100) }; });
  assert.equal(rebuilt, true, "older samples leave first");
});

test("a sample miss never builds a cold stage on the presenting thread", () => {
  const cache = createStageCache();
  const source = base();
  const input = { base: source, sourceId: "cold", polygonCount: 4, commands: commandsAt(5, 2, 4) };
  assert.equal(evaluateCachedMesh(input, cache), null, "the missing stage still defers to the worker");
  evaluateMesh(input, cache);
  assert.ok(evaluateCachedMesh({ ...input, commands: commandsAt(6, 2, 4) }, cache), "ready topology evaluates locally");
});
