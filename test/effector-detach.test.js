"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const state = require("../plugins/scene-plus/scene-state.js");
const { createEffectorBaseClass } = require("../plugins/scene-plus/scene-effectors.js");
const { createDeformationSupport } = require("../plugins/scene-plus/scene-deform.js");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(t) {
  class Project {}
  class Scene { update() {} }
  class ObjectList extends Array {
    constructor() { super(); this.onListChanged = { watch() {}, unwatch() {} }; }
  }
  class Object3D {
    constructor() {
      this.children = [];
      this.properties = { enabled: {}, addAll() {} };
    }
    tryGetParentOfType(Type) {
      for (let parent = this.parent; parent; parent = parent.parent) {
        if (parent instanceof Type) return parent;
      }
      return null;
    }
    get parentLayer() {
      const layer = this.tryGetParentOfType(Scene);
      if (!layer) throw new TypeError("Cannot read properties of null (reading 'parentObject')");
      return layer;
    }
  }
  const PZ = { object3d: Object3D, objectList: ObjectList, layer: Scene, project: Project };
  PZ.layer.scene = Scene;
  const THREE = {};
  const saved = { ...state }, calls = [];
  state.meshJobs = {};
  state.meshDeformerThree = THREE;
  state.meshDeformerCache = { pending: () => [], dispose() {}, restoreMesh() {}, restoreTree() {} };
  state.library = { core: require("../plugins/scene-plus/effector-core.js") };
  const support = createDeformationSupport(PZ, THREE);
  state.deformationSupport = support;
  const Effector = createEffectorBaseClass(PZ, THREE);
  const effector = new Effector();
  const layer = new Scene();
  layer.parent = new Project();
  layer.threeObj = { updateMatrixWorld() { calls.push("matrices"); } };
  effector.parent = layer;
  effector.threeObj = {};
  effector.update = () => calls.push("update");
  t.after(() => { support.deactivate(); Object.assign(state, saved); });
  return { effector, layer, support, calls };
}

for (const phase of ["loading", "prepare"]) {
  test(`Effector removal while child ${phase} awaits stops preparation`, async t => {
    const h = harness(t), gate = deferred(), started = deferred();
    const child = {
      loading: phase === "loading" ? gate.promise : undefined,
      prepare() { h.calls.push("child prepare"); started.resolve(); return phase === "prepare" ? gate.promise : undefined; },
      unload() {},
    };
    h.effector.objects.push(child);
    const preparing = h.effector.prepare(12);
    if (phase === "prepare") await started.promise;
    h.effector.unload();
    h.effector.parent = null;
    h.calls.length = 0;
    gate.resolve();
    await preparing;
    assert.deepEqual(h.calls, []);
  });
}

test("unload invalidates an old prepare even when the Effector is attached again", async t => {
  const h = harness(t), gate = deferred(), started = deferred();
  h.effector.objects.push({ prepare() { started.resolve(); return gate.promise; }, unload() {} });
  const preparing = h.effector.prepare(12);
  await started.promise;
  h.effector.unload();
  h.effector.threeObj = {};
  gate.resolve();
  await preparing;
  assert.deepEqual(h.calls, []);
  await h.effector.prepare(13);
  assert.deepEqual(h.calls, ["update", "matrices"]);
});

test("removal without unload stops the pending Effector preparation", async t => {
  const h = harness(t), gate = deferred(), started = deferred();
  h.effector.objects.push({ prepare() { started.resolve(); return gate.promise; } });
  const preparing = h.effector.prepare(12);
  await started.promise;
  h.effector.parent = null;
  gate.resolve();
  await preparing;
  assert.deepEqual(h.calls, []);
});

test("prepareObject skips detached ancestry before updating the object", async t => {
  const h = harness(t);
  h.effector.parent = null;
  await h.support.prepareObject(h.effector, 12);
  assert.deepEqual(h.calls, []);
});

for (const operation of ["unload", "detach", "detach layer"]) {
  test(`mesh completion after Effector ${operation} does not evaluate again`, async t => {
    const h = harness(t), gate = deferred();
    let evaluations = 0;
    state.meshDeformerCache.pending = () => ++evaluations === 1 ? [gate.promise] : [];
    Object.defineProperty(h.effector, "objects", { get() { h.calls.push("objects"); return []; } });
    const preparing = h.support.prepareObject(h.effector, 12);
    if (operation === "unload") { h.effector.unload(); h.effector.threeObj = {}; }
    else if (operation === "detach") h.effector.parent = null;
    else h.layer.parent = null;
    h.calls.length = 0;
    gate.resolve();
    await preparing;
    assert.deepEqual(h.calls, []);
  });
}

test("attached preparation keeps child order and propagates render failures", async t => {
  const h = harness(t);
  h.effector.objects.push(...[1, 2].map(id => ({
    loading: Promise.resolve(), prepare(frame) { h.calls.push([id, frame]); },
  })));
  await h.effector.prepare(12);
  assert.deepEqual(h.calls, [[1, 12], [2, 12], "update", "matrices"]);
  const failure = new Error("attached render failed");
  h.effector.update = () => { throw failure; };
  await assert.rejects(h.effector.prepare(13), error => error === failure);
});
