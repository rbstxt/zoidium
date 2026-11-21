"use strict";

// A Scene that holds only Camera+ must be renderable on its first frame. CM3's
// compositor skips a Scene whose pass.camera is unset before it calls
// layer.update, so Camera+ publishes to the owning Scene during load instead of
// waiting for the first update. Nested groups, pasted scenes, and removal are
// covered here.

const assert = require("node:assert/strict");
const test = require("node:test");
const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";

function activate() {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  return { ctx, runtime };
}

function cameraJSON(active) {
  const properties = active === undefined ? {} : { active };
  return { type: TYPE, schemaVersion: 1, properties };
}

function loadScene(ctx, objects) {
  const scene = new ctx.PZ.layer.scene();
  scene.load({ properties: {}, objects });
  return scene;
}

test("a pasted Scene with only a nested Camera+ publishes its camera before update", () => {
  const { ctx, runtime } = activate();
  const scene = loadScene(ctx, [
    { type: 5, properties: {}, objects: [cameraJSON()] },
  ]);

  const group = scene.objects[0];
  const camera = group.objects[0];
  assert.equal(camera.type, TYPE);
  assert.equal(scene.pass.camera, camera.threeObj, "the pass has a camera at load");
  assert.deepEqual(scene.updates, [], "no scene update ran");
  runtime.deactivate();
});

test("opening a project keeps the camera its Scene published during load", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  let projectChanged;
  ctx.PZ.project = class FakeProject extends ctx.PZ.object {};
  ctx.editor.project = new ctx.PZ.project();
  ctx.editor.onProjectChanged = {
    watch(callback) { projectChanged = callback; },
    unwatch() {},
  };
  runtime.activate(ctx.context);
  try {
    const previousScene = loadScene(ctx, [cameraJSON()]);
    previousScene.parent = ctx.editor.project;
    const incoming = new ctx.PZ.project();
    const scene = new ctx.PZ.layer.scene();
    scene.parent = incoming;
    scene.load({ properties: {}, objects: [{ type: 5, properties: {}, objects: [cameraJSON()] }] });
    const camera = scene.objects[0].objects[0];
    assert.equal(scene.pass.camera, camera.threeObj, "the incoming Scene publishes its camera during load");

    ctx.editor.project = incoming;
    projectChanged();

    assert.equal(previousScene.pass.camera, null, "the previous project's Scene releases its camera");
    assert.ok(scene.pass.camera === camera.threeObj, "CM3 can render the incoming Scene before updating it");
    assert.deepEqual(scene.updates, [], "opening does not evaluate the Scene");
  } finally {
    runtime.deactivate();
  }
});

test("a Camera+ added to an open Scene publishes immediately", () => {
  const { ctx, runtime } = activate();
  const scene = loadScene(ctx, []);
  assert.equal(scene.pass.camera, null);

  const camera = ctx.registry.instantiate(TYPE);
  camera.parent = scene.objects;
  scene.objects.push(camera);
  camera.load(cameraJSON());

  assert.equal(scene.pass.camera, camera.threeObj);
  assert.deepEqual(scene.updates, [], "no scene update ran");
  runtime.deactivate();
});

test("an inactive Camera+ leaves the pass camera untouched", () => {
  const { ctx, runtime } = activate();
  const scene = loadScene(ctx, [cameraJSON(0)]);
  const camera = scene.objects[0];

  assert.equal(camera.isActive(), false);
  assert.equal(scene.pass.camera, null);
  runtime.deactivate();
});

test("a native camera keeps the pass when Camera+ is absent", () => {
  const { ctx, runtime } = activate();
  const scene = loadScene(ctx, [{ type: 6, objectType: 1, properties: {} }]);
  const native = scene.objects[0];

  assert.equal(scene.pass.camera, native.threeObj);
  runtime.deactivate();
});

test("removing the only Camera+ clears the pass camera", () => {
  const { ctx, runtime } = activate();
  const scene = loadScene(ctx, [cameraJSON()]);
  const camera = scene.objects[0];
  assert.equal(scene.pass.camera, camera.threeObj);

  camera.unload();
  assert.equal(scene.pass.camera, null, "no native camera remains");
  runtime.deactivate();
});

test("deactivation restores the Scene methods it patched", () => {
  const { ctx, runtime } = activate();
  const { PZ } = ctx;
  const patchedLoad = PZ.layer.scene.prototype.load;
  runtime.deactivate();
  assert.notEqual(PZ.layer.scene.prototype.load, patchedLoad);
});
