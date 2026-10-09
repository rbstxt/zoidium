"use strict";

// Scene camera selection: the first active Camera+ in a scene's list order
// renders through that scene's pass. Without one, the CM3 camera stays in
// place exactly as CM3 set it. Depth of field only changes the pass when a
// Camera+ enables it.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";

function recordingRenderer() {
  return {
    calls: [],
    render(scene, camera, target, forceClear) {
      this.calls.push({ scene, camera, target, forceClear });
    },
  };
}

function setup() {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  const scene = new ctx.PZ.layer.scene();
  const vanilla = new ctx.PZ.object3d.camera();
  scene.push(vanilla);
  scene.pass.camera = vanilla.threeObj;
  const makeCameraPlus = (props = {}) => {
    const object = ctx.registry.instantiate(TYPE);
    for (const [key, value] of Object.entries(props)) object.properties[key].set(value);
    return scene.push(object);
  };
  return { ctx, runtime, scene, vanilla, makeCameraPlus };
}

test("a scene without Camera+ keeps its CM3 camera through updates and renders", () => {
  const { ctx, runtime, scene, vanilla } = setup();
  const before = scene.pass.camera;
  runtime.activate(ctx.context);
  scene.update(0);
  scene.update(7);
  assert.equal(scene.pass.camera, vanilla.threeObj);
  assert.equal(scene.pass.camera, before);
  assert.equal(scene.pass.__cameraPlusDof, undefined, "no depth-of-field state is attached");
  runtime.deactivate();
});

test("the first active Camera+ in list order wins and inactive ones are ignored", () => {
  const { ctx, runtime, scene, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const inactive = makeCameraPlus({ active: 0 });
  const first = makeCameraPlus({ active: 1 });
  const second = makeCameraPlus({ active: 1 });
  scene.update(0);
  assert.equal(scene.pass.camera, first.threeObj);
  assert.notEqual(scene.pass.camera, inactive.threeObj);

  scene.objects.splice(scene.objects.indexOf(second), 1);
  scene.objects.unshift(second);
  second.parent = scene.objects;
  scene.update(0);
  assert.equal(scene.pass.camera, second.threeObj, "list order decides, not creation order");
  runtime.deactivate();
});

test("deactivating every Camera+ hands the CM3 camera back to the scene", () => {
  const { ctx, runtime, scene, vanilla, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  scene.update(0);
  assert.equal(scene.pass.camera, cameraPlus.threeObj);

  cameraPlus.properties.active.set(0);
  scene.update(1);
  assert.equal(scene.pass.camera, vanilla.threeObj);
  runtime.deactivate();
});

test("removing the active Camera+ from the scene restores the CM3 camera", () => {
  const { ctx, runtime, scene, vanilla, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  scene.update(0);
  scene.objects.splice(scene.objects.indexOf(cameraPlus), 1);
  scene.update(0);
  assert.equal(scene.pass.camera, vanilla.threeObj);
  runtime.deactivate();
});

test("deactivating the plugin restores scenes that rendered through a Camera+", () => {
  const { ctx, runtime, scene, vanilla, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  makeCameraPlus({ active: 1 });
  scene.update(0);
  runtime.deactivate();
  assert.equal(scene.pass.camera, vanilla.threeObj);
  assert.equal(scene.pass.__cameraPlusDof, null);
});

test("selection does not depend on the previous frame", () => {
  const { ctx, runtime, scene, vanilla, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  scene.update(3);
  const withCamera = scene.pass.camera;
  cameraPlus.properties.active.set(0);
  scene.update(3);
  assert.equal(withCamera, cameraPlus.threeObj);
  assert.equal(scene.pass.camera, vanilla.threeObj);
  cameraPlus.properties.active.set(1);
  scene.update(3);
  assert.equal(scene.pass.camera, cameraPlus.threeObj);
  runtime.deactivate();
});

test("a scene renders through the Camera+ camera and leaves the default render path when DOF is off", () => {
  const { ctx, runtime, scene, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  scene.update(0);
  const renderer = recordingRenderer();
  const target = new ctx.THREE.WebGLRenderTarget(64, 48);
  scene.pass.render(renderer, target, null, true);
  assert.equal(renderer.calls.length, 1, "one render call without DOF");
  assert.equal(renderer.calls[0].camera, cameraPlus.threeObj);
  assert.equal(renderer.calls[0].target, target);
  runtime.deactivate();
});

test("depth of field renders through the scene pass with settings from the Camera+", () => {
  const { ctx, runtime, scene, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  cameraPlus.properties.depthOfField.enabled.set(1);
  cameraPlus.properties.depthOfField.aperture.set(4);
  cameraPlus.properties.depthOfField.focusDistance.set(120);
  cameraPlus.properties.depthOfField.nearBlurLevel.set(200);
  scene.update(0);
  const dof = scene.pass.__cameraPlusDof;
  assert.ok(dof && dof.enabled, "DOF pass attached and enabled");
  const renderer = recordingRenderer();
  const target = new ctx.THREE.WebGLRenderTarget(64, 48);
  scene.pass.render(renderer, target, null, true);
  assert.equal(renderer.calls.length, 3, "color pass, depth pass, and the blurred output");
  const uniforms = dof.material.uniforms;
  assert.equal(uniforms.aperture.value, 4);
  assert.equal(uniforms.focusDistance.value, 120);
  assert.equal(uniforms.nearBlurLevel.value, 2);
  assert.equal(uniforms.farBlurLevel.value, 1);
  assert.equal(uniforms.near.value, cameraPlus.threeObj.near);
  assert.equal(uniforms.far.value, cameraPlus.threeObj.far);
  runtime.deactivate();
});

test("turning DOF off returns the scene to the default render path", () => {
  const { ctx, runtime, scene, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  cameraPlus.properties.depthOfField.enabled.set(1);
  scene.update(0);
  cameraPlus.properties.depthOfField.enabled.set(0);
  scene.update(0);
  const renderer = recordingRenderer();
  scene.pass.render(renderer, new ctx.THREE.WebGLRenderTarget(8, 8), null, true);
  assert.equal(renderer.calls.length, 1);
  runtime.deactivate();
});

test("unloading a scene releases its depth-of-field targets", () => {
  const { ctx, runtime, scene, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  const cameraPlus = makeCameraPlus({ active: 1 });
  cameraPlus.properties.depthOfField.enabled.set(1);
  scene.update(0);
  const dof = scene.pass.__cameraPlusDof;
  scene.pass.render(recordingRenderer(), new ctx.THREE.WebGLRenderTarget(8, 8), null, true);
  assert.ok(dof.colorTarget, "targets allocated while rendering");
  scene.unload();
  assert.equal(dof.colorTarget, null);
  assert.equal(scene.unloaded, true, "the CM3 unload still runs");
  runtime.deactivate();
});

test("the Camera+ pass selection is the same for direct and repeated evaluation", () => {
  const { ctx, runtime, scene, makeCameraPlus } = setup();
  runtime.activate(ctx.context);
  makeCameraPlus({ active: 1 });
  for (const t of [0, 5, 2, 5, 0]) {
    scene.update(t);
    assert.ok(scene.pass.camera);
  }
  runtime.deactivate();
});
