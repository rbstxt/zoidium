"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { createMeshJobs } = require("../plugins/scene-plus/effector-jobs.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const { installPreviewHold } = require("../plugins/scene-plus/effector-preview.js");

test("pending cold work holds presentation through seeks, topology edits, and source replacement", () => {
  const workers = [];
  const host = { Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Worker: class {
      constructor() { workers.push(this); }
      postMessage(message) { this.message = message; }
      terminate() { this.terminated = true; }
      finish() { this.onmessage({ data: { id: this.message.id, value: evaluateMesh(this.message.input) } }); }
    } };
  const jobs = createMeshJobs("worker", host), deformer = createMeshDeformer(THREE, jobs);
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(4, 5, 6), new THREE.MeshStandardMaterial());
  let frame = 0, seed = 3, presented = 0;
  const chain = [{ node: new THREE.Object3D(), effector: {
    workerCommand: () => ({ kind: "fracture", topology: { cells: 8, seed, closed: true }, motion: { distance: frame } }),
  } }];
  let guard;
  class Viewport {
    constructor() { this.lastFrame = 19; }
    _render() {
      deformer.deformMesh(mesh, chain, frame, 1);
      guard.holdIfPending([mesh]);
      presented++;
      this.lastFrame = frame;
    }
  }
  const originalRender = Viewport.prototype._render;
  const viewport = new Viewport(), source = mesh.geometry;
  // Motion Path installs an instance wrapper before Effector activation.
  const ownRender = function (...args) { return originalRender.apply(this, args); };
  viewport._render = ownRender;
  guard = installPreviewHold({ ui: { viewport: Viewport } }, deformer, { mainViewport: viewport });
  viewport._render();
  assert.equal(presented, 0);
  assert.equal(viewport.lastFrame, 19);
  assert.equal(mesh.geometry, source, "no placeholder is assigned or drawn");
  assert.equal(jobs.pending([mesh]).length, 1);
  workers.at(-1).finish();
  viewport._render();
  assert.equal(presented, 1);
  assert.equal(viewport.lastFrame, 0);
  frame = 1;
  mesh.geometry = source; // Native updates can restore the same source each time.
  viewport._render();
  const active = workers.at(-1);
  mesh.geometry = source;
  viewport._render();
  assert.equal(active.terminated, undefined, "source restoration cannot restart an exact cold build");
  assert.equal(presented, 1);
  assert.equal(viewport.lastFrame, 0);
  assert.equal(mesh.geometry, source, "a pending result never publishes a replacement mesh");
  frame = 2;
  viewport._render();
  workers.at(-1).finish(); // The obsolete warm job cannot present frame 1.
  assert.equal(presented, 1);
  workers.at(-1).finish();
  viewport._render();
  assert.equal(presented, 2);
  assert.equal(viewport.lastFrame, 2);
  const expected = evaluateMesh(workers.at(-1).message.input);
  assert.deepEqual(mesh.geometry.attributes.position.array, expected.positions);
  assert.deepEqual(mesh.geometry.attributes.normal.array, expected.attributes.normal.array);
  seed = 5;
  viewport._render();
  assert.equal(presented, 2, "topology edits hold the canvas too");
  workers.at(-1).finish(); viewport._render();
  assert.equal(presented, 3);
  mesh.geometry = new THREE.BoxBufferGeometry(6, 7, 8);
  viewport._render();
  viewport._render();
  assert.equal(presented, 3, "repeated updates do not cancel an edited source's cold job");
  workers.at(-1).finish(); viewport._render();
  assert.equal(presented, 4);
  guard.dispose(); deformer.dispose();
  assert.equal(Viewport.prototype._render, originalRender);
  assert.equal(viewport._render, ownRender, "restore the prior instance wrapper too");
  assert.equal(jobs.stats().entries, 0);
});


test("a later instance wrapper can retain a disposed prototype guard without blocking or clearing an outer hold", () => {
  let pending = true, draws = 0;
  class Viewport {
    _render() { guard.holdIfPending([]); draws++; }
  }
  const deformer = { pending: () => pending ? [Promise.resolve()] : [] };
  let guard = installPreviewHold({ ui: { viewport: Viewport } }, deformer);
  const viewport = new Viewport(), captured = viewport._render;
  viewport._render = function () { return captured.call(this); };
  // The new installation wraps a method that already retains a prototype guard.
  const next = installPreviewHold({ ui: { viewport: Viewport } }, deformer, { mainViewport: viewport });
  guard.dispose();
  guard = next;
  viewport._render();
  assert.equal(draws, 0);
  pending = false;
  viewport._render();
  assert.equal(draws, 1);
  next.dispose();
});
