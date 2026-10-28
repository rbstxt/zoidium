"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { host, editorFor, deferred } = require("./helpers/editor-identity-host.cjs");
const state = require("../plugins/scene-plus/scene-state.js");
const { createDeformationSupport } = require("../plugins/scene-plus/scene-deform.js");
const { createTwistClass } = require("../plugins/scene-plus/scene-effectors.js");
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { createMeshJobs } = require("../plugins/scene-plus/effector-jobs.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");

function fixture(t, useWorker, privateProject = false) {
  const { PZ, THREE } = host(), saved = { ...state };
  const project = new PZ.project();
  project.sequence.properties.load(); project.assets.unload = () => {};
  const track = new PZ.track.video(); project.sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(4); clip.start = 0; clip.length = 100; track.clips.push(clip);
  const layer = clip.object; layer.properties.load(); layer.threeObj = new THREE.Scene();
  layer.motionBlur = { update() {} };
  layer.composite.quad.material.uniforms = { opacity: { value: 1 } };
  const editor = editorFor(PZ, privateProject ? new PZ.project() : project), workers = [];
  const workerHost = {
    Blob: class {}, URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
    Worker: class {
      constructor() { workers.push(this); }
      postMessage(message) { this.message = message; }
      terminate() {}
      finish() { this.onmessage({ data: { id: this.message.id, value: evaluateMesh(this.message.input) } }); }
    },
  };
  const jobs = useWorker ? createMeshJobs("fixture", workerHost) :
    { available: false, release() {}, forget() {}, dispose() {}, pending: () => [] };
  const deformer = createMeshDeformer(THREE, jobs);
  let unloaded = false, staleDeforms = 0;
  const deform = deformer.deformMesh;
  deformer.deformMesh = (...args) => { if (unloaded) staleDeforms++; return deform(...args); };
  Object.assign(state, { library: { core: require("../plugins/scene-plus/effector-core.js") },
    meshJobs: jobs, meshDeformerThree: THREE, meshDeformerCache: deformer });
  const support = createDeformationSupport(PZ, THREE, editor); state.deformationSupport = support;
  t.after(() => { support.deactivate(); Object.assign(state, saved); });
  const Twist = createTwistClass(PZ, THREE), twist = new Twist();
  layer.objects.push(twist); twist.load({ objects: [], properties: { subdivision: 0 } });
  const gate = deferred(), entered = deferred(), source = new PZ.object3d();
  const geometry = new THREE.BoxBufferGeometry(1, 1, 1);
  source.threeObj = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  source.update = () => {};
  source.prepare = () => { entered.resolve(); return gate.promise; };
  source.unload = () => geometry.dispose();
  twist.objects.push(source); twist.threeObj.add(source.threeObj);
  return { layer, source, geometry, gate, entered, workers, staleDeforms: () => staleDeforms,
    unload() {
      clip.unload(); track.clips.splice(0, 1); unloaded = true;
      assert.equal(twist.threeObj, null); assert.equal(clip.parent, null);
    } };
}

for (const useWorker of [false, true]) {
  test(`Scene.prepare cannot allocate after unload, worker=${useWorker}`, async t => {
    const h = fixture(t, useWorker);
    const preparing = h.layer.prepare(10); await h.entered.promise;
    h.unload(); h.gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    for (const worker of h.workers) worker.finish();
    await preparing;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.source.threeObj.geometry === h.geometry, true, "no detached working geometry");
    assert.equal(h.workers.length, 0, "no worker job after unload");
    assert.equal(h.staleDeforms(), 0, "no deformer call can retain the detached mesh in liveMeshes");
  });
}

test("Scene.prepare does not reevaluate after unload during worker settlement", async t => {
  const h = fixture(t, true);
  const preparing = h.layer.prepare(10); await h.entered.promise;
  h.gate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.workers.length, 1, "preparation started the mesh job before unload");
  h.unload();
  for (const worker of h.workers) worker.finish();
  await preparing;
  assert.equal(h.source.threeObj.geometry === h.geometry, true);
  assert.equal(h.workers.length, 1, "settlement cannot launch another job");
  assert.equal(h.staleDeforms(), 0, "settlement cannot allocate or retain a detached mesh");
});

test("Scene.prepare still deforms scenes of a private snapshot project", async t => {
  // The preview frame cache prepares scenes in a project that is not editor.project.
  const h = fixture(t, false, true);
  const preparing = h.layer.prepare(10);
  const entered = await Promise.race([h.entered.promise.then(() => true),
    new Promise(resolve => setTimeout(resolve, 1000, false))]);
  assert.equal(entered, true, "native child preparation runs");
  h.gate.resolve(); await preparing;
  assert.notEqual(h.source.threeObj.geometry, h.geometry, "effectors applied during private preparation");
});
