"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { createMeshJobs, createWorkerSource } = require("../plugins/scene-plus/effector-jobs.js");
const { createStageCache, evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const fracture = require("../plugins/scene-plus/effector-fracture.js");

function hostHarness() {
  const workers = [], revoked = [];
  return {
    workers, revoked,
    host: {
      Blob: class {},
      URL: { createObjectURL() { return "blob:" + workers.length; }, revokeObjectURL(url) { revoked.push(url); } },
      Worker: class {
        constructor() { workers.push(this); this.messages = []; this.terminated = false; }
        postMessage(message) { this.messages.push(message); }
        terminate() { this.terminated = true; }
        finish(value, error) { this.onmessage({ data: { id: this.messages.at(-1).id, value, error } }); }
      },
    },
  };
}

test("identical pending requests share one worker build and redraw on completion", async () => {
  const harness = hostHarness(); let redraws = 0;
  const jobs = createMeshJobs("source", harness.host, () => redraws++);
  const a = {}, b = {};
  const first = jobs.request(a, "same", { positions: [1] });
  const second = jobs.request(b, "same", { positions: [1] });
  assert.equal(first, second);
  assert.equal(harness.workers[0].messages.length, 1);
  jobs.release(a);
  assert.equal(harness.workers[0].terminated, false, "the other consumer still needs the build");
  harness.workers[0].finish({ positions: new Float32Array([2]) });
  assert.deepEqual((await second.promise).positions, new Float32Array([2]));
  assert.equal(redraws, 1);
  jobs.release(b);
  assert.equal(jobs.pending([a, b]).length, 0);
  jobs.dispose();
  assert.equal(harness.workers[0].terminated, true);
  assert.equal(harness.revoked.length, 1);
});

test("changed inputs cancel unused work and stale completion cannot publish", async () => {
  const harness = hostHarness(); let redraws = 0;
  const jobs = createMeshJobs("source", harness.host, () => redraws++);
  const mesh = {};
  const stale = jobs.request(mesh, "old", {});
  const oldWorker = harness.workers[0];
  const current = jobs.request(mesh, "new", {});
  assert.equal(await stale.promise, null);
  assert.equal(oldWorker.terminated, true);
  oldWorker.finish({ positions: new Float32Array([1]) });
  assert.equal(redraws, 0);
  harness.workers[1].finish({ positions: new Float32Array([2]) });
  assert.equal((await current.promise).positions[0], 2);
  jobs.dispose();
});

test("motion changes preserve an active topology build and evaluate only the latest queued frame", async () => {
  const harness = hostHarness();const jobs = createMeshJobs("source", harness.host), mesh = {};
  const first = jobs.request(mesh, "frame:0", { buildKey: "topology:1", sourceId: 1 });
  const obsolete = jobs.request(mesh, "frame:1", { buildKey: "topology:1", sourceId: 1 });
  const latest = jobs.request(mesh, "frame:2", { buildKey: "topology:1", sourceId: 1 });
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.workers[0].terminated, false);
  assert.equal(await obsolete.promise, null);
  harness.workers[0].finish({ positions: new Float32Array([0]) });
  assert.equal((await first.promise).positions[0], 0);
  assert.equal(jobs.latest("topology:1"), first, "preview may reuse a completed result of this topology");
  assert.equal(harness.workers[0].messages.length, 2, "obsolete queued motion is never dispatched");
  harness.workers[0].finish({ positions: new Float32Array([2]) });
  assert.equal((await latest.promise).positions[0], 2);
  jobs.dispose();
});

test("a topology edit or object unload cancels a preserved build with no remaining consumer", async () => {
  for (const operation of ["edit", "unload"]) {
    const harness = hostHarness();const jobs = createMeshJobs("source", harness.host), mesh = {};
    const first = jobs.request(mesh, "old-frame", { buildKey: "old-topology", sourceId: 1 });
    const queued = jobs.request(mesh, "latest-frame", { buildKey: "old-topology", sourceId: 1 });
    if (operation === "edit") jobs.request(mesh, "changed-frame", { buildKey: "changed-topology", sourceId: 1 });
    else jobs.release(mesh);
    assert.equal(harness.workers[0].terminated, true);
    assert.equal(await first.promise, null);
    assert.equal(await queued.promise, null);
    jobs.dispose();
  }
});

test("queued unused jobs are removed and disposal settles every waiter", async () => {
  const harness = hostHarness(); const jobs = createMeshJobs("source", harness.host);
  const a = {}, b = {}, c = {};
  const first = jobs.request(a, "a", {});
  const second = jobs.request(b, "b", {});
  const third = jobs.request(c, "c", {});
  jobs.release(b);
  assert.equal(await second.promise, null);
  assert.equal(harness.workers[0].messages.length, 1);
  jobs.dispose(); jobs.dispose();
  assert.equal(await first.promise, null);
  assert.equal(await third.promise, null);
  assert.deepEqual(jobs.stats(), { entries: 0, consumers: 0, bytes: 0, running: false, disposed: true });
});

test("unused frame results are bounded by count and bytes", () => {
  const harness = hostHarness(); const jobs = createMeshJobs("source", harness.host);
  for (let i = 0; i < 10; i++) {
    const mesh = {};
    jobs.request(mesh, String(i), {});
    harness.workers[0].finish({ positions: new Float32Array(10) });
    jobs.release(mesh);
  }
  assert.equal(jobs.stats().entries, 4);
  assert.equal(jobs.stats().bytes, 160);
  const mesh = {};
  jobs.request(mesh, "oversize", {});
  harness.workers[0].finish({ positions: new Uint8Array(97 * 1024 * 1024) });
  jobs.release(mesh);
  assert.equal(jobs.stats().bytes, 0);
  jobs.dispose();
});

test("worker errors reject frame preparation and cleanup still completes", async () => {
  const harness = hostHarness(); const jobs = createMeshJobs("source", harness.host);
  const mesh = {}, entry = jobs.request(mesh, "key", {});
  harness.workers[0].finish(null, "invalid geometry");
  await assert.rejects(entry.promise, /invalid geometry/);
  assert.throws(() => jobs.request(mesh, "key", {}), /invalid geometry/);
  jobs.dispose();
});

test("unloading the last source owner removes cached frames and tells the worker to forget topology", () => {
  const harness = hostHarness(); const jobs = createMeshJobs("source", harness.host);
  const mesh = {};
  jobs.request(mesh, "1:frame", { sourceId: 1 });
  harness.workers[0].finish({ positions: new Float32Array(10) });
  jobs.release(mesh);jobs.forget(1);
  assert.equal(jobs.stats().entries, 0);
  assert.equal(jobs.stats().bytes, 0);
  assert.deepEqual(harness.workers[0].messages.at(-1), { forgetSourceId: 1 });
  jobs.dispose();
});

function tetrahedron() {
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  return new Float32Array(faces.flatMap(face => face.flatMap(i => corners[i])));
}

function fractureInput() {
  const positions = tetrahedron();
  return { base: { positions, attributes: {}, count: positions.length / 3, index: null, groups: [], uvs: null, smooth: false, kind: "source" },
    sourceId: 1, polygonCount: 1, commands: [{ kind: "fracture", topology: { cells: 8, seed: 3, closed: true }, motion: { distance: 0.2, scatter: 0.1, spin: 0.3, offset: 5 },
      relation: { identity: true } }] };
}

test("worker evaluation matches the synchronous topology and motion exactly across render orders", () => {
  const input = fractureInput(); const command = input.commands[0];
  const stage = fracture.buildVoronoiFracture(input.base, command.topology);
  const expected = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, command.motion, null);
  const cache = createStageCache();
  assert.deepEqual(evaluateMesh(input, cache).positions, expected);
  for (const distance of [0.1, 0.8, 0.4, 0.2]) evaluateMesh({ ...input, commands: [{ ...command, motion: { ...command.motion, distance } }] }, cache);
  assert.deepEqual(evaluateMesh(input, cache).positions, expected);
  assert.deepEqual(evaluateMesh(input, cache).attributes.color.array, stage.attributes.color.array);
});

test("topology cache evicts by byte budget and does not keep oversized stages", () => {
  const cache = createStageCache(16); let builds = 0;
  const build = () => { builds++; return new Uint8Array(10); };
  cache.get("a", build); cache.get("a", build);
  assert.equal(builds, 1);
  cache.get("b", build); cache.get("a", build);
  assert.equal(builds, 3);
  cache.get("large", () => new Uint8Array(20));
  cache.get("a", build);
  assert.equal(builds, 4);
  cache.get("1:stage", build);cache.forget(1);cache.get("1:stage", build);
  assert.equal(builds, 6, "unloaded source stages cannot survive in the worker cache");
});

test("bundled Blob worker source executes in an actual worker without source-tree fetches", async () => {
  const sources = Object.fromEntries(["earcut", "effector-core", "effector-fracture", "effector-mesh", "effector-evaluate"].map(name =>
    [name + ".js", fs.readFileSync(path.join(__dirname, "../plugins/scene-plus", name + ".js"), "utf8")]));
  const source = createWorkerSource(sources);
  const worker = new Worker(`const {parentPort}=require("node:worker_threads");global.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);parentPort.on("message",data=>global.onmessage({data}));` + source, { eval: true });
  try {
    const input = fractureInput();
    const done = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    worker.postMessage({ id: 1, input });
    const result = await done;
    assert.equal(result.error, undefined);
    assert.deepEqual(result.value.positions, evaluateMesh(input).positions);
  } finally { await worker.terminate(); }
});
