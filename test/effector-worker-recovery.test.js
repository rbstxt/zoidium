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
const { createDeformationSupport } = require("../plugins/scene-plus/scene-deform.js");
const state = require("../plugins/scene-plus/scene-state.js");

function harness(t, transportFailure = false) {
  const workers = [], badges = new Set(), statuses = [];
  let redraws = 0;
  const jobs = createMeshJobs("worker", {
    Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Worker: class {
      constructor() { workers.push(this); }
      postMessage(message) { if (transportFailure) throw new Error("injected postMessage failure"); this.message = message; }
      terminate() {}
      fail(kind = "message") {
        if (kind === "runtime") this.onerror({ message: "injected worker failure" });
        else this.onmessage({ data: { id: this.message.id, error: "injected worker failure" } });
      }
    },
  }, () => redraws++);
  const T = { ...THREE, BoxHelper: null }, deformer = createMeshDeformer(T, jobs);
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(4, 5, 6), new THREE.MeshStandardMaterial());
  const source = mesh.geometry, base = deformer.sourceStage(mesh), node = new THREE.Object3D();
  const effector = { properties: {},
    workerCommand: () => ({ kind: "fracture", topology: { cells: 8, seed: 3, closed: true },
      motion: { distance: 0.2 }, relation: { identity: true } }),
    deformPositions() {},
    setFractureJobStatus(...args) { statuses.push(args[2] || []); },
  };
  const chain = [{ node, effector }];
  const expected = evaluateMesh({ base, sourceId: base.sourceId, polygonCount: 1, commands: [effector.workerCommand()] });
  const document = { body: { appendChild: badge => badges.add(badge) }, createElement: () => ({
    style: {}, setAttribute() {}, remove() { badges.delete(this); },
  }) };
  let guard;
  class Viewport {
    constructor() { this.lastFrame = 17; this.renderer = {
      domElement: { ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, setRenderTarget() {},
    }; }
    _render() {
      this.lastFrame = NaN;
      deformer.deformMesh(mesh, chain, 0, 1);
      guard.holdIfPending([mesh]);
      this.lastFrame = 0;
    }
  }
  guard = installPreviewHold({ ui: { viewport: Viewport } }, deformer);
  t.after(() => { guard.dispose(); deformer.dispose(); });
  return { jobs, deformer, mesh, source, base, node, effector, expected, badges, statuses,
    viewport: new Viewport(), workers, redraws: () => redraws, T };
}

function assertExact(h) {
  assert.deepEqual(h.mesh.geometry.attributes.position.array, h.expected.positions);
  assert.deepEqual(h.mesh.geometry.attributes.normal.array, h.expected.attributes.normal.array);
  assert.deepEqual(h.mesh.geometry.attributes.uv.array, h.expected.attributes.uv.array);
  assert.deepEqual(h.mesh.geometry.attributes.color.array, h.expected.attributes.color.array);
  assert.deepEqual(h.mesh.geometry.groups, h.expected.groups);
}

for (const kind of ["message", "runtime"]) test(`a ${kind} worker failure redrawn twice falls back exactly without throwing or retaining its badge`, t => {
  const h = harness(t);
  h.viewport._render();
  assert.equal(h.viewport.lastFrame, 17, "an incomplete draw restores the previously presented frame");
  assert.equal(h.badges.size, 1);
  h.workers[0].fail(kind);
  assert.equal(h.redraws(), 1, "a failure also requests recovery presentation");
  assert.deepEqual(h.jobs.pending([h.mesh]), []);
  for (let i = 0; i < 2; i++) {
    assert.doesNotThrow(() => h.viewport._render());
    assert.equal(h.badges.size, 0);
    assert.equal(h.viewport.lastFrame, 0, "the recovered exact frame is presented");
    assertExact(h);
  }
  assert.equal(h.workers.length, 1, "a same-frame redraw reuses the recovered result");
});

test("postMessage failure immediately presents the same synchronous frame", t => {
  const h = harness(t, true);
  assert.doesNotThrow(() => h.viewport._render());
  assertExact(h);
  assert.equal(h.viewport.lastFrame, 0);
  assert.equal(h.badges.size, 0);
  assert.doesNotThrow(() => h.viewport._render());
  assertExact(h);
});

test("if synchronous recovery fails too, repeated preview draws use the unbroken source with a warning", t => {
  const h = harness(t);
  t.mock.method(require("../plugins/scene-plus/effector-fracture.js"), "buildVoronoiFracture", () => {
    throw new Error("injected synchronous evaluation failure");
  });
  h.viewport._render();
  h.workers[0].fail();
  for (let i = 0; i < 2; i++) {
    assert.doesNotThrow(() => h.viewport._render());
    assert.deepEqual(h.mesh.geometry.attributes.position.array, h.source.attributes.position.array);
    assert.equal(h.badges.size, 0);
    assert.equal(h.viewport.lastFrame, 0);
  }
  assert.ok(h.statuses.flat().some(code => code.includes("rendering the unbroken source")));
});

for (const synchronousFailure of [false, true]) test(`export settlement uses the same ${synchronousFailure ? "unbroken source" : "exact synchronous frame"} after a worker failure`, async t => {
  const h = harness(t), saved = { ...state };
  if (synchronousFailure) t.mock.method(require("../plugins/scene-plus/effector-fracture.js"), "buildVoronoiFracture", () => {
    throw new Error("injected synchronous evaluation failure");
  });
  const assertResult = () => synchronousFailure
    ? assert.deepEqual(h.mesh.geometry.attributes.position.array, h.source.attributes.position.array)
    : assertExact(h);
  class Scene { update() {} async prepare() {} }
  const scene = new Scene();
  h.effector.threeObj = h.node;
  h.effector.objects = [{ threeObj: h.mesh }];
  h.node.add(h.mesh);
  scene.threeObj = new THREE.Object3D(); scene.threeObj.add(h.node);
  scene.objects = [h.effector];
  Object.assign(state, { library: { core: require("../plugins/scene-plus/effector-core.js") },
    meshDeformerCache: h.deformer, meshDeformerThree: h.T, meshJobs: h.jobs });
  const support = createDeformationSupport({ layer: { scene: Scene } }, h.T, {});
  t.after(() => { support.deactivate(); Object.assign(state, saved); });
  const preparing = scene.prepare(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.workers.length, 1);
  h.workers[0].fail();
  await assert.doesNotReject(preparing);
  assertResult();
  scene.update(0); scene.update(0);
  assertResult();
  assert.deepEqual(h.jobs.pending([h.mesh]), []);
});

test("a non-pending render exception restores lastFrame and clears an existing hold badge in finally", t => {
  const badges = new Set(); let fail = false;
  const document = { body: { appendChild: b => badges.add(b) }, createElement: () => ({
    style: {}, setAttribute() {}, remove() { badges.delete(this); },
  }) };
  let guard;
  class Viewport {
    constructor() { this.lastFrame = 21; this.canvas = {
      ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }; }
    _render() { this.lastFrame = NaN; if (fail) throw new Error("render failed"); guard.hold(); }
  }
  guard = installPreviewHold({ ui: { viewport: Viewport } }, { pending: () => [] });
  t.after(() => guard.dispose());
  const viewport = new Viewport(); viewport._render();
  assert.equal(badges.size, 1);
  fail = true;
  assert.throws(() => viewport._render(), /render failed/);
  assert.equal(viewport.lastFrame, 21);
  assert.equal(badges.size, 0);
});
