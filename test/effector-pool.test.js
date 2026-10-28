"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createMeshJobs } = require("../plugins/scene-plus/effector-jobs.js");
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");

function harness(cores = 8) {
  const workers = [], revoked = [];
  const host = {
    navigator: { hardwareConcurrency: cores }, Blob: class {},
    URL: { createObjectURL: () => "blob:" + workers.length, revokeObjectURL: url => revoked.push(url) },
    Worker: class {
      constructor() { this.messages = []; workers.push(this); }
      postMessage(message) { this.messages.push(message); }
      terminate() { this.terminated = true; }
      finish(value = { positions: new Float32Array([1]) }) {
        const message = this.messages.findLast(item => item.input);
        this.onmessage({ data: { id: message.id, value } });
      }
    },
  };
  let redraws = 0;
  const jobs = createMeshJobs("source", host, () => redraws++);
  return { jobs, workers, revoked, redraws: () => redraws };
}

function request(jobs, consumer, source, frame = 0, topology = 1) {
  return jobs.request(consumer, source + ":" + topology + ":" + frame,
    { sourceId: source, buildKey: source + ":topology:" + topology });
}

test("the pool uses spare cores up to four and partitions the existing 64 MiB stage budget", () => {
  for (const [cores, expected] of [[1, 1], [2, 1], [3, 2], [8, 4]]) {
    const { jobs, workers } = harness(cores);
    const meshes = Array.from({ length: 7 }, () => ({}));
    meshes.forEach((mesh, i) => request(jobs, mesh, i));
    assert.equal(workers.length, expected);
    assert.equal(workers.reduce((sum, worker) => sum + worker.messages[0].cacheBytes, 0), 64 * 1024 * 1024);
    assert.equal(jobs.pending(meshes).length, 7);
    workers[0].finish();
    assert.equal(workers[0].messages.length, 2, "the next waiting source starts as soon as one worker finishes");
    jobs.dispose();
    assert.ok(workers.every(worker => worker.terminated));
  }
});

test("source affinity preserves in-flight motion and cached topology while other meshes run", async () => {
  const { jobs, workers } = harness();
  const mesh = {}, other = {};
  const cold = request(jobs, mesh, 1);
  const moving = request(jobs, mesh, 1, 1);
  const unrelated = request(jobs, other, 2);
  assert.equal(workers.length, 2, "a newer motion frame cannot start a duplicate cold build");
  assert.equal(workers[0].messages.length, 1);
  workers[1].finish();
  jobs.release(other);
  assert.equal(workers[0].terminated, undefined, "releasing another source cannot cancel the preserved build");
  workers[0].finish();
  assert.ok(await cold.promise);
  assert.equal(workers[0].messages.length, 2);
  workers[0].finish();
  await moving.promise; await unrelated.promise;
  jobs.release(mesh);
  request(jobs, mesh, 1, 2, 2);
  assert.equal(workers[0].messages.length, 3, "parameter edits reuse the source's worker");
  jobs.dispose();
});

test("topology cancellation terminates only its worker and ignores stale messages", async () => {
  const { jobs, workers, redraws } = harness();
  const a = {}, b = {};
  const old = request(jobs, a, 1), other = request(jobs, b, 2);
  const stale = workers[0];
  const latest = request(jobs, a, 1, 0, 2);
  assert.equal(await old.promise, null);
  assert.equal(stale.terminated, true);
  assert.equal(workers[1].terminated, undefined);
  stale.finish();
  assert.equal(redraws(), 0);
  workers[2].finish(); workers[1].finish();
  assert.ok(await latest.promise); assert.ok(await other.promise);
  assert.equal(redraws(), 2);
  jobs.dispose();
});

test("unload, queued cancellation, and dispose settle all waiters across the pool", async () => {
  const { jobs, workers, revoked } = harness(3);
  const a = {}, b = {}, c = {};
  const entries = [request(jobs, a, 1), request(jobs, b, 2), request(jobs, c, 3)];
  jobs.release(c);
  assert.equal(await entries[2].promise, null);
  jobs.release(a); jobs.forget(1);
  assert.equal(await entries[0].promise, null);
  assert.equal(workers[0].terminated, true);
  jobs.dispose(); jobs.dispose();
  assert.equal(await entries[1].promise, null);
  assert.equal(revoked.length, 2);
  assert.equal(jobs.request({}, "disposed", {}), null);
  assert.deepEqual(jobs.stats(), { entries: 0, consumers: 0, bytes: 0, running: false, disposed: true });
});

test("one worker failure leaves other results exact and recovers its mesh synchronously", async () => {
  for (const failure of ["message", "runtime"]) {
    const { jobs, workers } = harness();
    const deformer = createMeshDeformer(THREE, jobs);
    const meshes = [1, 2].map(size => new THREE.Mesh(new THREE.BoxBufferGeometry(size, 3, 4), new THREE.MeshStandardMaterial()));
    const command = { kind: "fracture", topology: { cells: 8, seed: 7, closed: true }, motion: { distance: 0.2, spin: 0.3 } };
    const chain = [{ node: new THREE.Object3D(), effector: { workerCommand: () => command } }];
    for (const mesh of meshes) deformer.deformMesh(mesh, chain, 0, 1);
    const expected = workers.map(worker => evaluateMesh(worker.messages[0].input));
    const failed = jobs.pending(meshes)[0];
    if (failure === "runtime") workers[0].onerror({ message: "pool runtime failure" });
    else workers[0].onmessage({ data: { id: workers[0].messages[0].id, error: "pool message failure" } });
    await assert.rejects(failed, /pool .* failure/);
    assert.equal(workers[1].terminated, undefined);
    workers[1].finish(expected[1]);
    for (const [i, mesh] of meshes.entries()) {
      deformer.deformMesh(mesh, chain, 0, 1);
      assert.deepEqual(mesh.geometry.attributes.position.array, expected[i].positions);
      for (const name of ["normal", "uv", "color"]) assert.deepEqual(mesh.geometry.attributes[name]?.array, expected[i].attributes[name]?.array);
      assert.deepEqual(mesh.geometry.groups, expected[i].groups);
    }
    deformer.dispose();
  }
});

test("new topology uses an idle worker when its source's previous worker is busy", () => {
  const { jobs, workers } = harness(3);
  const a = {}, b = {}, c = {};
  request(jobs, a, 1); request(jobs, b, 2);
  workers[0].finish(); workers[1].finish(); jobs.release(a); jobs.release(b);
  request(jobs, c, 3);
  request(jobs, a, 1, 0, 2);
  assert.equal(workers[0].messages.at(-1).input.sourceId, 3);
  assert.equal(workers[1].messages.at(-1).input.sourceId, 1);
  assert.equal(jobs.pending([a, c]).length, 2);
  jobs.dispose();
});

test("fracture loading can prewarm the bounded pool before the first mesh request", () => {
  const { jobs, workers } = harness();
  jobs.prewarm(); jobs.prewarm();
  assert.equal(workers.length, 4);
  assert.ok(workers.every(worker => !worker.messages.length));
  assert.equal(jobs.stats().running, false);
  request(jobs, {}, 1);
  assert.equal(workers.length, 4);
  assert.equal(workers[0].messages.length, 1);
  jobs.dispose(); jobs.prewarm();
  assert.equal(workers.length, 4);
});
