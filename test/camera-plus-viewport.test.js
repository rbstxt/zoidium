"use strict";

// Camera+ and the editor viewport: like the stock CM3 camera, Camera+ must
// behave as a free orbit view in edit mode. The runtime hooks the compositor
// path only (RenderPass render, scene update/unload) and must never patch
// PZ.ui.viewport.prototype._render, even when the host exposes it.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";

function setup() {
  const ctx = harness.createContext();
  // A minimal viewport host, as exposed by CM3. The runtime must leave it
  // alone: edit mode orbits freely whether or not a Camera+ is present.
  const fallbackCalls = [];
  ctx.PZ.ui.viewport = class FakeViewport {};
  ctx.PZ.ui.viewport.prototype._render = function () {
    fallbackCalls.push("original");
    this.lastFrame = "original";
  };
  const runtime = harness.loadRuntime();
  const scene = new ctx.PZ.layer.scene();
  const vanilla = new ctx.PZ.object3d.camera();
  scene.push(vanilla);
  scene.pass.camera = vanilla.threeObj;
  return { ctx, runtime, scene, vanilla, fallbackCalls };
}

function addCameraPlus(ctx, scene, props = {}) {
  const object = ctx.registry.instantiate(TYPE);
  for (const [key, value] of Object.entries(props)) object.properties[key].set(value);
  scene.push(object);
  return object;
}

test("activation never patches the viewport render", () => {
  const { ctx, runtime, fallbackCalls } = setup();
  const original = ctx.PZ.ui.viewport.prototype._render;
  runtime.activate(ctx.context);
  assert.equal(ctx.PZ.ui.viewport.prototype._render, original, "edit viewport left untouched");
  assert.deepEqual(fallbackCalls, [], "no render happened during activation");
  runtime.deactivate();
  assert.equal(ctx.PZ.ui.viewport.prototype._render, original, "viewport render still untouched");
});

test("activation without a viewport host still succeeds", () => {
  const ctx = harness.createContext();
  assert.equal(ctx.PZ.ui.viewport, undefined, "harness has no viewport");
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  assert.equal(ctx.registry.isRegistered(TYPE), true);
  runtime.deactivate();
});

test("an active Camera+ syncs the scene pass while the viewport keeps orbiting", () => {
  const { ctx, runtime, scene, vanilla, fallbackCalls } = setup();
  const original = ctx.PZ.ui.viewport.prototype._render;
  runtime.activate(ctx.context);
  const cameraPlus = addCameraPlus(ctx, scene, { active: 1 });
  scene.update(5);
  assert.equal(scene.pass.camera, cameraPlus.threeObj, "compositor path uses the Camera+");
  assert.notEqual(vanilla.threeObj, cameraPlus.threeObj, "the CM3 camera object is untouched");
  assert.equal(ctx.PZ.ui.viewport.prototype._render, original, "viewport render never patched");
  assert.deepEqual(fallbackCalls, [], "viewport rendering stays the host's business");
  runtime.deactivate();
  assert.equal(scene.pass.camera, vanilla.threeObj, "disable hands the pass back to the CM3 camera");
  assert.equal(ctx.PZ.ui.viewport.prototype._render, original);
});

test("the runtime sources reference no viewport render path", () => {
  for (const name of ["camera-runtime.js", "scene-dof.js"]) {
    const source = harness.readPluginSource(name);
    assert.equal(/_render/.test(source), false, `${name} never touches the viewport render`);
    assert.equal(/renderToScreen/.test(source), false, `${name} has no viewport-only composite`);
  }
});
