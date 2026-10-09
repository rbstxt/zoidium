"use strict";

// Camera+ lifecycle: the plugin adds a separate object type and never replaces
// the CM3 camera, compositor, or sequence code. Disabling restores every
// patched member, and a failed activation rolls back.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";

function snapshot(PZ, THREE) {
  return {
    camera: PZ.object3d.camera,
    cameraDefinitions: Object.keys(PZ.object3d.camera.propertyDefinitions).sort(),
    layerCamera: PZ.layer.camera,
    layerDefinitions: Object.keys(PZ.layer.propertyDefinitions).sort(),
    vibrate: PZ.vibrate,
    layerCreate: PZ.layer.create,
    sceneUpdate: PZ.layer.scene.prototype.update,
    sceneUnload: PZ.layer.scene.prototype.unload,
    renderPass: THREE.RenderPass.prototype.render,
    renderLayer: PZ.compositor.prototype.renderLayer,
    renderSequence: PZ.compositor.prototype.renderSequence,
    sequenceUpdate: PZ.sequence.prototype.update,
    expressionMethods: Object.keys(PZ.expression.methods).sort(),
  };
}

test("activation adds a namespaced object type and leaves CM3 camera code alone", () => {
  const ctx = harness.createContext();
  const before = snapshot(ctx.PZ, ctx.THREE);
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);

  assert.equal(ctx.registry.isRegistered(TYPE), true, "Camera+ type registered");
  assert.equal(ctx.PZ.object3d.camera, before.camera, "CM3 camera class is not replaced");
  assert.deepEqual(Object.keys(ctx.PZ.object3d.camera.propertyDefinitions).sort(), before.cameraDefinitions);
  assert.equal(ctx.PZ.layer.camera, undefined, "no Camera layer class is added");
  assert.deepEqual(Object.keys(ctx.PZ.layer.propertyDefinitions).sort(), before.layerDefinitions);
  assert.equal(ctx.PZ.vibrate, undefined, "vibrate is not a global CM3 class");
  assert.equal(ctx.PZ.compositor.prototype.renderLayer, before.renderLayer, "compositor renderLayer untouched");
  assert.equal(ctx.PZ.compositor.prototype.renderSequence, before.renderSequence, "compositor renderSequence untouched");
  assert.equal(ctx.PZ.sequence.prototype.update, before.sequenceUpdate, "sequence update untouched");
  assert.equal(ctx.PZ.sequence.prototype.getSharedCamera, undefined, "no sequence tracking methods");
  assert.deepEqual(Object.keys(ctx.PZ.expression.methods).sort(), ["add", "focusDistanceTo"]);

  runtime.deactivate();
});

test("the Camera+ registration is declared as a Camera picker child", () => {
  const manifest = JSON.parse(harness.readPluginSource("manifest.json"));
  assert.equal(manifest.kind, "object");
  assert.deepEqual(manifest.objectClassParent, { name: "Camera", type: 6 });
  assert.equal(manifest.objectClasses.length, 1);
  assert.equal(manifest.objectClasses[0].type, TYPE);
  assert.equal(manifest.objectClasses[0].schemaVersion, 1);
});

test("the registered factory builds a loadable Camera+ with its own threeObj", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);

  const object = ctx.registry.instantiate(TYPE);
  assert.equal(object.type, TYPE);
  assert.notEqual(object.threeObj, ctx.PZ.object3d.camera.prototype.threeObj);
  assert.equal(object.threeObj.isPerspectiveCamera, true);
  assert.equal(typeof object.load, "function");
  assert.notEqual(object.load, ctx.PZ.object3d.prototype.load, "custom load required by the registry");
  object.load({ type: TYPE, schemaVersion: 1, properties: {} });
  assert.deepEqual(object.toJSON().type, TYPE);
  assert.equal(object.toJSON().schemaVersion, 1);
  runtime.deactivate();
});

test("deactivate restores every patched member and unregisters the object type", () => {
  const ctx = harness.createContext();
  const before = snapshot(ctx.PZ, ctx.THREE);
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  assert.notEqual(ctx.THREE.RenderPass.prototype.render, before.renderPass, "render hook installed while active");

  runtime.deactivate();
  const after = snapshot(ctx.PZ, ctx.THREE);
  assert.deepEqual(after, before, "all CM3 members are back to their original references");
  assert.equal(ctx.registry.isRegistered(TYPE), false);
  assert.equal(ctx.apis.propertyControls.registered.size, 0, "property control removed");
});

test("deactivate is idempotent and activation can run again after it", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  runtime.deactivate();
  runtime.deactivate();
  runtime.activate(ctx.context);
  assert.equal(ctx.registry.isRegistered(TYPE), true);
  runtime.deactivate();
  assert.equal(ctx.registry.isRegistered(TYPE), false);
});

test("a failed property-control registration rolls back every earlier change", () => {
  const ctx = harness.createContext();
  ctx.apis.propertyControls.register = function () {
    throw new Error("controls unavailable");
  };
  const before = snapshot(ctx.PZ, ctx.THREE);
  const runtime = harness.loadRuntime();
  assert.throws(() => runtime.activate(ctx.context), /controls unavailable/);
  assert.deepEqual(snapshot(ctx.PZ, ctx.THREE), before, "no CM3 member left patched");
  assert.equal(ctx.registry.isRegistered(TYPE), false, "object type rolled back");
});

test("missing CM3 members fail before anything is changed", () => {
  const ctx = harness.createContext();
  ctx.PZ.layer.scene.prototype.update = undefined;
  const before = snapshot(ctx.PZ, ctx.THREE);
  const runtime = harness.loadRuntime();
  assert.throws(() => runtime.activate(ctx.context), /PZ\.layer\.scene/);
  assert.deepEqual(snapshot(ctx.PZ, ctx.THREE), before);
  assert.equal(ctx.registry.isRegistered(TYPE), false);
});

test("the lifecycle registers its teardown with the plugin manager", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  assert.equal(ctx.disposers.length, 1);
  assert.equal(ctx.registry.isRegistered(TYPE), true);
  ctx.disposers[0]();
  assert.equal(ctx.registry.isRegistered(TYPE), false);
  runtime.deactivate();
});

test("isInUse is true only while a legacy Davidium Camera layer is in the project", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  assert.equal(runtime.isInUse(), false);

  const legacy = ctx.PZ.layer.create(9);
  assert.equal(legacy.type, 9);
  ctx.project.register([0, 0], legacy);
  assert.equal(runtime.isInUse(), true);

  ctx.project.byAddress.clear();
  assert.equal(runtime.isInUse(), false);
  runtime.deactivate();
  assert.equal(runtime.isInUse(), false, "no project checks after deactivate");
});

test("Camera+ sources avoid frame history, wall clock, randomness, and body-level UI", () => {
  const sources = ["camera-runtime.js", "vibrate.js", "scene-dof.js", "camera-class.js", "focus-ui.js"];
  const forbidden = [
    /Math\.random/,
    /Date\.now|performance\.now|requestAnimationFrame/,
    /PZ\.compositor\.prototype\.(renderLayer|renderSequence)\s*=/,
    /PZ\.sequence\.prototype\.(collectSceneEntries|getSharedCamera|applySharedCamera)/,
    /document\.body\.appendChild/,
    /window\.open\(/,
    /applyVideoMotionBlur|videoBlurPass|_mbPool/,
    /\bdefineFrameSampler\b/,
    /PZ\.vibrate\s*=/,
  ];
  for (const name of sources) {
    const source = harness.readPluginSource(name);
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${name} must not match ${pattern}`);
    }
  }
  assert.equal(fs.existsSync(path.join(harness.pluginDir, "camera-layer.js")), false);
  assert.equal(fs.existsSync(path.join(harness.pluginDir, "render-layer.js")), false);
  assert.equal(fs.existsSync(path.join(harness.pluginDir, "render-sequence.js")), false);
  assert.equal(fs.existsSync(path.join(harness.pluginDir, "sequence-tracking.js")), false);
  assert.equal(fs.existsSync(path.join(harness.pluginDir, "depth-passes.js")), false);
});

test("every resource named by the manifest exists in the plugin directory", () => {
  const manifest = JSON.parse(harness.readPluginSource("manifest.json"));
  const sources = [manifest.modules[0].source, ...manifest.resources.map((resource) => resource.source)];
  for (const source of sources) {
    const file = source.split("?")[0].replace(/^\.\//, "");
    assert.equal(fs.existsSync(path.join(harness.projectRoot, file)), true, file);
  }
});
