"use strict";

// Camera+ editor viewport frustum helper. Selecting a Camera+ object must
// show the same THREE.CameraHelper (layer 1, viewport-only) as a selected
// stock CM3 camera; anything else keeps the stock helper behaviour. The
// dedicated Camera+ attribute panel was removed: activation must not touch
// context.ui.registerAttributePanel.
//
// The stock PZ.ui.helper3d binds objectsChanged at construction, so the
// tests model that: helper instances are created BEFORE activation and keep
// calling their pre-bound method, exactly like the live editor viewport.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";

function withLayers(object) {
  object.layers = { mask: 1, set(channel) { this.mask = 1 << channel; } };
  return object;
}

// THREE helper fakes as plain constructor functions: the runtime wraps
// THREE.CameraHelper with a function that forwards via .call, which class
// syntax would reject.
function addThreeHelperFakes(THREE) {
  THREE.CameraHelper = function FakeCameraHelper(camera) {
    this.camera = camera;
    this.matrix = camera.matrixWorld || (camera.matrixWorld = {});
    this.updates = 0;
    this.onBeforeRender = null;
    this.parent = null;
    withLayers(this);
    this.update();
  };
  THREE.CameraHelper.prototype.update = function () {
    this.updates += 1;
  };
  THREE.BoxHelper = function FakeBoxHelper(object) {
    this.object = object;
    this.onBeforeRender = null;
    this.parent = null;
    withLayers(this);
  };
  THREE.BoxHelper.prototype.update = function () {};
}

// Stock PZ.ui.helper3d model: the constructor binds objectsChanged (as in
// the CM3 runtime), the method shows a CameraHelper for a selected stock
// camera and a BoxHelper for any other single 3D object.
function addStockHelperHost(PZ, THREE) {
  PZ.ui.helper3d = class FakeHelper3d {
    constructor(viewport) {
      this.viewport = viewport;
      this.helper = null;
      this.objects = null;
      this.bound = this.objectsChanged.bind(this);
    }
    objectsChanged() {
      if (this.helper) {
        this.viewport.threeObj.remove(this.helper);
        this.helper = null;
      }
      const objects = this.objects;
      let selected = null;
      if (objects && objects.length === 1 && objects[0] instanceof PZ.object3d) selected = objects[0];
      if (!selected) return;
      if (selected instanceof PZ.object3d.camera) this.helper = new THREE.CameraHelper(selected.threeObj);
      else this.helper = new THREE.BoxHelper(selected.threeObj);
      this.helper.layers.set(1);
      this.viewport.threeObj.add(this.helper);
    }
    // Selection lists call the pre-bound method, as in CM3.
    fire() {
      this.bound();
    }
  };
}

function createViewport() {
  const children = [];
  const threeObj = {
    children,
    add(child) {
      if (!children.includes(child)) {
        children.push(child);
        child.parent = this;
      }
      return this;
    },
    remove(child) {
      const at = children.indexOf(child);
      if (at >= 0) children.splice(at, 1);
      child.parent = null;
      return this;
    },
  };
  return { threeObj };
}

function setup() {
  const ctx = harness.createContext();
  addThreeHelperFakes(ctx.THREE);
  addStockHelperHost(ctx.PZ, ctx.THREE);
  const viewport = createViewport();
  // A live viewport predates plugin activation: its bound method is fixed.
  const helper3d = new ctx.PZ.ui.helper3d(viewport);
  const runtime = harness.loadRuntime();
  return { ctx, runtime, viewport, helper3d };
}

function addCameraPlus(ctx, props = {}) {
  const object = ctx.registry.instantiate(TYPE);
  for (const [key, value] of Object.entries(props)) object.properties[key].set(value);
  return object;
}

test("a Camera+ passes the stock camera check while enabled", () => {
  const s = setup();
  try {
    s.runtime.activate(s.ctx.context);
    const cameraPlus = addCameraPlus(s.ctx);
    const vanilla = new s.ctx.PZ.object3d.camera();
    const plain = new s.ctx.PZ.object3d();
    assert.equal(cameraPlus instanceof s.ctx.PZ.object3d.camera, true, "Camera+ recognised as a camera");
    assert.equal(vanilla instanceof s.ctx.PZ.object3d.camera, true, "stock camera still matches");
    assert.equal(plain instanceof s.ctx.PZ.object3d.camera, false, "other objects still rejected");
  } finally {
    s.runtime.deactivate();
  }
});

test("a selected Camera+ shows the stock CameraHelper on layer 1", () => {
  const s = setup();
  try {
    s.runtime.activate(s.ctx.context);
    const cameraPlus = addCameraPlus(s.ctx);
    s.helper3d.objects = [cameraPlus];
    s.helper3d.fire();
    assert.ok(s.helper3d.helper instanceof s.ctx.THREE.CameraHelper, "same helper class as the stock camera");
    assert.equal(s.helper3d.helper.camera, cameraPlus.threeObj, "helper tracks the Camera+ camera");
    assert.equal(s.helper3d.helper.layers.mask, 2, "layer 1: editor viewport only, never in renders");
    assert.ok(s.viewport.threeObj.children.includes(s.helper3d.helper), "helper added to the viewport");
    assert.equal(typeof s.helper3d.helper.onBeforeRender, "function", "frustum refreshes every render");
  } finally {
    s.runtime.deactivate();
  }
});

test("stock cameras and other objects keep the stock helper behaviour", () => {
  const s = setup();
  try {
    s.runtime.activate(s.ctx.context);
    const vanilla = new s.ctx.PZ.object3d.camera();
    s.helper3d.objects = [vanilla];
    s.helper3d.fire();
    assert.ok(s.helper3d.helper instanceof s.ctx.THREE.CameraHelper, "stock camera still gets a CameraHelper");

    const plain = new s.ctx.PZ.object3d();
    plain.threeObj = new s.ctx.THREE.Object3D();
    s.helper3d.objects = [plain];
    s.helper3d.fire();
    assert.ok(s.helper3d.helper instanceof s.ctx.THREE.BoxHelper, "other objects still get a BoxHelper");

    s.helper3d.objects = [];
    s.helper3d.fire();
    assert.equal(s.helper3d.helper, null, "deselect removes the helper");
    assert.deepEqual(s.viewport.threeObj.children, [], "viewport left clean");

    s.helper3d.objects = [plain, vanilla];
    s.helper3d.fire();
    assert.equal(s.helper3d.helper, null, "multi-select shows no helper, as stock");
  } finally {
    s.runtime.deactivate();
  }
});

test("the helper follows film changes and the projection swap", () => {
  const s = setup();
  try {
    s.runtime.activate(s.ctx.context);
    const cameraPlus = addCameraPlus(s.ctx);
    assert.equal(cameraPlus.threeObj.__cameraPlusOwner, cameraPlus, "camera tracks its owner");
    s.helper3d.objects = [cameraPlus];
    s.helper3d.fire();
    const helper = s.helper3d.helper;
    const updates = helper.updates;

    cameraPlus.properties.focalLength.set(85);
    cameraPlus.update(3);
    helper.onBeforeRender();
    assert.ok(helper.updates > updates, "film change refreshes the frustum");

    cameraPlus.properties.projection.set("orthographic");
    cameraPlus.update(4);
    assert.ok(cameraPlus.threeObj.isOrthographicCamera, "orthographic projection active");
    assert.equal(cameraPlus.threeObj.__cameraPlusOwner, cameraPlus, "swapped camera tracks its owner");
    assert.notEqual(helper.camera, cameraPlus.threeObj, "helper still points at the old camera object");
    helper.onBeforeRender();
    assert.equal(helper.camera, cameraPlus.threeObj, "helper re-targets the live camera object");
  } finally {
    s.runtime.deactivate();
  }
});

test("deleting the object hides the helper like the stock camera", () => {
  const s = setup();
  try {
    s.runtime.activate(s.ctx.context);
    const cameraPlus = addCameraPlus(s.ctx);
    s.helper3d.objects = [cameraPlus];
    s.helper3d.fire();
    assert.ok(s.helper3d.helper, "helper shown while selected");
    s.helper3d.objects = [];
    s.helper3d.fire();
    assert.equal(s.helper3d.helper, null, "helper removed with the selection");
    assert.deepEqual(s.viewport.threeObj.children, [], "helper removed from the viewport");
  } finally {
    s.runtime.deactivate();
  }
});

test("disabling restores the stock check and the stock appearance", () => {
  const s = setup();
  const OriginalCameraHelper = s.ctx.THREE.CameraHelper;
  s.runtime.activate(s.ctx.context);
  const cameraPlus = addCameraPlus(s.ctx);
  s.helper3d.objects = [cameraPlus];
  s.helper3d.fire();
  assert.ok(s.helper3d.helper instanceof s.ctx.THREE.CameraHelper, "helper shown while enabled");
  s.runtime.deactivate();
  assert.equal(cameraPlus instanceof s.ctx.PZ.object3d.camera, false, "stock check restored");
  assert.equal(s.ctx.THREE.CameraHelper, OriginalCameraHelper, "stock CameraHelper restored");
  const helpers = s.viewport.threeObj.children.filter((child) => child instanceof s.ctx.THREE.CameraHelper);
  assert.deepEqual(helpers, [], "no CameraHelper remains in the viewport");
  const boxes = s.viewport.threeObj.children.filter((child) => child instanceof s.ctx.THREE.BoxHelper);
  assert.equal(boxes.length, 1, "disabled selection falls back to the stock BoxHelper");
  s.helper3d.fire();
  assert.ok(s.helper3d.helper instanceof s.ctx.THREE.BoxHelper, "further selections use the stock branch");
  s.runtime.deactivate();
});

test("activation without a CameraHelper host still succeeds", () => {
  const ctx = harness.createContext();
  delete ctx.THREE.CameraHelper;
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  assert.equal(ctx.registry.isRegistered(TYPE), true);
  runtime.deactivate();
});

test("activation registers no attribute panel", () => {
  const ctx = harness.createContext();
  addThreeHelperFakes(ctx.THREE);
  addStockHelperHost(ctx.PZ, ctx.THREE);
  const calls = [];
  ctx.context.ui = Object.assign({}, ctx.context.ui, {
    registerAttributePanel(spec) {
      calls.push(spec);
      return () => {};
    },
  });
  const runtime = harness.loadRuntime();
  try {
    runtime.activate(ctx.context);
    assert.deepEqual(calls, [], "no gear button, no launch row");
  } finally {
    runtime.deactivate();
  }
});

test("the runtime sources reference no attribute panel", () => {
  const source = harness.readPluginSource("camera-runtime.js");
  assert.equal(/registerAttributePanel/.test(source), false, "no attribute panel registration");
  assert.equal(/cameraAttributeSpec/.test(source), false, "no attribute panel spec");
});
