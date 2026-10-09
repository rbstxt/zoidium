"use strict";

// Davidium-saved data: vanilla cameras with extra Camera+ fields, legacy
// Camera layers (type 9), and unknown keys on Camera+ objects must load
// without errors and must not change the CM3 camera.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";

test("a vanilla camera with Davidium depth-of-field and vibrate fields loads and ignores them", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const camera = new ctx.PZ.object3d.camera();
  assert.doesNotThrow(() => camera.load({
    type: 6,
    objectType: 1,
    properties: { dof: 1, dofAperture: 3, dofFocusDistance: 80, vibrate: { enabled: 1, seed: 9 }, shake: {} },
  }));
  assert.equal(camera.objectType, 1);
  assert.equal(camera.properties.dof, undefined, "Camera+ fields are not attached to the CM3 camera");
  assert.equal(camera.properties.vibrate, undefined);
  runtime.deactivate();
});

test("a Davidium Camera layer recovers its camera and DOF in a normal scene", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  let layer = null;
  assert.doesNotThrow(() => {
    layer = ctx.PZ.layer.create(9);
    layer.load({
      type: 9,
      properties: { name: "Camera" },
      objects: [{ type: 6, objectType: 1, properties: { dof: 1 } }],
    });
  });
  assert.equal(layer.type, 4);
  assert.equal(layer.objects[0].type, TYPE);
  assert.equal(layer.objects[0].properties.depthOfField.enabled.get(), 1);
  layer.update(0);
  assert.equal(layer.pass.camera, layer.objects[0].threeObj);
  assert.equal(layer.pass.__cameraPlusDof.enabled, true);
  assert.equal(runtime.isInUse(), false, "no project attached in this fixture");
  runtime.deactivate();
});

test("a Camera+ object ignores unknown Davidium keys and keeps the fields it knows", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const object = ctx.registry.instantiate(TYPE);
  assert.doesNotThrow(() => object.load({
    type: TYPE,
    schemaVersion: 1,
    properties: {
      track3d: true,
      shakeAmplitude: 0.5,
      vibrate: { enabled: 1, seed: 7 },
      depthOfField: { enabled: 1, aperture: 4 },
    },
  }));
  assert.equal(object.properties.vibrate.seed.get(), 7);
  assert.equal(object.properties.depthOfField.enabled.get(0), 1);
  assert.equal(object.properties.depthOfField.aperture.get(0), 4);
  assert.equal(object.properties.track3d, undefined);
  runtime.deactivate();
});

test("a Camera+ object with no saved properties loads with its defaults", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const object = ctx.registry.instantiate(TYPE);
  assert.doesNotThrow(() => object.load({ type: TYPE, schemaVersion: 1 }));
  assert.equal(object.isActive(), true, "new Camera+ objects are active by default");
  assert.equal(object.properties.depthOfField.enabled.get(0), 0);
  assert.equal(object.properties.vibrate.enabled.get(), 1);
  assert.equal(object.properties.vibrate.enablePosition.get(), 0);
  runtime.deactivate();
});
