"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createWorkerSource } = require("../plugins/scene-plus/effector-jobs.js");
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { createStageCache, evaluateMesh, evaluateCachedMesh } = require("../plugins/scene-plus/effector-evaluate.js");

function fixture() {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(4, 5, 6), new THREE.MeshStandardMaterial());
  const deformer = createMeshDeformer(THREE), base = deformer.sourceStage(mesh);
  deformer.dispose();
  const command = frame => ({ kind: "fracture", topology: { cells: 8, seed: 3, closed: true },
    motion: { distance: frame / 10, spin: frame / 100, fragmentScale: 80, randomness: 40 }, relation: { identity: true } });
  const input = frame => ({ base, sourceId: base.sourceId, polygonCount: 1, commands: [command(frame)], shareStages: true });
  return { mesh, command, input };
}

function workerSource() {
  const names = ["earcut", "legacy-subdivision", "effector-core", "effector-fracture", "effector-mesh", "effector-evaluate"];
  const sources = Object.fromEntries(names.map(name => [name + ".js", fs.readFileSync(path.join(__dirname, "../plugins/scene-plus", name + ".js"), "utf8")]));
  return createWorkerSource(sources);
}

function worker() {
  const instance = new Worker(`const {parentPort}=require("node:worker_threads");global.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);parentPort.on("message",data=>global.onmessage({data}));` + workerSource(), { eval: true });
  let serial = 0;
  return { instance, evaluate(input) {
    const promise = new Promise((resolve, reject) => { instance.once("message", resolve); instance.once("error", reject); });
    instance.postMessage({ id: ++serial, input });
    return promise;
  } };
}

test("a cache miss never executes cold topology builders on the presenting thread", () => {
  const f = fixture(), cache = createStageCache();
  assert.equal(evaluateCachedMesh(f.input(0), cache), null);
  assert.equal(f.input(0).base.pieceIds, undefined, "even source connectivity stays in the cold worker");
  evaluateMesh(f.input(0), cache);
  const original = evaluateCachedMesh(f.input(0), cache);
  assert.deepEqual(original, evaluateMesh(f.input(0)));
  const moving = evaluateCachedMesh(f.input(8), cache);
  assert.equal(moving.attributes.uv.array, original.attributes.uv.array, "static attributes need no per-frame copies");
  assert.equal(moving.attributes.color.array, original.attributes.color.array);
  assert.notEqual(moving.positions, original.positions);
  assert.notEqual(moving.attributes.normal.array, original.attributes.normal.array);
  const edited = f.input(5);
  edited.commands[0].topology.seed++;
  assert.equal(evaluateCachedMesh(edited, cache), null);
  assert.deepEqual(evaluateCachedMesh(f.input(0), cache), original);
  cache.forget(f.input(0).sourceId);
  assert.equal(evaluateCachedMesh(f.input(0), cache), null);
});

test("worker stages remain usable on both threads and give identical shuffled warm frames", async () => {
  const f = fixture(), w = worker();
  try {
    const first = await w.evaluate(f.input(0));
    assert.equal(first.error, undefined);
    assert.ok(first.stages.length >= 2, "return source connectivity and the exact immutable fracture stage");
    const cache = createStageCache();
    for (const [key, stage] of first.stages) cache.get(key, () => stage);
    for (const frame of [8, 0, 3, 12, 3, 8]) {
      const input = f.input(frame);
      assert.deepEqual(evaluateCachedMesh(input, cache), evaluateMesh(input));
      const repeatedWorker = await w.evaluate(input);
      assert.equal(repeatedWorker.error, undefined, "transfers cannot detach the worker's retained stages");
      assert.deepEqual(repeatedWorker.value, evaluateCachedMesh(input, cache));
    }
    const tiny = createStageCache(1);
    for (const [key, stage] of first.stages) tiny.get(key, () => stage);
    assert.equal(evaluateCachedMesh(f.input(8), tiny), null, "evicted topologies go back to the worker");
  } finally { await w.instance.terminate(); }
});

test("warm presentation consumes completed worker stages without another asynchronous frame job", () => {
  const f = fixture(), workerCache = createStageCache();
  let requested = 0, released = 0, pending;
  const jobs = { available: true, request(mesh, key, input) {
    requested++;
    if (!pending) pending = { status: "queued", input, key };
    return pending;
  }, release() { released++; }, forget() {}, dispose() {}, pending: () => [] };
  const deformer = createMeshDeformer(THREE, jobs), chain = [{ node: new THREE.Object3D(), effector: { workerCommand: f.command } }];
  deformer.deformMesh(f.mesh, chain, 0, 1);
  assert.equal(requested, 1);
  const stages = new Map(), tracking = { get(key, build) {
    const stage = workerCache.get(key, build);stages.set(key, stage);return stage;
  } };
  pending.value = evaluateMesh(pending.input, tracking);
  pending.stages = Array.from(stages);
  pending.status = "done";
  deformer.deformMesh(f.mesh, chain, 0, 1);
  const afterCold = requested;
  for (const frame of [8, 0, 3, 12, 3, 8]) {
    deformer.deformMesh(f.mesh, chain, frame, 1);
    assert.equal(requested, afterCold, "a ready topology cannot wait on serial worker motion messages");
    const expected = evaluateMesh({ ...pending.input, commands: [f.command(frame)] });
    assert.deepEqual(f.mesh.geometry.attributes.position.array, expected.positions);
    assert.deepEqual(f.mesh.geometry.attributes.normal.array, expected.attributes.normal.array);
    assert.deepEqual(f.mesh.geometry.attributes.uv.array, expected.attributes.uv.array);
    assert.deepEqual(f.mesh.geometry.attributes.color.array, expected.attributes.color.array);
    assert.deepEqual(f.mesh.geometry.groups, expected.groups);
  }
  assert.ok(released > 0);
  deformer.dispose();
});

test("shared stages preserve subdivision modes, material slots, curved normals, and delay history", async () => {
  const f = fixture(), w = worker();
  const variants = [
    { polygonCount: 7, legacySubdivision: true },
    { polygonCount: 7, legacySubdivision: false },
    { materialCount: 6 },
    { trailing: { kind: "twist", angle: 0.2, axis: 1, offset: 0, relation: { identity: true } } },
    { trailing: { kind: "delay", strength: 0.7, mode: 1, history: [[f.command(0)], [f.command(2)]], relation: { identity: true } } },
  ];
  try {
    for (const variant of variants) {
      const input = frame => {
        const { trailing, ...options } = variant;
        return { ...f.input(frame), ...options, commands: [f.command(frame), ...(trailing ? [trailing] : [])] };
      };
      const built = await w.evaluate(input(0));
      assert.equal(built.error, undefined);
      const cache = createStageCache();
      for (const [key, stage] of built.stages) cache.get(key, () => stage);
      for (const frame of [5, 0, 2, 5]) assert.deepEqual(evaluateCachedMesh(input(frame), cache), evaluateMesh(input(frame)));
      const edited = input(0);
      edited.commands.unshift({ kind: "twist", angle: 0.5, axis: 1, relation: { identity: true } });
      assert.equal(evaluateCachedMesh(edited, cache), null, "upstream motion changes the required topology");
    }
  } finally { await w.instance.terminate(); }
});
