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

function stepResponse(mode, window, spring) {
  // One piece steps from 0 to 1 at frame 100. The Delay output peak is the overshoot.
  const source = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), count: 4, attributes: {},
    index: new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]), groups: [], smooth: false };
  const at = time => ({ kind: "plain", relation, position: [time >= 100 ? 1 : 0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], field: { type: 0 } });
  let peak = -Infinity;
  const cache = createStageCache();
  for (let time = 90; time < 100 + window + 2; time++) {
    const commands = [at(time), { kind: "delay", relation, mode, strength: 1, window, ...spring,
      history: Array.from({ length: window }, (_, i) => [at(Math.max(0, time - i - 1))]) }];
    const result = evaluateMesh({ base: source, sourceId: "step", polygonCount: 1, commands }, cache);
    peak = Math.max(peak, result.positions[0]);
  }
  return peak;
}

test("the default Spring settings keep the original weights bit for bit", () => {
  const core = require("../plugins/scene-plus/effector-core.js");
  assert.equal(core.SPRING_DAMPING, 3);
  assert.equal(core.SPRING_CYCLES, 1);
  for (let window = 1; window <= 24; window++) for (let i = 0; i < window; i++) {
    const age = (i + 1) / window;
    assert.equal(Math.exp(-core.SPRING_DAMPING * age) * Math.sin(age * Math.PI * 2 * core.SPRING_CYCLES),
      Math.exp(-3 * age) * Math.sin(age * Math.PI * 2));
  }
  for (const window of [1, 2, 3, 12, 24]) for (const frame of [0, 5, 40]) {
    const implicit = evaluate(frame, 2, window, createStageCache());
    const commands = commandsAt(frame, 2, window);
    commands[1].damping = 3; commands[1].cycles = 1;
    const explicit = evaluateMesh({ base: base(), sourceId: "s", polygonCount: 1, commands }, createStageCache());
    assert.deepEqual(bits(explicit.positions), bits(implicit.positions), `window ${window} frame ${frame}`);
  }
});

test("Spring overshoot grows as damping falls and stays bounded", () => {
  const peaks = [3, 2, 1, 0.5, 0.25].map(damping => stepResponse(2, 48, { damping, cycles: 1 }));
  const overshoot = peaks.map(peak => peak - 1);
  assert.ok(Math.abs(overshoot[0] - 0.29) < 0.02, "the default settings overshoot by about 29%: " + overshoot[0]);
  for (let i = 1; i < overshoot.length; i++) assert.ok(overshoot[i] > overshoot[i - 1], "lower damping overshoots further");
  assert.ok(overshoot[2] > 1.2, "damping 1 passes the target by more than the step: " + overshoot[2]);
  for (const damping of [0.25, 1, 3, 12]) for (const cycles of [0.25, 0.5, 1, 2, 3.5, 8]) for (const window of [1, 2, 3, 5, 9, 16, 24, 120]) {
    const peak = stepResponse(2, window, { damping, cycles });
    assert.ok(Number.isFinite(peak) && Math.abs(peak) < 60, `damping ${damping} cycles ${cycles} window ${window}: ${peak}`);
  }
});

test("more Spring cycles settle sooner within the same history", () => {
  const motion = cycles => {
    const positions = [];
    for (let age = 1; age <= 48; age++) {
      const source = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), count: 4, attributes: {},
        index: new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]), groups: [], smooth: false };
      const at = time => ({ kind: "plain", relation, position: [time >= 100 ? 1 : 0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], field: { type: 0 } });
      const time = 100 + age;
      positions.push(evaluateMesh({ base: source, sourceId: "c", polygonCount: 1, commands: [at(time), { kind: "delay", relation, mode: 2, strength: 1, window: 48, damping: 3, cycles,
        history: Array.from({ length: 48 }, (_, i) => [at(time - i - 1)]) }] }).positions[0]);
    }
    return positions.indexOf(Math.max(...positions));
  };
  assert.ok(motion(2) < motion(1), "two cycles reach their peak earlier");
});

test("the sample budget keeps its old value up to 24 frames and covers the limit", () => {
  const { delaySampleBudget } = require("../plugins/scene-plus/effector-core.js");
  for (const window of [0, 1, 12, 24]) assert.equal(delaySampleBudget(window), 96);
  assert.equal(delaySampleBudget(120), 480);
});

test("Delay's new properties default to the original Spring and clamp saved values", () => {
  const { _test } = require("../plugins/scene-plus/scene-plus.js");
  class Properties {
    constructor(definitions) { this.addAll(definitions); }
    addAll(definitions) {
      for (const [key, definition] of Object.entries(definitions || {})) {
        this[key] = { definition, value: definition.value, get() { return this.value; } };
      }
    }
    load() {}
  }
  class List extends Array { constructor() { super(); this.onListChanged = { watch() {}, unwatch() {} }; } }
  class Group {
    constructor() {
      this.properties = new Properties({ enabled: { value: 1 } });
      this.objects = new List();
      this.children = [this.properties, this.objects];
    }
  }
  const PZ = { object3d: Object.assign(function () {}, { group: Group }), objectList: List, propertyList: Properties,
    property: { type: { NUMBER: 0, VECTOR3: 2, OPTION: 6, TEXT: 7 } } };
  const delay = new (_test.createDelayClass(PZ, {}))();
  assert.equal(delay.properties.window.definition.max, 120);
  assert.equal(delay.properties.window.definition.value, 12);
  const blend = delay.workerCommand(0);
  assert.deepEqual(blend, { kind: "delay", mode: 0, strength: 0.75, window: 12 }, "other modes keep their command");
  delay.properties.mode.value = 2;
  const spring = delay.workerCommand(0);
  assert.equal(spring.damping, 3);
  assert.equal(spring.cycles, 1);
  delay.properties.window.value = 500;
  delay.properties.springDamping.value = 0;
  delay.properties.springCycles.value = 99;
  const clamped = delay.workerCommand(0);
  assert.deepEqual([clamped.window, clamped.damping, clamped.cycles], [120, 0.25, 8]);
  assert.equal(delay.historyFrames(0), 120);
});
